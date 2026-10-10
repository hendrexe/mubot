import { Events } from 'discord.js';
import { defineEvent } from '../core/define';

export const guildDelete = defineEvent({
  name: Events.GuildDelete,
  execute(ctx, guild) {
    // `available === false` means a Discord outage, not that we were removed.
    if (!guild.available) return;
    ctx.tempVoice.purgeGuild(guild.id);
    ctx.logger.info({ guildId: guild.id }, 'Removed from guild – stored data purged');
  },
});
