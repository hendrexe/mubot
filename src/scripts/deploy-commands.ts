/**
 * Registers slash commands with Discord.
 *
 *   npm run commands:deploy                 → DEV_GUILD_ID set: that server only (instant)
 *                                             otherwise: globally (can take up to an hour)
 *   npm run commands:deploy -- --global     → force global registration
 *   npm run commands:deploy -- --clear      → remove all commands from the chosen scope
 *
 * Run it whenever you add, remove or change a command definition.
 */
import { REST, Routes } from 'discord.js';
import { commands } from '../commands';
import { env } from '../config/env';
import { logger } from '../core/logger';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const forceGlobal = args.has('--global');
  const clear = args.has('--clear');

  const guildId = forceGlobal ? undefined : env.DEV_GUILD_ID;
  const route = guildId
    ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId)
    : Routes.applicationCommands(env.DISCORD_CLIENT_ID);
  const scope = guildId ? `guild ${guildId}` : 'globally';

  const body = clear ? [] : commands.map((command) => command.data.toJSON());

  const rest = new REST().setToken(env.DISCORD_TOKEN);
  await rest.put(route, { body });

  logger.info(
    clear ? `Cleared all commands ${scope}` : `Deployed ${body.length} command(s) ${scope}`,
  );
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Command deployment failed');
  process.exit(1);
});
