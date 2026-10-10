import { describe, expect, it } from 'vitest';
import {
  containsBlockedWord,
  renderChannelName,
  sanitizeChannelName,
} from '../src/modules/tempVoice/templates';

const options = { maxLength: 100, blockedWords: [] as string[], fallback: 'Voice Channel' };

describe('sanitizeChannelName', () => {
  it('collapses whitespace and strips control characters', () => {
    expect(sanitizeChannelName('  hello \n\t  world\u0000 ', 100)).toBe('hello world');
  });

  it('enforces the maximum length without leaving trailing spaces', () => {
    expect(sanitizeChannelName('abcde fghij', 6)).toBe('abcde');
  });
});

describe('containsBlockedWord', () => {
  it('matches case-insensitively as a substring', () => {
    expect(containsBlockedWord('My BadWord room', ['badword'])).toBe(true);
    expect(containsBlockedWord('Friendly room', ['badword'])).toBe(false);
  });

  it('ignores empty entries', () => {
    expect(containsBlockedWord('anything', [''])).toBe(false);
  });
});

describe('renderChannelName', () => {
  const context = { displayName: 'Alice', username: 'alice_01' };

  it('replaces all placeholders', () => {
    expect(renderChannelName("{displayName}'s room ({username})", context, options)).toBe(
      "Alice's room (alice_01)",
    );
  });

  it('falls back when the result is empty', () => {
    expect(renderChannelName('   ', context, options)).toBe('Voice Channel');
  });

  it('falls back when the result contains a blocked word', () => {
    expect(
      renderChannelName('{displayName}', context, { ...options, blockedWords: ['alice'] }),
    ).toBe('Voice Channel');
  });

  it('truncates long names', () => {
    const long = { displayName: 'x'.repeat(200), username: 'x' };
    expect(renderChannelName('{displayName}', long, options)).toHaveLength(100);
  });
});
