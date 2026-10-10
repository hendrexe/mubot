import { PermissionFlagsBits, type GuildMember, type VoiceBasedChannel } from 'discord.js';
import type { TempVoiceConfig } from '../../config/types';
import { UserError } from '../../core/errors';
import type { Logger } from '../../core/logger';
import { SlidingWindowLimiter } from '../../utils/rateLimiter';
import type { TempVoiceChannelRecord, TempVoiceRepository } from './repository';
import { containsBlockedWord, sanitizeChannelName } from './templates';

export interface ManagedChannel {
  channel: VoiceBasedChannel;
  record: TempVoiceChannelRecord;
}

export interface ChannelInfo extends ManagedChannel {
  locked: boolean;
  hidden: boolean;
}

const MIN_BITRATE_KBPS = 8;

/**
 * Everything a user can do to a temporary channel. Authorisation lives here (not in the command
 * layer) so no entry point – slash command, button, API – can forget to check ownership.
 *
 * Every method that changes something is scoped to the channel the caller is *currently
 * connected to* and *owns*, so an owner can never touch any other channel.
 */
export class TempVoiceControls {
  private readonly renameLimiter: SlidingWindowLimiter;

  constructor(
    private readonly repo: TempVoiceRepository,
    private readonly config: TempVoiceConfig,
    private readonly logger: Logger,
  ) {
    this.renameLimiter = new SlidingWindowLimiter(
      config.renameLimit.max,
      config.renameLimit.windowMs,
    );
  }

  // ───────────────────────── authorisation ─────────────────────────

  /** The temp channel the member is connected to (they need not own it). */
  getManaged(member: GuildMember): ManagedChannel {
    const channel = member.voice.channel;
    if (!channel) {
      throw new UserError('Join a temporary voice channel first.');
    }
    const record = this.repo.getChannel(channel.id);
    if (!record) {
      throw new UserError('The channel you are in is not a temporary voice channel.');
    }
    return { channel, record };
  }

  /** The temp channel the member is connected to *and* owns. */
  requireOwner(member: GuildMember): ManagedChannel {
    const managed = this.getManaged(member);
    const { ownerId } = managed.record;

    if (ownerId === member.id) return managed;
    if (ownerId === null) {
      throw new UserError('This channel has no owner. Use `/voice claim` to take it over.');
    }
    throw new UserError(`Only the channel owner (<@${ownerId}>) can do that.`);
  }

  // ───────────────────────── channel settings ─────────────────────────

  async rename(member: GuildMember, rawName: string): Promise<string> {
    const { channel } = this.requireOwner(member);

    const name = sanitizeChannelName(rawName, this.config.maxNameLength);
    if (!name) throw new UserError('The channel name cannot be empty.');
    if (containsBlockedWord(name, this.config.blockedWords)) {
      throw new UserError('That name is not allowed.');
    }

    const waitMs = this.renameLimiter.consume(channel.id);
    if (waitMs > 0) {
      const retryAt = Math.ceil((Date.now() + waitMs) / 1000);
      throw new UserError(
        `Discord limits how often a channel can be renamed. Try again <t:${retryAt}:R>.`,
      );
    }

    await channel.setName(name, reason(member, 'Renamed'));
    return name;
  }

  async setUserLimit(member: GuildMember, limit: number): Promise<void> {
    const { channel } = this.requireOwner(member);
    if (!Number.isInteger(limit) || limit < 0 || limit > this.config.maxUserLimit) {
      throw new UserError(
        `The limit must be between 0 (unlimited) and ${this.config.maxUserLimit}.`,
      );
    }
    await channel.setUserLimit(limit, reason(member, 'User limit changed'));
  }

  async setBitrate(member: GuildMember, kbps: number): Promise<void> {
    const { channel } = this.requireOwner(member);
    const maxKbps = Math.floor(channel.guild.maximumBitrate / 1000);
    if (!Number.isInteger(kbps) || kbps < MIN_BITRATE_KBPS || kbps > maxKbps) {
      throw new UserError(
        `The bitrate must be between ${MIN_BITRATE_KBPS} and ${maxKbps} kbps on this server.`,
      );
    }
    await channel.setBitrate(kbps * 1000, reason(member, 'Bitrate changed'));
  }

  /** Locked = @everyone cannot connect. The owner keeps access so they can always rejoin. */
  async setLocked(member: GuildMember, locked: boolean): Promise<void> {
    const { channel } = this.requireOwner(member);
    const why = reason(member, locked ? 'Locked' : 'Unlocked');

    await channel.permissionOverwrites.edit(
      channel.guild.roles.everyone,
      { Connect: locked ? false : null },
      { reason: why },
    );
    if (locked) {
      await channel.permissionOverwrites.edit(
        member.id,
        { Connect: true, ViewChannel: true },
        { reason: why },
      );
    }
  }

  /** Hidden = @everyone cannot see the channel. The owner keeps access. */
  async setHidden(member: GuildMember, hidden: boolean): Promise<void> {
    const { channel } = this.requireOwner(member);
    const why = reason(member, hidden ? 'Hidden' : 'Unhidden');

    await channel.permissionOverwrites.edit(
      channel.guild.roles.everyone,
      { ViewChannel: hidden ? false : null },
      { reason: why },
    );
    if (hidden) {
      await channel.permissionOverwrites.edit(
        member.id,
        { Connect: true, ViewChannel: true },
        { reason: why },
      );
    }
  }

  // ───────────────────────── people ─────────────────────────

  /** Allows a user to see and join the channel even when it is locked or hidden. */
  async permit(member: GuildMember, target: GuildMember): Promise<void> {
    const { channel } = this.requireOwner(member);
    this.assertNotSelf(member, target);
    await channel.permissionOverwrites.edit(
      target.id,
      { Connect: true, ViewChannel: true },
      { reason: reason(member, `Permitted ${target.user.username}`) },
    );
  }

  /** Blocks a user from seeing / joining the channel and disconnects them if they are inside. */
  async reject(member: GuildMember, target: GuildMember): Promise<void> {
    const { channel } = this.requireOwner(member);
    this.assertCanTarget(member, target);

    const why = reason(member, `Rejected ${target.user.username}`);
    await channel.permissionOverwrites.edit(
      target.id,
      { Connect: false, ViewChannel: false },
      { reason: why },
    );
    if (target.voice.channelId === channel.id) {
      await target.voice.disconnect(why);
    }
  }

  /** Disconnects a user from the channel without blocking them from coming back. */
  async kick(member: GuildMember, target: GuildMember): Promise<void> {
    const { channel } = this.requireOwner(member);
    this.assertCanTarget(member, target);
    if (target.voice.channelId !== channel.id) {
      throw new UserError(`${target.displayName} is not in your channel.`);
    }
    await target.voice.disconnect(reason(member, `Kicked ${target.user.username}`));
  }

  /** Removes any permit / reject previously set for a user. */
  async resetUser(member: GuildMember, target: GuildMember): Promise<void> {
    const { channel } = this.requireOwner(member);
    this.assertNotSelf(member, target);
    if (!channel.permissionOverwrites.cache.has(target.id)) {
      throw new UserError(`${target.displayName} has no special access rules in this channel.`);
    }
    await channel.permissionOverwrites.delete(
      target.id,
      reason(member, `Reset ${target.user.username}`),
    );
  }

  // ───────────────────────── ownership ─────────────────────────

  async transfer(member: GuildMember, target: GuildMember): Promise<void> {
    const { channel } = this.requireOwner(member);
    this.assertNotSelf(member, target);
    if (target.user.bot) throw new UserError('You cannot transfer ownership to a bot.');
    if (target.voice.channelId !== channel.id) {
      throw new UserError(`${target.displayName} must be in your channel first.`);
    }
    await this.transferOwnership(channel, target);
  }

  /** Takes over a channel whose owner left (or is unclaimed). */
  async claim(member: GuildMember): Promise<void> {
    const { channel, record } = this.getManaged(member);

    if (record.ownerId === member.id) throw new UserError('You already own this channel.');
    if (record.ownerId !== null && channel.members.has(record.ownerId)) {
      throw new UserError(`<@${record.ownerId}> is still in the channel and owns it.`);
    }
    await this.transferOwnership(channel, member);
  }

  /**
   * Persists the new owner and (best-effort) updates permission overwrites. Ownership itself is
   * enforced by the database, so a failure to edit overwrites never leaves the channel ownerless.
   */
  async transferOwnership(channel: VoiceBasedChannel, newOwner: GuildMember): Promise<void> {
    const previousOwnerId = this.repo.getChannel(channel.id)?.ownerId ?? null;
    this.repo.setOwner(channel.id, newOwner.id);

    try {
      if (previousOwnerId && previousOwnerId !== newOwner.id) {
        if (channel.permissionOverwrites.cache.has(previousOwnerId)) {
          await channel.permissionOverwrites.delete(previousOwnerId, 'Ownership transferred');
        }
      }
      await channel.permissionOverwrites.edit(
        newOwner.id,
        { Connect: true, ViewChannel: true },
        { reason: 'Ownership transferred' },
      );
    } catch (err) {
      this.logger.warn(
        { err, channelId: channel.id },
        'Could not update overwrites after ownership change',
      );
    }
  }

  // ───────────────────────── info ─────────────────────────

  getInfo(member: GuildMember): ChannelInfo {
    const managed = this.getManaged(member);
    const everyone = managed.channel.permissionOverwrites.cache.get(managed.channel.guild.id);
    return {
      ...managed,
      locked: everyone?.deny.has(PermissionFlagsBits.Connect) ?? false,
      hidden: everyone?.deny.has(PermissionFlagsBits.ViewChannel) ?? false,
    };
  }

  /** Forget per-channel state once a channel is gone. */
  forget(channelId: string): void {
    this.renameLimiter.reset(channelId);
  }

  // ───────────────────────── guards ─────────────────────────

  private assertNotSelf(member: GuildMember, target: GuildMember): void {
    if (member.id === target.id) throw new UserError('You cannot do that to yourself.');
  }

  private assertCanTarget(member: GuildMember, target: GuildMember): void {
    this.assertNotSelf(member, target);
    if (target.user.bot) throw new UserError('You cannot do that to a bot.');
    if (
      !this.config.ownersCanTargetStaff &&
      target.permissions.any([
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers,
      ])
    ) {
      throw new UserError('You cannot do that to server staff.');
    }
  }
}

/** Audit-log reason shown in Discord's audit log. */
function reason(member: GuildMember, action: string): string {
  return `${action} by ${member.user.username} (${member.id})`;
}
