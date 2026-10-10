import { ActivityType, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { BotConfig } from './types';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  Base settings. Edit values here – nothing else needs to     ║
 * ║  change. Secrets (token etc.) live in `.env`, not here.      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
export const botConfig: BotConfig = {
  name: 'Maynooth Marshal',

  colors: {
    primary: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    error: 0xed4245,
  },

  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],

  presence: {
    status: 'online',
    activities: [{ name: 'Official MU E-Sports Society Bot', type: ActivityType.Watching }],
  },

  tempVoice: {
    enabled: true,
    adminPermission: PermissionFlagsBits.ManageChannels,

    nameTemplate: "{displayName}'s Channel",
    fallbackName: 'Voice Channel',
    targetChannelName: '➕ Create Channel',

    userLimit: null, // null = copy from the target channel
    bitrate: null, // null = copy from the target channel

    maxNameLength: 100,
    maxUserLimit: 99,
    blockedWords: [],

    creationCooldownMs: 5_000,
    deleteDelayMs: 0,
    deleteWhenOnlyBotsRemain: true,

    ownerLeaveBehavior: 'transfer',
    ownersCanTargetStaff: false,

    renameLimit: { max: 2, windowMs: 10 * 60 * 1000 },

    announcements: true,
  },
};
