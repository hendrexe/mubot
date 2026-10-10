import { PermissionFlagsBits } from 'discord.js';

/**
 * Permissions the bot must hold to run the temp-voice feature:
 *  - ManageChannels: create / rename / delete the temporary channels
 *  - MoveMembers:    move the joining user into their new channel
 *  - ManageRoles:    Discord requires it to edit permission overwrites (lock, hide, permit, reject)
 *  - ViewChannel + Connect: needed to see and move people into the channels it creates
 */
export const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.MoveMembers,
] as const;

/** Permissions requested in the invite link (required ones + posting the welcome embed). */
export const INVITE_PERMISSIONS = [
  ...REQUIRED_BOT_PERMISSIONS,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
] as const;
