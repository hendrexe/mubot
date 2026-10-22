import type { Db } from '../../database';

/** Configuration for tournament results reporting. */
export interface TournamentResultsConfig {
  /** The unique ID of the tournament. */
  tournamentId: string;
  /** The Discord guild ID. */
  guildId: string;
  /** The Discord channel ID where results are posted. */
  channelId: string;
  /** The timestamp when the configuration was created. */
  createdAt: number;
}

/** A team being followed in a tournament; completed matches are announced in `channelId`. */
export interface TeamMatchWatch {
  id: number;
  guildId: string;
  channelId: string;
  tournamentId: string;
  tournamentName: string;
  /** The team's lineup ID within the tournament. */
  lineupId: string;
  teamName: string;
  createdAt: number;
}

export type NewTeamMatchWatch = Omit<TeamMatchWatch, 'id'>;

/** Persistence port for tournament results configurations. */
export interface ChallengerModeRepository {
  upsertConfig(config: TournamentResultsConfig): void;
  getConfig(tournamentId: string): TournamentResultsConfig | undefined;
  deleteConfig(tournamentId: string): boolean;
  addWatch(watch: NewTeamMatchWatch): TeamMatchWatch;
  findWatch(tournamentId: string, lineupId: string, channelId: string): TeamMatchWatch | undefined;
  listWatches(guildId: string): TeamMatchWatch[];
  allWatches(): TeamMatchWatch[];
  removeWatch(guildId: string, id: number): boolean;
  dropWatch(id: number): void;
  isReported(watchId: number, matchId: string): boolean;
  markReported(watchId: number, matchId: string): void;
}

interface WatchRow {
  id: number;
  guild_id: string;
  channel_id: string;
  tournament_id: string;
  tournament_name: string;
  lineup_id: string;
  team_name: string;
  created_at: number;
}

const toWatch = (row: WatchRow): TeamMatchWatch => ({
  id: row.id,
  guildId: row.guild_id,
  channelId: row.channel_id,
  tournamentId: row.tournament_id,
  tournamentName: row.tournament_name,
  lineupId: row.lineup_id,
  teamName: row.team_name,
  createdAt: row.created_at,
});

interface ConfigRow {
  tournament_id: string;
  guild_id: string;
  channel_id: string;
  created_at: number;
}

export class SqliteChallengerModeRepository implements ChallengerModeRepository {
  private readonly sql;

  constructor(db: Db) {
    this.sql = {
      upsertConfig: db.prepare(`
        INSERT INTO tournament_results_configs
          (tournament_id, guild_id, channel_id, created_at)
        VALUES
          (@tournamentId, @guildId, @channelId, @createdAt)
        ON CONFLICT(tournament_id) DO UPDATE SET
          guild_id    = excluded.guild_id,
          channel_id  = excluded.channel_id,
          created_at  = excluded.created_at
      `),
      getConfig: db.prepare('SELECT * FROM tournament_results_configs WHERE tournament_id = ?'),
      deleteConfig: db.prepare('DELETE FROM tournament_results_configs WHERE tournament_id = ?'),
      addWatch: db.prepare(`
        INSERT INTO team_match_watches
          (guild_id, channel_id, tournament_id, tournament_name, lineup_id, team_name, created_at)
        VALUES
          (@guildId, @channelId, @tournamentId, @tournamentName, @lineupId, @teamName, @createdAt)
      `),
      findWatch: db.prepare(
        'SELECT * FROM team_match_watches WHERE tournament_id = ? AND lineup_id = ? AND channel_id = ?',
      ),
      listWatches: db.prepare('SELECT * FROM team_match_watches WHERE guild_id = ? ORDER BY id'),
      allWatches: db.prepare('SELECT * FROM team_match_watches ORDER BY id'),
      removeWatch: db.prepare('DELETE FROM team_match_watches WHERE guild_id = ? AND id = ?'),
      dropWatch: db.prepare('DELETE FROM team_match_watches WHERE id = ?'),
      isReported: db.prepare(
        'SELECT 1 FROM team_match_reported WHERE watch_id = ? AND match_id = ?',
      ),
      markReported: db.prepare(
        'INSERT OR IGNORE INTO team_match_reported (watch_id, match_id) VALUES (?, ?)',
      ),
    };
  }

  addWatch(watch: NewTeamMatchWatch): TeamMatchWatch {
    const id = Number(this.sql.addWatch.run(watch).lastInsertRowid);
    return { id, ...watch };
  }

  findWatch(tournamentId: string, lineupId: string, channelId: string): TeamMatchWatch | undefined {
    const row = this.sql.findWatch.get(tournamentId, lineupId, channelId) as WatchRow | undefined;
    return row && toWatch(row);
  }

  listWatches(guildId: string): TeamMatchWatch[] {
    return (this.sql.listWatches.all(guildId) as WatchRow[]).map(toWatch);
  }

  allWatches(): TeamMatchWatch[] {
    return (this.sql.allWatches.all() as WatchRow[]).map(toWatch);
  }

  removeWatch(guildId: string, id: number): boolean {
    return this.sql.removeWatch.run(guildId, id).changes > 0;
  }

  dropWatch(id: number): void {
    this.sql.dropWatch.run(id);
  }

  isReported(watchId: number, matchId: string): boolean {
    return this.sql.isReported.get(watchId, matchId) !== undefined;
  }

  markReported(watchId: number, matchId: string): void {
    this.sql.markReported.run(watchId, matchId);
  }

  upsertConfig(config: TournamentResultsConfig): void {
    this.sql.upsertConfig.run(config);
  }

  getConfig(tournamentId: string): TournamentResultsConfig | undefined {
    const row = this.sql.getConfig.get(tournamentId) as ConfigRow | undefined;
    if (!row) return undefined;
    return {
      tournamentId: row.tournament_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      createdAt: row.created_at,
    };
  }

  deleteConfig(tournamentId: string): boolean {
    return this.sql.deleteConfig.run(tournamentId).changes > 0;
  }
}
