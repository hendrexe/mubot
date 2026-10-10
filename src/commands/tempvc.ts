import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder,
  type VoiceChannel,
} from 'discord.js';
import { botConfig } from '../config/bot.config';
import { defineCommand } from '../core/define';
import { UserError } from '../core/errors';
import type { TempVoiceTarget } from '../modules/tempVoice/repository';
import type { TargetSettingsInput } from '../modules/tempVoice/service';
import { makeEmbed, respond, respondWith } from '../utils/respond';

const cfg = botConfig.tempVoice;

/** Options shared by `setup` and `edit`. */
function withSettingOptions(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .addChannelOption((o) =>
      o
        .setName('category')
        .setDescription(
          'Category new temporary channels are created in (default: same as the target)',
        )
        .addChannelTypes(ChannelType.GuildCategory),
    )
    .addStringOption((o) =>
      o
        .setName('name-template')
        .setDescription('Channel name. Placeholders: {displayName} {username}')
        .setMaxLength(cfg.maxNameLength),
    )
    .addIntegerOption((o) =>
      o
        .setName('user-limit')
        .setDescription('Default user limit for new channels (0 = unlimited)')
        .setMinValue(0)
        .setMaxValue(cfg.maxUserLimit),
    )
    .addIntegerOption((o) =>
      o
        .setName('bitrate')
        .setDescription('Default bitrate in kbps')
        .setMinValue(8)
        .setMaxValue(384),
    );
}

const targetOption = (sub: SlashCommandSubcommandBuilder) =>
  sub.addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('The target voice channel')
      .addChannelTypes(ChannelType.GuildVoice)
      .setRequired(true),
  );

const data = new SlashCommandBuilder()
  .setName('tempvc')
  .setDescription('Configure temporary voice channels')
  .setDefaultMemberPermissions(cfg.adminPermission)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    withSettingOptions(
      sub
        .setName('setup')
        .setDescription(
          'Designate a target channel (or create one). Joining it creates a temp channel.',
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('An existing voice channel to use (omit to create a new one)')
            .addChannelTypes(ChannelType.GuildVoice),
        ),
    ),
  )
  .addSubcommand((sub) =>
    withSettingOptions(
      targetOption(
        sub.setName('edit').setDescription('Change the settings of a target channel'),
      ).addBooleanOption((o) =>
        o.setName('reset').setDescription('Clear all overrides first (back to bot defaults)'),
      ),
    ),
  )
  .addSubcommand((sub) =>
    targetOption(
      sub.setName('remove').setDescription('Stop using a channel as a target (does not delete it)'),
    ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('Show all target channels in this server'),
  );

export const tempVcCommand = defineCommand({
  data,

  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) {
      throw new UserError('This command can only be used in a server.');
    }
    // Defence in depth: server admins can re-scope slash commands in Integrations settings.
    if (!interaction.memberPermissions.has(cfg.adminPermission)) {
      throw new UserError('You do not have permission to manage temporary voice channels.');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild } = interaction;

    switch (interaction.options.getSubcommand()) {
      case 'setup': {
        const existing = await getVoiceChannel(interaction, 'channel', false);
        const target = await ctx.tempVoice.setupTarget(
          guild,
          existing,
          readSettings(interaction),
          interaction.user.id,
        );
        await respondWith(interaction, [
          makeEmbed(
            'success',
            `<#${target.channelId}> is now a target. Anyone joining it gets their own temporary channel.\n\n${describe(target)}`,
          ),
        ]);
        return;
      }

      case 'edit': {
        const channel = await getVoiceChannel(interaction, 'channel', true);
        const target = ctx.tempVoice.updateTarget(
          guild,
          channel.id,
          readSettings(interaction),
          interaction.options.getBoolean('reset') ?? false,
        );
        await respondWith(interaction, [
          makeEmbed('success', `Updated <#${target.channelId}>.\n\n${describe(target)}`),
        ]);
        return;
      }

      case 'remove': {
        const channel = await getVoiceChannel(interaction, 'channel', true);
        ctx.tempVoice.removeTarget(channel.id);
        await respond(
          interaction,
          'success',
          `<#${channel.id}> is no longer a target. Existing temporary channels keep working until they are empty.`,
        );
        return;
      }

      case 'list': {
        const targets = ctx.tempVoice.listTargets(guild.id);
        if (targets.length === 0) {
          await respond(
            interaction,
            'info',
            'No target channels yet. Create one with `/tempvc setup`.',
          );
          return;
        }
        const embed = makeEmbed(
          'info',
          `${targets.length} target channel(s)`,
          '🎙️ Temporary voice targets',
        );
        for (const { target, activeChannels } of targets.slice(0, 25)) {
          embed.addFields({
            name: guild.channels.cache.get(target.channelId)?.name ?? target.channelId,
            value: `<#${target.channelId}> · **${activeChannels}** active\n${describe(target)}`,
          });
        }
        await respondWith(interaction, [embed]);
        return;
      }

      default:
        throw new UserError('Unknown subcommand.');
    }
  },
});

// ───────────────────────── helpers ─────────────────────────

/** Reads the shared setting options. Absent options stay `undefined` (= unchanged). */
function readSettings(interaction: ChatInputCommandInteraction<'cached'>): TargetSettingsInput {
  const category = interaction.options.getChannel('category', false, [ChannelType.GuildCategory]);
  const template = interaction.options.getString('name-template');
  const limit = interaction.options.getInteger('user-limit');
  const kbps = interaction.options.getInteger('bitrate');

  return {
    categoryId: category?.id,
    nameTemplate: template ?? undefined,
    userLimit: limit ?? undefined,
    bitrate: kbps === null ? undefined : kbps * 1000,
  };
}

function getVoiceChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  name: string,
  required: true,
): Promise<VoiceChannel>;
function getVoiceChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  name: string,
  required: false,
): Promise<VoiceChannel | null>;
async function getVoiceChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  name: string,
  required: boolean,
): Promise<VoiceChannel | null> {
  const option = interaction.options.getChannel(name, required, [ChannelType.GuildVoice]);
  if (!option) return null;

  const channel = await interaction.guild.channels.fetch(option.id);
  if (channel?.type !== ChannelType.GuildVoice) {
    throw new UserError('That is not a regular voice channel.');
  }
  return channel;
}

/** Human-readable summary of a target's settings, showing defaults where nothing is overridden. */
function describe(target: TempVoiceTarget): string {
  const template = target.nameTemplate ?? cfg.nameTemplate;
  const limit = target.userLimit ?? cfg.userLimit;
  const bitrate = target.bitrate ?? cfg.bitrate;

  return [
    `• Name: \`${template}\`${target.nameTemplate ? '' : ' *(default)*'}`,
    `• Category: ${target.categoryId ? `<#${target.categoryId}>` : '*same as target*'}`,
    `• User limit: ${limit === null ? '*copied from target*' : limit === 0 ? 'unlimited' : limit}`,
    `• Bitrate: ${bitrate === null ? '*copied from target*' : `${Math.round(bitrate / 1000)} kbps`}`,
  ].join('\n');
}
