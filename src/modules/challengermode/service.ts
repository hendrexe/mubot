import { env } from '../../config/env';
import { logger } from '../../core/logger';
import type { ChallengerModeRepository, NewTeamMatchWatch, TeamMatchWatch } from './repository';

const AUTH_URL = 'https://publicapi.challengermode.com/mk1/v1/auth/access_keys';
const GRAPHQL_URL = 'https://publicapi.challengermode.com/graphql';
/** Renew slightly before the real expiry to avoid racing it. */
const EXPIRY_MARGIN_MS = 60_000;
/** Used when the auth response carries no expiry. */
const DEFAULT_TOKEN_TTL_MS = 10 * 60_000;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Extracts a UUID from a raw ID or a Challengermode link. */
export function extractUuid(input: string): string | undefined {
  return UUID_RE.exec(input)?.[0].toLowerCase();
}

const TOURNAMENT_RESULTS_QUERY = `
  query TournamentResults($id: UUID!) {
    tournament(tournamentId: $id) {
      id
      name
      state
      attendance {
        roster {
          lineups {
            name
            placement {
              bestPlacement
              displayPlacement
            }
          }
        }
      }
    }
  }
`;

const TOURNAMENT_MATCHES_QUERY = `
  query TournamentMatches($id: UUID!) {
    tournament(tournamentId: $id) {
      id
      name
      state
      attendance {
        roster {
          lineups {
            id
            name
            team {
              id
              name
            }
          }
        }
      }
      matchSeries {
        id
        title
        state
        bestOf
        startedAt
        lineups {
          id
          name
        }
        results {
          lineupResults {
            lineupNumber
            score
          }
        }
      }
    }
  }
`;

export interface TournamentStanding {
  placement: number;
  displayPlacement: string;
  name: string;
}

export interface TournamentResults {
  id: string;
  name: string;
  state: string;
  standings: TournamentStanding[];
}

interface RawTournament {
  id: string;
  name: string | null;
  state: string;
  attendance: {
    roster: {
      lineups: {
        name: string;
        placement: { bestPlacement: number; displayPlacement: string } | null;
      }[];
    } | null;
  };
}

export interface RosterLineup {
  id: string;
  name: string;
  team: { id: string; name: string } | null;
}

export interface MatchSummary {
  id: string;
  title: string;
  state: string;
  bestOf: number;
  startedAt: string | null;
  /** Lineups in result order; `null` while a slot is still undecided. */
  lineups: ({ id: string; name: string } | null)[];
  /** Scores by lineup index. */
  scores: (number | null)[];
}

export interface TournamentMatches {
  id: string;
  name: string;
  state: string;
  roster: RosterLineup[];
  matches: MatchSummary[];
}

interface RawMatches {
  id: string;
  name: string | null;
  state: string;
  attendance: { roster: { lineups: RosterLineup[] } | null };
  matchSeries: {
    id: string;
    title: string;
    state: string;
    bestOf: number;
    startedAt: string | null;
    lineups: ({ id: string; name: string } | null)[];
    results: { lineupResults: { lineupNumber: number; score: number | null }[] } | null;
  }[];
}

interface AccessKeyResponse {
  value: string;
  expiresAt?: string;
}

/** Finds the roster lineup referred to by a lineup/team ID, team link or (partial) team name. */
export function findLineup(
  roster: readonly RosterLineup[],
  input: string,
): RosterLineup | undefined {
  const id = extractUuid(input);
  if (id) {
    return roster.find((l) => l.id.toLowerCase() === id || l.team?.id.toLowerCase() === id);
  }
  const needle = input.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = roster.find(
    (l) => l.name.toLowerCase() === needle || l.team?.name.toLowerCase() === needle,
  );
  if (exact) return exact;
  const partial = roster.filter((l) => l.name.toLowerCase().includes(needle));
  return partial.length === 1 ? partial[0] : undefined;
}

export class ChallengerModeService {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  private pendingToken?: Promise<string>;

  constructor(
    private readonly repository: ChallengerModeRepository,
    private readonly refreshKey: string = env.CHALLENGERMODE_REFRESH_KEY,
  ) {}

  /** Exchanges the long-lived refresh key for a short-lived access token (cached). */
  private getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - EXPIRY_MARGIN_MS) {
      return Promise.resolve(this.accessToken);
    }
    this.pendingToken ??= this.fetchAccessToken().finally(() => {
      this.pendingToken = undefined;
    });
    return this.pendingToken;
  }

  private async fetchAccessToken(): Promise<string> {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshKey: this.refreshKey }),
    });
    if (!response.ok) {
      throw new Error(
        `ChallengerMode authentication failed: ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as AccessKeyResponse;
    if (!body.value) throw new Error('ChallengerMode authentication returned no access token');

    const expiresAt = body.expiresAt ? Date.parse(body.expiresAt) : NaN;
    this.accessToken = body.value;
    this.accessTokenExpiresAt = Number.isFinite(expiresAt)
      ? expiresAt
      : Date.now() + DEFAULT_TOKEN_TTL_MS;
    return body.value;
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const run = async (token: string) =>
      fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });

    let response = await run(await this.getAccessToken());
    if (response.status === 401) {
      this.accessToken = undefined;
      response = await run(await this.getAccessToken());
    }
    if (!response.ok) {
      throw new Error(`ChallengerMode request failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message).join('; '));
    }
    if (!body.data) throw new Error('ChallengerMode returned no data');
    return body.data;
  }

  /** Fetches final tournament standings from the ChallengerMode GraphQL API. */
  async getTournamentResults(tournamentId: string): Promise<TournamentResults> {
    try {
      const data = await this.query<{ tournament: RawTournament | null }>(
        TOURNAMENT_RESULTS_QUERY,
        {
          id: tournamentId,
        },
      );
      const tournament = data.tournament;
      if (!tournament) throw new Error('Tournament not found');

      const standings = (tournament.attendance.roster?.lineups ?? [])
        .filter((l) => l.placement)
        .map((l) => ({
          placement: l.placement!.bestPlacement,
          displayPlacement: l.placement!.displayPlacement,
          name: l.name,
        }))
        .sort((a, b) => a.placement - b.placement);
      return {
        id: tournament.id,
        name: tournament.name ?? 'Tournament',
        state: tournament.state,
        standings,
      };
    } catch (error) {
      logger.error({ err: error, tournamentId }, 'Error fetching ChallengerMode results');
      throw error;
    }
  }

  /** Fetches the roster and every match of a tournament. Returns undefined if it does not exist. */
  async getTournamentMatches(tournamentId: string): Promise<TournamentMatches | undefined> {
    const data = await this.query<{ tournament: RawMatches | null }>(TOURNAMENT_MATCHES_QUERY, {
      id: tournamentId,
    });
    const t = data.tournament;
    if (!t) return undefined;
    return {
      id: t.id,
      name: t.name ?? 'Tournament',
      state: t.state,
      roster: t.attendance.roster?.lineups ?? [],
      matches: t.matchSeries.map((m) => {
        const scores: (number | null)[] = m.lineups.map(() => null);
        for (const r of m.results?.lineupResults ?? []) scores[r.lineupNumber] = r.score;
        return {
          id: m.id,
          title: m.title,
          state: m.state,
          bestOf: m.bestOf,
          startedAt: m.startedAt,
          lineups: m.lineups,
          scores,
        };
      }),
    };
  }

  /** Returns the configured Discord channel for a tournament, if any. */
  getReportingChannel(tournamentId: string): string | undefined {
    return this.repository.getConfig(tournamentId)?.channelId;
  }

  /** Upserts the reporting configuration for a tournament. */
  upsertConfig(tournamentId: string, channelId: string, guildId: string): void {
    this.repository.upsertConfig({ tournamentId, channelId, guildId, createdAt: Date.now() });
  }

  /**
   * Starts watching a team. Matches that are already completed are marked as reported so only
   * future results are announced. Throws an Error whose message is a reason code on bad input.
   */
  async addTeamWatch(
    guildId: string,
    channelId: string,
    tournamentInput: string,
    teamInput: string,
  ): Promise<{ watch: TeamMatchWatch; created: boolean }> {
    const tournamentId = extractUuid(tournamentInput);
    if (!tournamentId) throw new Error('INVALID_TOURNAMENT');

    const tournament = await this.getTournamentMatches(tournamentId);
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');

    const lineup = findLineup(tournament.roster, teamInput);
    if (!lineup) throw new Error('TEAM_NOT_FOUND');

    const existing = this.repository.findWatch(tournamentId, lineup.id, channelId);
    if (existing) return { watch: existing, created: false };

    const draft: NewTeamMatchWatch = {
      guildId,
      channelId,
      tournamentId,
      tournamentName: tournament.name,
      lineupId: lineup.id,
      teamName: lineup.team?.name ?? lineup.name,
      createdAt: Date.now(),
    };
    const watch = this.repository.addWatch(draft);
    for (const m of tournament.matches) {
      if (m.state === 'COMPLETED' && m.lineups.some((l) => l?.id === lineup.id)) {
        this.repository.markReported(watch.id, m.id);
      }
    }
    return { watch, created: true };
  }

  /** Most recent completed matches (newest first) of a team; throws reason codes like addTeamWatch. */
  async getTeamLastResults(
    tournamentInput: string,
    teamInput: string,
    count: number,
  ): Promise<{
    tournament: TournamentMatches;
    teamName: string;
    lineupId: string;
    matches: MatchSummary[];
  }> {
    const tournamentId = extractUuid(tournamentInput);
    if (!tournamentId) throw new Error('INVALID_TOURNAMENT');
    const tournament = await this.getTournamentMatches(tournamentId);
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    const lineup = findLineup(tournament.roster, teamInput);
    if (!lineup) throw new Error('TEAM_NOT_FOUND');

    const time = (m: MatchSummary) => (m.startedAt ? Date.parse(m.startedAt) : 0);
    const matches = tournament.matches
      .filter(
        (m) =>
          m.state === 'COMPLETED' &&
          m.lineups.some((l) => l?.id === lineup.id) &&
          m.lineups.some((l) => l && l.id !== lineup.id),
      )
      .sort((a, b) => time(b) - time(a))
      .slice(0, count);
    return { tournament, teamName: lineup.team?.name ?? lineup.name, lineupId: lineup.id, matches };
  }

  listWatches(guildId: string): TeamMatchWatch[] {
    return this.repository.listWatches(guildId);
  }

  removeWatch(guildId: string, id: number): boolean {
    return this.repository.removeWatch(guildId, id);
  }

  allWatches(): TeamMatchWatch[] {
    return this.repository.allWatches();
  }

  isReported(watchId: number, matchId: string): boolean {
    return this.repository.isReported(watchId, matchId);
  }

  markReported(watchId: number, matchId: string): void {
    this.repository.markReported(watchId, matchId);
  }

  /** Deletes a watch that can no longer produce results (e.g. the tournament has ended). */
  dropWatch(watchId: number): void {
    this.repository.dropWatch(watchId);
  }
}
