import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { defineCommand } from '../core/define';
import { UserError } from '../core/errors';
import type { AppContext } from '../core/types';
import { describeMatch, buildMatchEmbed } from '../modules/challengermode/watcher';
import type { TournamentResults } from '../modules/challengermode/service';
import { makeEmbed, respond, respondWith } from '../utils/respond';

const MEDALS = ['🥇', '🥈', '🥉'];
const MAX_DESCRIPTION = 4000;

function formatResults(results: TournamentResults): string {
  const lines = results.standings.map(
    (s) => `${MEDALS[s.placement - 1] ?? `**${s.displayPlacement}**`} ${s.name}`,
  );
  const text = lines.join('\n') || 'No standings available yet.';
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

const data = new SlashCommandBuilder()
  .setName('challengermode')
  .setDescription('Interact with ChallengerMode API')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('setup-results')
      .setDescription('Configure a channel for tournament results')
      .addStringOption((o) =>
        o.setName('tournament-id').setDescription('The ID of the tournament').setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('The channel where results should be posted')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('post-results')
      .setDescription('Post tournament results to the configured channel')
      .addStringOption((o) =>
        o.setName('tournament-id').setDescription('The ID of the tournament').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('watch-team')
      .setDescription("Announce a team's completed matches in a channel")
      .addStringOption((o) =>
        o.setName('tournament').setDescription('Tournament link or ID').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('team').setDescription('Team name, link or ID').setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('The channel where match results should be posted')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list-watches').setDescription('List the teams being watched in this server'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('last-result')
      .setDescription("Post a team's latest finished match(es) in this channel")
      .addStringOption((o) =>
        o.setName('tournament').setDescription('Tournament link or ID').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('team').setDescription('Team name, link or ID').setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('count')
          .setDescription('How many recent matches to post (default 1)')
          .setMinValue(1)
          .setMaxValue(5),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('unwatch-team')
      .setDescription('Stop announcing a watched team')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Watch ID from /challengermode list-watches')
          .setRequired(true),
      ),
  );

const WATCH_ERRORS: Record<string, string> = {
  INVALID_TOURNAMENT: 'That does not look like a Challengermode tournament link or ID.',
  TOURNAMENT_NOT_FOUND: 'I could not find that tournament.',
  TEAM_NOT_FOUND:
    'I could not find that team in the tournament. Use the exact team name, or a team link/ID of a registered team.',
};

export const challengermodeCommand = defineCommand({
  data,
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) throw new UserError('This command can only be used in a server.');

    if (subcommand === 'watch-team') {
      const tournament = interaction.options.getString('tournament', true);
      const team = interaction.options.getString('team', true);
      const channel = interaction.options.getChannel('channel', true);

      await interaction.deferReply({ flags: 'Ephemeral' });
      try {
        const { watch, created } = await ctx.challengermode.addTeamWatch(
          guildId,
          channel.id,
          tournament,
          team,
        );
        await respond(
          interaction,
          created ? 'success' : 'info',
          created
            ? `Now watching **${watch.teamName}** in **${watch.tournamentName}**. Their finished matches will be posted in <#${channel.id}>.`
            : `Already watching **${watch.teamName}** in **${watch.tournamentName}** for <#${channel.id}>.`,
        );
      } catch (err) {
        const message = err instanceof Error ? WATCH_ERRORS[err.message] : undefined;
        if (message) throw new UserError(message);
        ctx.logger.error({ err }, 'Failed to add team watch');
        throw new UserError('Could not reach ChallengerMode. Please try again later.');
      }
      return;
    }

    if (subcommand === 'last-result') {
      const tournament = interaction.options.getString('tournament', true);
      const team = interaction.options.getString('team', true);
      const count = interaction.options.getInteger('count') ?? 1;

      await interaction.deferReply();
      let result;
      try {
        result = await ctx.challengermode.getTeamLastResults(tournament, team, count);
      } catch (err) {
        const message = err instanceof Error ? WATCH_ERRORS[err.message] : undefined;
        if (message) throw new UserError(message);
        ctx.logger.error({ err }, 'Failed to fetch last results');
        throw new UserError('Could not reach ChallengerMode. Please try again later.');
      }

      const embeds = result.matches.flatMap((m) => {
        const report = describeMatch(result.lineupId, m);
        return report
          ? [
              buildMatchEmbed(
                result.teamName,
                result.tournament.id,
                result.tournament.name,
                m,
                report,
              ),
            ]
          : [];
      });
      if (!embeds.length) {
        throw new UserError(
          `**${result.teamName}** has no finished matches in this tournament yet.`,
        );
      }
      await interaction.editReply({ embeds });
      return;
    }

    if (subcommand === 'list-watches') {
      const watches = ctx.challengermode.listWatches(guildId);
      const text = watches.length
        ? watches
            .map((w) => `\`${w.id}\` **${w.teamName}** – ${w.tournamentName} → <#${w.channelId}>`)
            .join('\n')
        : 'No teams are being watched.';
      await respond(interaction, 'info', text);
      return;
    }

    if (subcommand === 'unwatch-team') {
      const id = interaction.options.getInteger('id', true);
      const removed = ctx.challengermode.removeWatch(guildId, id);
      if (!removed) throw new UserError(`No watch with ID ${id} in this server.`);
      await respond(interaction, 'success', `Stopped watching (ID ${id}).`);
      return;
    }

    const tournamentId = interaction.options.getString('tournament-id', true).trim();

    if (subcommand === 'setup-results') {
      const channel = interaction.options.getChannel('channel', true);

      ctx.challengermode.upsertConfig(tournamentId, channel.id, guildId);
      await respond(
        interaction,
        'success',
        `Results for tournament \`${tournamentId}\` will be posted in <#${channel.id}>.`,
      );
      return;
    }

    if (subcommand === 'post-results') {
      const channelId = ctx.challengermode.getReportingChannel(tournamentId);
      if (!channelId) {
        throw new UserError(
          `No reporting channel configured for tournament \`${tournamentId}\`. Run \`/challengermode setup-results\` first.`,
        );
      }

      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isSendable()) {
        throw new UserError('The configured channel no longer exists or I cannot post there.');
      }

      await interaction.deferReply({ flags: 'Ephemeral' });

      let results: TournamentResults;
      try {
        results = await ctx.challengermode.getTournamentResults(tournamentId);
      } catch (err) {
        ctx.logger.error({ err, tournamentId }, 'Failed to fetch tournament results');
        throw new UserError(
          'Could not fetch results from ChallengerMode. Check the tournament ID and try again.',
        );
      }

      const embed = makeEmbed('info', formatResults(results), `🏆 ${results.name} – Results`);
      try {
        await channel.send({ embeds: [embed] });
      } catch (err) {
        ctx.logger.error({ err, channelId }, 'Failed to post tournament results');
        throw new UserError('I could not post in the configured channel. Check my permissions.');
      }

      await respondWith(interaction, [
        makeEmbed('success', `Posted results for **${results.name}** in <#${channelId}>.`),
      ]);
    }
  },
});
