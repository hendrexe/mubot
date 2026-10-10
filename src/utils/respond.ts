import { EmbedBuilder, MessageFlags, type RepliableInteraction } from 'discord.js';
import { botConfig } from '../config/bot.config';

export type ResponseKind = 'success' | 'error' | 'info' | 'warning';

const EMOJI: Record<ResponseKind, string> = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️',
};

const COLOR: Record<ResponseKind, number> = {
  success: botConfig.colors.success,
  error: botConfig.colors.error,
  info: botConfig.colors.primary,
  warning: botConfig.colors.warning,
};

/** Builds a themed embed. Without a title the kind's emoji is prefixed to the description. */
export function makeEmbed(kind: ResponseKind, description: string, title?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR[kind]);
  if (title) return embed.setTitle(title).setDescription(description);
  return embed.setDescription(`${EMOJI[kind]} ${description}`);
}

/** Replies (ephemerally) or edits the deferred reply, whichever is appropriate. */
export async function respondWith(
  interaction: RepliableInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds });
  } else {
    await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
  }
}

export function respond(
  interaction: RepliableInteraction,
  kind: ResponseKind,
  description: string,
): Promise<void> {
  return respondWith(interaction, [makeEmbed(kind, description)]);
}
