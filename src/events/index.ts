import type { AnyEventHandler } from '../core/types';
import { channelDelete } from './channelDelete';
import { guildDelete } from './guildDelete';
import { interactionCreate } from './interactionCreate';
import { ready } from './ready';
import { voiceStateUpdate } from './voiceStateUpdate';

export const events: AnyEventHandler[] = [
  ready,
  interactionCreate,
  voiceStateUpdate,
  channelDelete,
  guildDelete,
];
