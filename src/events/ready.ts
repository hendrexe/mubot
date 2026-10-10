import { Events } from 'discord.js';
import { defineEvent } from '../core/define';

export const ready = defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(ctx, client) {
    ctx.logger.info(`Logged in as ${client.user.tag} (${client.guilds.cache.size} servers)`);

    if (ctx.config.tempVoice.enabled) {
      await ctx.tempVoice.sweep();
    }
  },
});
