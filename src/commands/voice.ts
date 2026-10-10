import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  escapeMarkdown,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { botConfig } from '../config/bot.config';
import { defineCommand } from '../core/define';
import { UserError } from '../core/errors';
import { respond, respondWith } from '../utils/respond';

const cfg = botConfig.tempVoice;

const userOption = (sub: SlashCommandSubcommandBuilder, description: string) =>
  sub.addUserOption((o) => o.setName('user').setDescription(description).setRequired(true));

const data = new SlashCommandBuilder()
  .setName('voice')
  .setDescription('Control your temporary voice channel')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('name')
      .setDescription('Rename your channel')
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('The new name')
          .setRequired(true)
          .setMaxLength(cfg.maxNameLength),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('limit')
      .setDescription('Set the user limit (0 = unlimited)')
      .addIntegerOption((o) =>
        o
          .setName('count')
          .setDescription('Maximum number of users')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(cfg.maxUserLimit),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('bitrate')
      .setDescription('Set the audio bitrate')
      .addIntegerOption((o) =>
        o
          .setName('kbps')
          .setDescription('Bitrate in kbps (max depends on server boost level)')
          .setRequired(true)
          .setMinValue(8)
          .setMaxValue(384),
      ),
  )
  .addSubcommand((s) => s.setName('lock').setDescription('Prevent new users from joining'))
  .addSubcommand((s) => s.setName('unlock').setDescription('Allow users to join again'))
  .addSubcommand((s) => s.setName('hide').setDescription('Hide the channel from everyone else'))
  .addSubcommand((s) => s.setName('unhide').setDescription('Make the channel visible again'))
  .addSubcommand((s) =>
    userOption(
      s.setName('permit').setDescription('Let a user join even when locked or hidden'),
      'The user to permit',
    ),
  )
  .addSubcommand((s) =>
    userOption(
      s.setName('reject').setDescription('Block a user and disconnect them'),
      'The user to reject',
    ),
  )
  .addSubcommand((s) =>
    userOption(
      s.setName('kick').setDescription('Disconnect a user (they can rejoin)'),
      'The user to kick',
    ),
  )
  .addSubcommand((s) =>
    userOption(
      s.setName('reset-user').setDescription('Remove a permit / reject for a user'),
      'The user to reset',
    ),
  )
  .addSubcommand((s) =>
    userOption(
      s.setName('transfer').setDescription('Give your channel to someone in it'),
      'The new owner',
    ),
  )
  .addSubcommand((s) => s.setName('claim').setDescription('Take over a channel whose owner left'))
  .addSubcommand((s) =>
    s.setName('info').setDescription('Show details about your current channel'),
  );

export const voiceCommand = defineCommand({
  data,

  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) {
      throw new UserError('This command can only be used in a server.');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { member, options } = interaction;
    const controls = ctx.voiceControls;

    const targetUser = () => {
      const target = options.getMember('user');
      if (!target) throw new UserError('That user is not in this server.');
      return target;
    };

    switch (options.getSubcommand()) {
      case 'name': {
        const name = await controls.rename(member, options.getString('name', true));
        return respond(interaction, 'success', `Channel renamed to **${escapeMarkdown(name)}**.`);
      }
      case 'limit': {
        const count = options.getInteger('count', true);
        await controls.setUserLimit(member, count);
        return respond(
          interaction,
          'success',
          count === 0 ? 'User limit removed.' : `User limit set to **${count}**.`,
        );
      }
      case 'bitrate': {
        const kbps = options.getInteger('kbps', true);
        await controls.setBitrate(member, kbps);
        return respond(interaction, 'success', `Bitrate set to **${kbps} kbps**.`);
      }
      case 'lock':
        await controls.setLocked(member, true);
        return respond(
          interaction,
          'success',
          'Channel locked. Use `/voice permit` to let specific people in.',
        );
      case 'unlock':
        await controls.setLocked(member, false);
        return respond(interaction, 'success', 'Channel unlocked.');
      case 'hide':
        await controls.setHidden(member, true);
        return respond(
          interaction,
          'success',
          'Channel hidden. Use `/voice permit` to let specific people see it.',
        );
      case 'unhide':
        await controls.setHidden(member, false);
        return respond(interaction, 'success', 'Channel is visible again.');
      case 'permit': {
        const target = targetUser();
        await controls.permit(member, target);
        return respond(
          interaction,
          'success',
          `<@${target.id}> can now see and join your channel.`,
        );
      }
      case 'reject': {
        const target = targetUser();
        await controls.reject(member, target);
        return respond(
          interaction,
          'success',
          `<@${target.id}> has been blocked from your channel.`,
        );
      }
      case 'kick': {
        const target = targetUser();
        await controls.kick(member, target);
        return respond(interaction, 'success', `<@${target.id}> was disconnected.`);
      }
      case 'reset-user': {
        const target = targetUser();
        await controls.resetUser(member, target);
        return respond(interaction, 'success', `Access rules for <@${target.id}> were removed.`);
      }
      case 'transfer': {
        const target = targetUser();
        await controls.transfer(member, target);
        return respond(interaction, 'success', `<@${target.id}> is now the owner of this channel.`);
      }
      case 'claim':
        await controls.claim(member);
        return respond(interaction, 'success', 'You are now the owner of this channel.');
      case 'info': {
        const info = controls.getInfo(member);
        const humans = info.channel.members.filter((m) => !m.user.bot).size;
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.primary)
          .setTitle(`🎙️ ${info.channel.name}`)
          .addFields(
            {
              name: 'Owner',
              value: info.record.ownerId ? `<@${info.record.ownerId}>` : '*unclaimed*',
              inline: true,
            },
            {
              name: 'Members',
              value: `${humans}${info.channel.userLimit ? ` / ${info.channel.userLimit}` : ''}`,
              inline: true,
            },
            {
              name: 'Bitrate',
              value: `${Math.round(info.channel.bitrate / 1000)} kbps`,
              inline: true,
            },
            { name: 'Locked', value: info.locked ? 'Yes' : 'No', inline: true },
            { name: 'Hidden', value: info.hidden ? 'Yes' : 'No', inline: true },
            {
              name: 'Created',
              value: `<t:${Math.floor(info.record.createdAt / 1000)}:R>`,
              inline: true,
            },
          );
        return respondWith(interaction, [embed]);
      }
      default:
        throw new UserError('Unknown subcommand.');
    }
  },
});
