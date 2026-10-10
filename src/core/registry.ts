import type { Client } from 'discord.js';
import type { AnyEventHandler, AppContext, Command } from './types';

export function buildCommandMap(commands: readonly Command[]): Map<string, Command> {
  const map = new Map<string, Command>();
  for (const command of commands) {
    if (map.has(command.data.name)) {
      throw new Error(`Duplicate command name: ${command.data.name}`);
    }
    map.set(command.data.name, command);
  }
  return map;
}

/**
 * Attaches all event handlers to the client. Every handler is wrapped so that a thrown error is
 * logged instead of becoming an unhandled rejection (which would crash the process).
 */
export function registerEvents(
  client: Client,
  ctx: AppContext,
  events: readonly AnyEventHandler[],
): void {
  for (const event of events) {
    // Handlers are heterogeneous (each has its own argument tuple), so erase the types here.
    const handler = event as { execute(ctx: AppContext, ...args: unknown[]): unknown };

    const run = async (args: unknown[]): Promise<void> => {
      try {
        await handler.execute(ctx, ...args);
      } catch (err) {
        ctx.logger.error({ err, event: event.name }, 'Unhandled error in event handler');
      }
    };
    // `run` never rejects, so discarding the promise is safe.
    const listener = (...args: unknown[]): void => void run(args);

    if (event.once) {
      client.once(event.name, listener);
    } else {
      client.on(event.name, listener);
    }
  }
}
