import type { EmbedBuilder } from 'discord.js';
import { makeEmbed } from '../../utils/respond';

export function welcomeEmbed(ownerId: string): EmbedBuilder {
  return makeEmbed(
    'info',
    [
      `Welcome <@${ownerId}>, this is **your** temporary channel.`,
      '',
      'Manage it with `/voice`: `name`, `limit`, `bitrate`, `lock`, `hide`, `permit`, `reject`, `kick` and `transfer`.',
      'The channel is deleted automatically once everyone has left.',
    ].join('\n'),
    '🎙️ Temporary voice channel',
  );
}

export function ownerChangedEmbed(previousId: string, newId: string): EmbedBuilder {
  return makeEmbed('info', `👑 <@${previousId}> left – <@${newId}> is now the channel owner.`);
}

export function unclaimedEmbed(): EmbedBuilder {
  return makeEmbed(
    'info',
    'The owner left and this channel is now unclaimed. Use `/voice claim` to take over.',
  );
}
