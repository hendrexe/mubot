import type { ClientEvents } from 'discord.js';
import type { Command, EventHandler } from './types';

/** Identity helpers that give you full type inference when declaring commands / events. */
export const defineCommand = (command: Command): Command => command;

export const defineEvent = <K extends keyof ClientEvents>(
  handler: EventHandler<K>,
): EventHandler<K> => handler;
