import type {
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { BotConfig } from '../config/types';
import type { Db } from '../database';
import type { TempVoiceControls } from '../modules/tempVoice/controls';
import type { TempVoiceService } from '../modules/tempVoice/service';
import type { ChallengerModeService } from '../modules/challengermode/service';
import type { MatchWatcher } from '../modules/challengermode/watcher';
import type { Logger } from './logger';

/** Everything a command or event handler may need. Built once in `index.ts`. */
export interface AppContext {
  client: Client;
  config: BotConfig;
  logger: Logger;
  db: Db;
  commands: ReadonlyMap<string, Command>;
  tempVoice: TempVoiceService;
  voiceControls: TempVoiceControls;
  challengermode: ChallengerModeService;
  matchWatcher: MatchWatcher;
}

export interface Command {
  /** Anything with a name and `toJSON()`, e.g. a `SlashCommandBuilder`. */
  data: {
    readonly name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void>;
}

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(ctx: AppContext, ...args: ClientEvents[K]): Promise<void> | void;
}

export type AnyEventHandler = { [K in keyof ClientEvents]: EventHandler<K> }[keyof ClientEvents];
