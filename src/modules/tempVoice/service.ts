import {
  ChannelType,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type Client,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type VoiceBasedChannel,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import type { TempVoiceConfig } from '../../config/types';
import { UserError } from '../../core/errors';
import type { Logger } from '../../core/logger';
import { SlidingWindowLimiter } from '../../utils/rateLimiter';
import type { TempVoiceControls } from './controls';
import { ownerChangedEmbed, unclaimedEmbed, welcomeEmbed } from './messages';
import { REQUIRED_BOT_PERMISSIONS } from './permissions';
import type { TempVoiceChannelRecord, TempVoiceRepository, TempVoiceTarget } from './repository';
import { containsBlockedWord, renderChannelName, sanitizeChannelName } from './templates';

/** Settings an admin can set on a target. `undefined` = leave as is, `null` = reset to default. */
export interface TargetSettingsInput {
  categoryId?: string | null;
  nameTemplate?: string | null;
  userLimit?: number | null;
  /** Bits per second. */
  bitrate?: number | null;
}

const MIN_BITRATE = 8_000;

const BOT_CHANNEL_OVERWRITE = {
  ViewChannel: true,
  Connect: true,
  ManageChannels: true,
  ManageRoles: true,
  MoveMembers: true,
} as const;

/**
 * Lifecycle of temporary voice channels:
 *   join target → create channel → move user → … → everyone leaves → delete channel
 * plus admin management of targets and crash-safe cleanup on startup.
 */
export class TempVoiceService {
  private readonly deleteTimers = new Map<string, NodeJS.Timeout>();
  private readonly creating = new Set<string>();
  private readonly createLimiter: SlidingWindowLimiter | null;

  constructor(
    private readonly client: Client,
    private readonly repo: TempVoiceRepository,
    private readonly controls: TempVoiceControls,
    private readonly config: TempVoiceConfig,
    private readonly logger: Logger,
  ) {
    this.createLimiter =
      config.creationCooldownMs > 0 ? new SlidingWindowLimiter(1, config.creationCooldownMs) : null;
  }

  // ════════════════════════ Admin API ════════════════════════

  /**
   * Designates a voice channel as a target. When `existing` is null a new target channel is
   * created (in `input.categoryId` if given).
   */
  async setupTarget(
    guild: Guild,
    existing: VoiceChannel | null,
    input: TargetSettingsInput,
    actorId: string,
  ): Promise<TempVoiceTarget> {
    const me = await guild.members.fetchMe();
    this.assertBotPermissions(
      existing
        ? existing.permissionsFor(me).missing(REQUIRED_BOT_PERMISSIONS)
        : me.permissions.missing(REQUIRED_BOT_PERMISSIONS),
    );

    const settings = this.validateSettings(guild, input);

    if (existing && this.repo.getChannel(existing.id)) {
      throw new UserError('That channel is itself a temporary channel and cannot be a target.');
    }

    const channel =
      existing ??
      (await guild.channels.create({
        name: this.config.targetChannelName,
        type: ChannelType.GuildVoice,
        parent: settings.categoryId ?? undefined,
        reason: `Temporary voice target created by ${actorId}`,
      }));

    const target: TempVoiceTarget = {
      channelId: channel.id,
      guildId: guild.id,
      categoryId: settings.categoryId ?? null,
      nameTemplate: settings.nameTemplate ?? null,
      userLimit: settings.userLimit ?? null,
      bitrate: settings.bitrate ?? null,
      createdBy: actorId,
      createdAt: Date.now(),
    };
    this.repo.upsertTarget(target);
    return this.repo.getTarget(channel.id) ?? target;
  }

  /** Updates a target. With `reset`, all overrides are cleared first. */
  updateTarget(
    guild: Guild,
    channelId: string,
    input: TargetSettingsInput,
    reset: boolean,
  ): TempVoiceTarget {
    const current = this.repo.getTarget(channelId);
    if (!current) throw new UserError('That channel is not a temporary voice target.');

    const settings = this.validateSettings(guild, input);
    const base: TempVoiceTarget = reset
      ? { ...current, categoryId: null, nameTemplate: null, userLimit: null, bitrate: null }
      : current;

    const next: TempVoiceTarget = {
      ...base,
      categoryId: settings.categoryId !== undefined ? settings.categoryId : base.categoryId,
      nameTemplate: settings.nameTemplate !== undefined ? settings.nameTemplate : base.nameTemplate,
      userLimit: settings.userLimit !== undefined ? settings.userLimit : base.userLimit,
      bitrate: settings.bitrate !== undefined ? settings.bitrate : base.bitrate,
    };
    this.repo.upsertTarget(next);
    return next;
  }

  /** Stops a channel from being a target. Does not delete the channel or live temp channels. */
  removeTarget(channelId: string): void {
    if (!this.repo.deleteTarget(channelId)) {
      throw new UserError('That channel is not a temporary voice target.');
    }
  }

  listTargets(guildId: string): Array<{ target: TempVoiceTarget; activeChannels: number }> {
    return this.repo.listTargets(guildId).map((target) => ({
      target,
      activeChannels: this.repo.countChannelsByTarget(target.channelId),
    }));
  }

  // ════════════════════════ Event entry points ════════════════════════

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!this.config.enabled || oldState.channelId === newState.channelId) return;

    if (oldState.channel) {
      await this.onLeave(oldState.channel, oldState.member).catch((err: unknown) =>
        this.logger.error({ err, channelId: oldState.channelId }, 'Failed to handle voice leave'),
      );
    }
    if (newState.channel && newState.member) {
      await this.onJoin(newState.channel, newState.member).catch((err: unknown) =>
        this.logger.error({ err, channelId: newState.channelId }, 'Failed to handle voice join'),
      );
    }
  }

  /** A channel disappeared (deleted by us or by a human) – drop everything we know about it. */
  handleChannelDelete(channelId: string): void {
    this.cancelDeletion(channelId);
    this.controls.forget(channelId);
    this.repo.deleteTarget(channelId);
    this.repo.deleteChannel(channelId);
  }

  /** The bot was removed from a guild. */
  purgeGuild(guildId: string): void {
    this.repo.deleteGuildData(guildId);
  }

  /**
   * Reconciles stored state with reality. Run on startup: handles channels that emptied or whose
   * owner left while the bot was offline, and forgets channels that no longer exist.
   */
  async sweep(): Promise<void> {
    const { guilds } = this.client;

    for (const target of this.repo.listAllTargets()) {
      const guild = guilds.cache.get(target.guildId);
      if (!guild) {
        this.repo.deleteTarget(target.channelId);
      } else if (guild.available && !guild.channels.cache.has(target.channelId)) {
        this.repo.deleteTarget(target.channelId);
      }
    }

    for (const record of this.repo.listAllChannels()) {
      try {
        const guild = guilds.cache.get(record.guildId);
        if (!guild) {
          this.repo.deleteChannel(record.channelId);
          continue;
        }
        if (!guild.available) continue;

        const channel = guild.channels.cache.get(record.channelId);
        if (!channel?.isVoiceBased()) {
          this.repo.deleteChannel(record.channelId);
        } else if (this.isEmpty(channel)) {
          await this.deleteChannel(channel, 'Temporary voice channel was empty at startup');
        } else if (record.ownerId && !channel.members.has(record.ownerId)) {
          await this.onOwnerLeft(channel, record);
        }
      } catch (err) {
        this.logger.error({ err, channelId: record.channelId }, 'Sweep failed for channel');
      }
    }
  }

  // ════════════════════════ Voice events ════════════════════════

  private async onJoin(channel: VoiceBasedChannel, member: GuildMember): Promise<void> {
    // Someone (re)joined: any pending deletion of this channel is void.
    this.cancelDeletion(channel.id);

    if (channel.type !== ChannelType.GuildVoice || member.user.bot) return;

    const target = this.repo.getTarget(channel.id);
    if (target) await this.createFor(member, channel, target);
  }

  private async onLeave(channel: VoiceBasedChannel, member: GuildMember | null): Promise<void> {
    const record = this.repo.getChannel(channel.id);
    if (!record) return;

    if (this.isEmpty(channel)) {
      this.scheduleDeletion(channel);
    } else if (member && record.ownerId === member.id) {
      await this.onOwnerLeft(channel, record);
    }
  }

  // ════════════════════════ Creation ════════════════════════

  private async createFor(
    member: GuildMember,
    targetChannel: VoiceChannel,
    target: TempVoiceTarget,
  ): Promise<void> {
    const { guild } = member;

    if (this.creating.has(member.id)) return;

    if (this.createLimiter) {
      const waitMs = this.createLimiter.consume(`${guild.id}:${member.id}`);
      if (waitMs > 0) {
        this.logger.debug({ userId: member.id }, 'Creation cooldown active – ignoring join');
        return;
      }
    }

    this.creating.add(member.id);
    try {
      const reason = `Temporary voice channel for ${member.user.username} (${member.id})`;
      const settings = this.resolveSettings(target, targetChannel, member);

      const channel = await guild.channels.create({
        name: settings.name,
        type: ChannelType.GuildVoice,
        parent: settings.parentId ?? undefined, // omitting overwrites keeps the category's permissions in sync
        userLimit: settings.userLimit,
        bitrate: settings.bitrate,
        reason,
      });

      // Persist *before* moving so the resulting voice event already sees a managed channel.
      this.repo.insertChannel({
        channelId: channel.id,
        guildId: guild.id,
        ownerId: member.id,
        targetId: target.channelId,
        createdAt: Date.now(),
      });
      this.logger.info(
        { channelId: channel.id, ownerId: member.id, guildId: guild.id },
        'Temp channel created',
      );

      // Make sure locking / hiding the channel can never lock the bot itself out.
      const botId = this.client.user?.id;
      if (botId) {
        await channel.permissionOverwrites
          .edit(botId, BOT_CHANNEL_OVERWRITE, { reason })
          .catch((err: unknown) =>
            this.logger.warn(
              { err, channelId: channel.id },
              'Could not set bot overwrite on new channel',
            ),
          );
      }

      try {
        await member.voice.setChannel(channel, reason);
      } catch (err) {
        // Almost always: the user left the target channel before we could move them.
        this.logger.debug(
          { err, channelId: channel.id },
          'Could not move member – removing channel',
        );
        await this.deleteChannel(channel, 'Owner left before being moved');
        return;
      }

      await this.announce(channel, welcomeEmbed(member.id));
    } finally {
      this.creating.delete(member.id);
    }
  }

  private resolveSettings(
    target: TempVoiceTarget,
    targetChannel: VoiceChannel,
    member: GuildMember,
  ) {
    const { guild } = member;

    const name = renderChannelName(
      target.nameTemplate ?? this.config.nameTemplate,
      { displayName: member.displayName, username: member.user.username },
      {
        maxLength: this.config.maxNameLength,
        blockedWords: this.config.blockedWords,
        fallback: this.config.fallbackName,
      },
    );

    const category = target.categoryId ? guild.channels.cache.get(target.categoryId) : undefined;
    const parentId =
      category?.type === ChannelType.GuildCategory ? category.id : targetChannel.parentId;

    return {
      name,
      parentId,
      userLimit: target.userLimit ?? this.config.userLimit ?? targetChannel.userLimit,
      bitrate: Math.min(
        target.bitrate ?? this.config.bitrate ?? targetChannel.bitrate,
        guild.maximumBitrate,
      ),
    };
  }

  // ════════════════════════ Deletion & ownership ════════════════════════

  /** Empty = nobody left (optionally ignoring bots). */
  private isEmpty(channel: VoiceBasedChannel): boolean {
    return channel.members.every((m) => this.config.deleteWhenOnlyBotsRemain && m.user.bot);
  }

  private scheduleDeletion(channel: VoiceBasedChannel): void {
    this.cancelDeletion(channel.id);

    if (this.config.deleteDelayMs <= 0) {
      void this.deleteChannel(channel, 'Temporary voice channel is empty');
      return;
    }

    const timer = setTimeout(() => {
      this.deleteTimers.delete(channel.id);
      const current = this.client.channels.cache.get(channel.id);
      if (!current?.isVoiceBased()) {
        this.repo.deleteChannel(channel.id);
      } else if (this.isEmpty(current)) {
        void this.deleteChannel(current, 'Temporary voice channel is empty');
      }
    }, this.config.deleteDelayMs);
    this.deleteTimers.set(channel.id, timer);
  }

  private cancelDeletion(channelId: string): void {
    const timer = this.deleteTimers.get(channelId);
    if (timer) {
      clearTimeout(timer);
      this.deleteTimers.delete(channelId);
    }
  }

  private async deleteChannel(channel: VoiceBasedChannel, reason: string): Promise<void> {
    this.cancelDeletion(channel.id);
    try {
      await channel.delete(reason);
    } catch (err) {
      const alreadyGone =
        err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownChannel;
      if (!alreadyGone) {
        this.logger.error({ err, channelId: channel.id }, 'Failed to delete temp channel');
        return; // keep the record so the next sweep can retry
      }
    }
    this.controls.forget(channel.id);
    this.repo.deleteChannel(channel.id);
    this.logger.info({ channelId: channel.id }, 'Temp channel deleted');
  }

  private async onOwnerLeft(
    channel: VoiceBasedChannel,
    record: TempVoiceChannelRecord,
  ): Promise<void> {
    const previousOwnerId = record.ownerId;
    const successor =
      this.config.ownerLeaveBehavior === 'transfer'
        ? channel.members.find((m) => !m.user.bot)
        : undefined;

    if (successor) {
      await this.controls.transferOwnership(channel, successor);
      if (previousOwnerId)
        await this.announce(channel, ownerChangedEmbed(previousOwnerId, successor.id));
      return;
    }

    this.repo.setOwner(channel.id, null);
    await this.announce(channel, unclaimedEmbed());
  }

  // ════════════════════════ Helpers ════════════════════════

  private async announce(channel: VoiceBasedChannel, embed: EmbedBuilder): Promise<void> {
    if (!this.config.announcements) return;
    try {
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
      this.logger.debug({ err, channelId: channel.id }, 'Could not post message in voice channel');
    }
  }

  private assertBotPermissions(missing: string[]): void {
    if (missing.length > 0) {
      throw new UserError(
        `I am missing permissions: **${missing.join(', ')}**. Grant them to my role (and make sure the channel / category does not deny them), then try again.`,
      );
    }
  }

  private validateSettings(guild: Guild, input: TargetSettingsInput): TargetSettingsInput {
    const out: TargetSettingsInput = {};

    if (input.categoryId !== undefined) {
      if (input.categoryId !== null) {
        const category = guild.channels.cache.get(input.categoryId);
        if (category?.type !== ChannelType.GuildCategory) {
          throw new UserError('The category must be a category channel.');
        }
      }
      out.categoryId = input.categoryId;
    }

    if (input.nameTemplate !== undefined) {
      if (input.nameTemplate !== null) {
        const template = sanitizeChannelName(input.nameTemplate, this.config.maxNameLength);
        if (!template) throw new UserError('The name template cannot be empty.');
        if (containsBlockedWord(template, this.config.blockedWords)) {
          throw new UserError('That name template contains a blocked word.');
        }
        out.nameTemplate = template;
      } else {
        out.nameTemplate = null;
      }
    }

    if (input.userLimit !== undefined) {
      if (
        input.userLimit !== null &&
        (!Number.isInteger(input.userLimit) ||
          input.userLimit < 0 ||
          input.userLimit > this.config.maxUserLimit)
      ) {
        throw new UserError(`The user limit must be between 0 and ${this.config.maxUserLimit}.`);
      }
      out.userLimit = input.userLimit;
    }

    if (input.bitrate !== undefined) {
      if (input.bitrate !== null) {
        const max = guild.maximumBitrate;
        if (input.bitrate < MIN_BITRATE || input.bitrate > max) {
          throw new UserError(
            `The bitrate must be between ${MIN_BITRATE / 1000} and ${Math.floor(max / 1000)} kbps on this server.`,
          );
        }
      }
      out.bitrate = input.bitrate;
    }

    return out;
  }
}
