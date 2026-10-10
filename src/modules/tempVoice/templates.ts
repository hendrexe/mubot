export interface NameContext {
  displayName: string;
  username: string;
}

/** Collapses whitespace, strips control characters and enforces Discord's length limit. */
export function sanitizeChannelName(input: string, maxLength: number): string {
  return input
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export function containsBlockedWord(name: string, blockedWords: readonly string[]): boolean {
  const lowered = name.toLowerCase();
  return blockedWords.some((word) => word.length > 0 && lowered.includes(word.toLowerCase()));
}

/**
 * Renders a channel name from a template. Falls back to `fallback` when the result is empty or
 * contains a blocked word.
 */
export function renderChannelName(
  template: string,
  context: NameContext,
  options: { maxLength: number; blockedWords: readonly string[]; fallback: string },
): string {
  const rendered = sanitizeChannelName(
    template
      .replaceAll('{displayName}', context.displayName)
      .replaceAll('{username}', context.username),
    options.maxLength,
  );

  if (!rendered || containsBlockedWord(rendered, options.blockedWords)) {
    return options.fallback;
  }
  return rendered;
}
