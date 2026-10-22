import { Client } from 'discord.js';
import { botConfig } from './config/bot.config';
import { env } from './config/env';
import { commands } from './commands';
import { logger } from './core/logger';
import { buildCommandMap, registerEvents } from './core/registry';
import type { AppContext } from './core/types';
import { createDatabase } from './database';
import { events } from './events';
import { TempVoiceControls } from './modules/tempVoice/controls';
import { SqliteTempVoiceRepository } from './modules/tempVoice/repository';
import { TempVoiceService } from './modules/tempVoice/service';
import { SqliteChallengerModeRepository } from './modules/challengermode/repository';
import { ChallengerModeService } from './modules/challengermode/service';
import { MatchWatcher } from './modules/challengermode/watcher';

async function main(): Promise<void> {
  const db = createDatabase(env.DATABASE_PATH);

  const client = new Client({
    intents: botConfig.intents,
    presence: botConfig.presence,
  });

  // ── Composition root: build services and wire dependencies explicitly ──
  const tempVoiceLogger = logger.child({ module: 'tempVoice' });
  const tempVoiceRepo = new SqliteTempVoiceRepository(db);
  const voiceControls = new TempVoiceControls(tempVoiceRepo, botConfig.tempVoice, tempVoiceLogger);
  const tempVoice = new TempVoiceService(
    client,
    tempVoiceRepo,
    voiceControls,
    botConfig.tempVoice,
    tempVoiceLogger,
  );

  const challengermodeRepo = new SqliteChallengerModeRepository(db);
  const challengermode = new ChallengerModeService(challengermodeRepo);
  const matchWatcher = new MatchWatcher(
    client,
    challengermode,
    logger.child({ module: 'challengermode' }),
  );

  const ctx: AppContext = {
    client,
    config: botConfig,
    logger,
    db,
    commands: buildCommandMap(commands),
    tempVoice,
    voiceControls,
    challengermode,
    matchWatcher,
  };

  registerEvents(client, ctx, events);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received – shutting down`);
    void client.destroy();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
