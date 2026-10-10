import { botConfig } from '../config/bot.config';
import type { Command } from '../core/types';
import { tempVcCommand } from './tempvc';
import { voiceCommand } from './voice';

/**
 * Register new commands here. Feature flags in `bot.config.ts` decide which are active, so
 * disabling a feature also removes its slash commands on the next `commands:deploy`.
 */
export const commands: Command[] = [
  ...(botConfig.tempVoice.enabled ? [tempVcCommand, voiceCommand] : []),
];
