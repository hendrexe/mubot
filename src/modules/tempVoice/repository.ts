import type { Db } from '../../database';

export interface TempVoiceTarget {
  /** The voice channel users join to get a temporary channel. */
  channelId: string;
  guildId: string;
  /** Where temporary channels are created. `null` = same category as the target. */
  categoryId: string | null;
  /** `null` = use the default from `bot.config.ts`. */
  nameTemplate: string | null;
  userLimit: number | null;
  /** Bits per second. */
  bitrate: number | null;
  createdBy: string;
  createdAt: number;
}

export interface TempVoiceChannelRecord {
  channelId: string;
  guildId: string;
  /** `null` = unclaimed. */
  ownerId: string | null;
  targetId: string;
  createdAt: number;
}

/** Persistence port. Swap the implementation (Postgres, Prisma, ...) without touching the rest. */
export interface TempVoiceRepository {
  upsertTarget(target: TempVoiceTarget): void;
  getTarget(channelId: string): TempVoiceTarget | undefined;
  listTargets(guildId: string): TempVoiceTarget[];
  listAllTargets(): TempVoiceTarget[];
  deleteTarget(channelId: string): boolean;

  insertChannel(record: TempVoiceChannelRecord): void;
  getChannel(channelId: string): TempVoiceChannelRecord | undefined;
  listAllChannels(): TempVoiceChannelRecord[];
  countChannelsByTarget(targetId: string): number;
  setOwner(channelId: string, ownerId: string | null): void;
  deleteChannel(channelId: string): void;

  deleteGuildData(guildId: string): void;
}

interface TargetRow {
  channel_id: string;
  guild_id: string;
  category_id: string | null;
  name_template: string | null;
  user_limit: number | null;
  bitrate: number | null;
  created_by: string;
  created_at: number;
}

interface ChannelRow {
  channel_id: string;
  guild_id: string;
  owner_id: string | null;
  target_id: string;
  created_at: number;
}

const toTarget = (row: TargetRow): TempVoiceTarget => ({
  channelId: row.channel_id,
  guildId: row.guild_id,
  categoryId: row.category_id,
  nameTemplate: row.name_template,
  userLimit: row.user_limit,
  bitrate: row.bitrate,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const toChannel = (row: ChannelRow): TempVoiceChannelRecord => ({
  channelId: row.channel_id,
  guildId: row.guild_id,
  ownerId: row.owner_id,
  targetId: row.target_id,
  createdAt: row.created_at,
});

export class SqliteTempVoiceRepository implements TempVoiceRepository {
  private readonly sql;

  constructor(db: Db) {
    this.sql = {
      upsertTarget: db.prepare(`
        INSERT INTO temp_voice_targets
          (channel_id, guild_id, category_id, name_template, user_limit, bitrate, created_by, created_at)
        VALUES
          (@channelId, @guildId, @categoryId, @nameTemplate, @userLimit, @bitrate, @createdBy, @createdAt)
        ON CONFLICT(channel_id) DO UPDATE SET
          category_id   = excluded.category_id,
          name_template = excluded.name_template,
          user_limit    = excluded.user_limit,
          bitrate       = excluded.bitrate
      `),
      getTarget: db.prepare('SELECT * FROM temp_voice_targets WHERE channel_id = ?'),
      listTargets: db.prepare(
        'SELECT * FROM temp_voice_targets WHERE guild_id = ? ORDER BY created_at',
      ),
      listAllTargets: db.prepare('SELECT * FROM temp_voice_targets'),
      deleteTarget: db.prepare('DELETE FROM temp_voice_targets WHERE channel_id = ?'),

      insertChannel: db.prepare(`
        INSERT INTO temp_voice_channels (channel_id, guild_id, owner_id, target_id, created_at)
        VALUES (@channelId, @guildId, @ownerId, @targetId, @createdAt)
      `),
      getChannel: db.prepare('SELECT * FROM temp_voice_channels WHERE channel_id = ?'),
      listAllChannels: db.prepare('SELECT * FROM temp_voice_channels'),
      countByTarget: db.prepare(
        'SELECT COUNT(*) AS n FROM temp_voice_channels WHERE target_id = ?',
      ),
      setOwner: db.prepare('UPDATE temp_voice_channels SET owner_id = ? WHERE channel_id = ?'),
      deleteChannel: db.prepare('DELETE FROM temp_voice_channels WHERE channel_id = ?'),

      deleteGuildTargets: db.prepare('DELETE FROM temp_voice_targets WHERE guild_id = ?'),
      deleteGuildChannels: db.prepare('DELETE FROM temp_voice_channels WHERE guild_id = ?'),
    };

    this.deleteGuildData = db.transaction((guildId: string) => {
      this.sql.deleteGuildTargets.run(guildId);
      this.sql.deleteGuildChannels.run(guildId);
    });
  }

  upsertTarget(target: TempVoiceTarget): void {
    this.sql.upsertTarget.run(target);
  }

  getTarget(channelId: string): TempVoiceTarget | undefined {
    const row = this.sql.getTarget.get(channelId) as TargetRow | undefined;
    return row && toTarget(row);
  }

  listTargets(guildId: string): TempVoiceTarget[] {
    return (this.sql.listTargets.all(guildId) as TargetRow[]).map(toTarget);
  }

  listAllTargets(): TempVoiceTarget[] {
    return (this.sql.listAllTargets.all() as TargetRow[]).map(toTarget);
  }

  deleteTarget(channelId: string): boolean {
    return this.sql.deleteTarget.run(channelId).changes > 0;
  }

  insertChannel(record: TempVoiceChannelRecord): void {
    this.sql.insertChannel.run(record);
  }

  getChannel(channelId: string): TempVoiceChannelRecord | undefined {
    const row = this.sql.getChannel.get(channelId) as ChannelRow | undefined;
    return row && toChannel(row);
  }

  listAllChannels(): TempVoiceChannelRecord[] {
    return (this.sql.listAllChannels.all() as ChannelRow[]).map(toChannel);
  }

  countChannelsByTarget(targetId: string): number {
    return (this.sql.countByTarget.get(targetId) as { n: number }).n;
  }

  setOwner(channelId: string, ownerId: string | null): void {
    this.sql.setOwner.run(ownerId, channelId);
  }

  deleteChannel(channelId: string): void {
    this.sql.deleteChannel.run(channelId);
  }

  readonly deleteGuildData: (guildId: string) => void;
}
