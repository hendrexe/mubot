import type { Client } from 'discord.js';
import { env } from '../../config/env';
import type { Logger } from '../../core/logger';
import { makeEmbed } from '../../utils/respond';
import type { TeamMatchWatch } from './repository';
import type { ChallengerModeService, MatchSummary } from './service';

const POLL_INTERVAL_MS = env.CHALLENGERMODE_POLL_INTERVAL_MINUTES * 60_000;

export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface MatchReport {
  outcome: MatchOutcome;
  teamScore: number;
  opponentScore: number;
  opponent: string;
}

/** Summarises a completed match from one lineup's point of view; undefined if it didn't play in it. */
export function describeMatch(lineupId: string, match: MatchSummary): MatchReport | undefined {
  const own = match.lineups.findIndex((l) => l?.id === lineupId);
  if (own === -1) return undefined;
  const other = match.lineups.findIndex((l, i) => i !== own && l);
  // A bye has no opponent, so there is nothing to announce.
  if (other === -1) return undefined;

  const teamScore = match.scores[own] ?? 0;
  const opponentScore = match.scores[other] ?? 0;
  const outcome: MatchOutcome =
    teamScore > opponentScore ? 'win' : teamScore < opponentScore ? 'loss' : 'draw';
  return {
    outcome,
    teamScore,
    opponentScore,
    opponent: match.lineups[other]?.name ?? 'Unknown',
  };
}

const HEADLINE: Record<MatchOutcome, string> = {
  win: '🏆 Victory',
  loss: '💔 Defeat',
  draw: '🤝 Draw',
};

/** Builds the announcement embed for one finished match. */
export function buildMatchEmbed(
  teamName: string,
  tournamentId: string,
  tournamentName: string,
  match: MatchSummary,
  report: MatchReport,
) {
  return makeEmbed(
    report.outcome === 'win' ? 'success' : report.outcome === 'loss' ? 'error' : 'info',
    `**${teamName}** ${report.teamScore} – ${report.opponentScore} **${report.opponent}**\n` +
      `${match.title} · Best of ${match.bestOf}\n` +
      `[View tournament](https://www.challengermode.com/tournaments/${tournamentId})`,
    `${HEADLINE[report.outcome]} – ${tournamentName}`,
  );
}

/** Polls ChallengerMode and announces finished matches of watched teams. */
export class MatchWatcher {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly client: Client,
    private readonly service: ChallengerModeService,
    private readonly logger: Logger,
    private readonly intervalMs: number = POLL_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs one polling cycle. Never throws; overlapping cycles are skipped. */
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const byTournament = new Map<string, TeamMatchWatch[]>();
      for (const watch of this.service.allWatches()) {
        const list = byTournament.get(watch.tournamentId) ?? [];
        list.push(watch);
        byTournament.set(watch.tournamentId, list);
      }

      for (const [tournamentId, watches] of byTournament) {
        try {
          await this.pollTournament(tournamentId, watches);
        } catch (err) {
          this.logger.error({ err, tournamentId }, 'Failed to poll tournament');
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async pollTournament(tournamentId: string, watches: TeamMatchWatch[]): Promise<void> {
    const tournament = await this.service.getTournamentMatches(tournamentId);
    if (!tournament) {
      for (const w of watches) this.service.dropWatch(w.id);
      return;
    }

    for (const watch of watches) {
      let allSent = true;
      for (const match of tournament.matches) {
        if (match.state !== 'COMPLETED' || this.service.isReported(watch.id, match.id)) continue;
        const report = describeMatch(watch.lineupId, match);
        if (!report) continue;

        if (await this.announce(watch, tournament.id, tournament.name, match, report)) {
          this.service.markReported(watch.id, match.id);
        } else {
          allSent = false;
        }
      }

      const finished = tournament.state === 'COMPLETED' || tournament.state === 'CANCELLED';
      if (finished && allSent) this.service.dropWatch(watch.id);
    }
  }

  /** Returns true when the message was posted, or can never be posted (channel gone). */
  private async announce(
    watch: TeamMatchWatch,
    tournamentId: string,
    tournamentName: string,
    match: MatchSummary,
    report: MatchReport,
  ): Promise<boolean> {
    try {
      const channel = await this.client.channels.fetch(watch.channelId).catch(() => null);
      if (!channel?.isSendable()) {
        this.logger.warn(
          { watchId: watch.id, channelId: watch.channelId },
          'Watch channel unavailable',
        );
        return false;
      }

      const embed = buildMatchEmbed(watch.teamName, tournamentId, tournamentName, match, report);
      await channel.send({ embeds: [embed] });
      return true;
    } catch (err) {
      this.logger.error(
        { err, watchId: watch.id, matchId: match.id },
        'Failed to post match result',
      );
      return false;
    }
  }
}
