import { DiscordAPIError, Events, RESTJSONErrorCodes } from 'discord.js';
import { defineEvent } from '../core/define';
import { UserError } from '../core/errors';
import type { AppContext } from '../core/types';
import { respond } from '../utils/respond';

export const interactionCreate = defineEvent({
  name: Events.InteractionCreate,

  async execute(ctx, interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = ctx.commands.get(interaction.commandName);
    if (!command) {
      ctx.logger.warn({ command: interaction.commandName }, 'Received unknown command');
      await respond(interaction, 'error', 'That command is not available.');
      return;
    }

    try {
      await command.execute(interaction, ctx);
    } catch (err) {
      const message = toUserMessage(err, ctx, interaction.commandName);
      try {
        await respond(interaction, 'error', message);
      } catch (replyErr) {
        ctx.logger.error({ err: replyErr }, 'Could not send error response');
      }
    }
  },
});

/** Turns any thrown value into text that is safe to show; logs anything unexpected. */
function toUserMessage(err: unknown, ctx: AppContext, commandName: string): string {
  if (err instanceof UserError) return err.message;

  if (
    err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.MissingPermissions ||
      err.code === RESTJSONErrorCodes.MissingAccess)
  ) {
    ctx.logger.warn({ err, command: commandName }, 'Discord rejected an action (permissions)');
    return 'I am missing the permissions to do that. Ask a server admin to check my role and the channel permissions.';
  }

  ctx.logger.error({ err, command: commandName }, 'Command failed');
  return 'Something went wrong. Please try again in a moment.';
}
