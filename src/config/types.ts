import type { GatewayIntentBits, PresenceData } from 'discord.js';

export interface TempVoiceConfig {
  /** Master switch. When false the feature (and its commands) are fully disabled. */
  enabled: boolean;

  /** Permission members need to run `/tempvc` (designate / edit / remove target channels). */
  adminPermission: bigint;

  /**
   * Default channel name. Placeholders: `{displayName}` (server nickname) and `{username}`.
   * Can be overridden per target channel with `/tempvc setup` or `/tempvc edit`.
   */
  nameTemplate: string;
  /** Used when the rendered name is empty or contains a blocked word. */
  fallbackName: string;
  /** Name of the target channel when `/tempvc setup` creates one for you. */
  targetChannelName: string;

  /** Default user limit (0 = unlimited). `null` = copy the limit of the target channel. */
  userLimit: number | null;
  /** Default bitrate in bits per second. `null` = copy the bitrate of the target channel. */
  bitrate: number | null;

  /** Discord's hard limit is 100 characters. */
  maxNameLength: number;
  /** Discord's hard limit for voice channels is 99. */
  maxUserLimit: number;
  /** Case-insensitive substrings that are not allowed in channel names. */
  blockedWords: string[];

  /** Minimum time between two channel creations by the same user (0 = disabled). */
  creationCooldownMs: number;
  /** Grace period before an empty channel is deleted (0 = delete immediately). */
  deleteDelayMs: number;
  /** Treat a channel containing only bots as empty (e.g. a music bot left behind). */
  deleteWhenOnlyBotsRemain: boolean;

  /**
   * What happens when the owner leaves but other people remain:
   *  - `transfer`:  ownership passes to someone still in the channel
   *  - `unclaimed`: nobody owns it until someone runs `/voice claim`
   */
  ownerLeaveBehavior: 'transfer' | 'unclaimed';
  /** Whether channel owners may reject / kick members with elevated permissions. */
  ownersCanTargetStaff: boolean;

  /** Discord only allows ~2 renames per channel per 10 minutes – keep this in line with that. */
  renameLimit: { max: number; windowMs: number };

  /** Post welcome / ownership messages in the voice channel's built-in text chat. */
  announcements: boolean;
}

export interface BotConfig {
  name: string;
  colors: {
    primary: number;
    success: number;
    warning: number;
    error: number;
  };
  /** Gateway intents. Add more here as new features need them. */
  intents: GatewayIntentBits[];
  presence: PresenceData;
  tempVoice: TempVoiceConfig;
}
