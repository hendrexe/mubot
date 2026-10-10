import { Events } from 'discord.js';
import { defineEvent } from '../core/define';

export const voiceStateUpdate = defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(ctx, oldState, newState) {
    await ctx.tempVoice.handleVoiceStateUpdate(oldState, newState);
  },
});
