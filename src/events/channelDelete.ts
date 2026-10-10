import { Events } from 'discord.js';
import { defineEvent } from '../core/define';

export const channelDelete = defineEvent({
  name: Events.ChannelDelete,
  execute(ctx, channel) {
    if (channel.isDMBased()) return;
    ctx.tempVoice.handleChannelDelete(channel.id);
  },
});
