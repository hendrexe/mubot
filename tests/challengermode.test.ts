import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database';
import { SqliteChallengerModeRepository } from '../src/modules/challengermode/repository';
import {
  extractUuid,
  findLineup,
  type MatchSummary,
  type RosterLineup,
} from '../src/modules/challengermode/service';
import { describeMatch } from '../src/modules/challengermode/watcher';

const roster: RosterLineup[] = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'UL Tegridy',
    team: { id: '021fda3a-1b76-4c6c-5410-08df1e6a7107', name: 'UL Tegridy' },
  },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Ice RigBy', team: null },
];

describe('extractUuid', () => {
  it('reads IDs from links and raw values', () => {
    const id = '70af0d1c-6f7a-423c-35ba-08df10190155';
    expect(
      extractUuid(`https://www.challengermode.com/s/IrelandCollegiate/tournaments/${id}`),
    ).toBe(id);
    expect(extractUuid(id.toUpperCase())).toBe(id);
    expect(extractUuid('UL Tegridy')).toBeUndefined();
  });
});

describe('findLineup', () => {
  it('matches by team link, lineup id, exact and partial name', () => {
    const byTeam = findLineup(
      roster,
      'https://www.challengermode.com/teams/021fda3a-1b76-4c6c-5410-08df1e6a7107',
    );
    expect(byTeam?.name).toBe('UL Tegridy');
    expect(findLineup(roster, 'aaaaaaaa-0000-0000-0000-000000000002')?.name).toBe('Ice RigBy');
    expect(findLineup(roster, 'ice rigby')?.name).toBe('Ice RigBy');
    expect(findLineup(roster, 'rig')?.name).toBe('Ice RigBy');
    expect(findLineup(roster, 'nobody')).toBeUndefined();
  });
});

describe('describeMatch', () => {
  const match: MatchSummary = {
    id: 'm1',
    title: 'Match 1',
    state: 'COMPLETED',
    bestOf: 3,
    startedAt: null,
    lineups: [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ],
    scores: [2, 1],
  };

  it('reports from the watched team perspective', () => {
    expect(describeMatch('a', match)).toMatchObject({
      outcome: 'win',
      teamScore: 2,
      opponentScore: 1,
      opponent: 'Beta',
    });
    expect(describeMatch('b', match)).toMatchObject({
      outcome: 'loss',
      teamScore: 1,
      opponentScore: 2,
      opponent: 'Alpha',
    });
    expect(describeMatch('z', match)).toBeUndefined();
  });
});

describe('watch repository', () => {
  it('stores watches and reported matches', () => {
    const repo = new SqliteChallengerModeRepository(createDatabase(':memory:'));
    const watch = repo.addWatch({
      guildId: 'g',
      channelId: 'c',
      tournamentId: 't',
      tournamentName: 'T',
      lineupId: 'l',
      teamName: 'Team',
      createdAt: 1,
    });
    expect(repo.findWatch('t', 'l', 'c')?.id).toBe(watch.id);
    expect(repo.isReported(watch.id, 'm')).toBe(false);
    repo.markReported(watch.id, 'm');
    expect(repo.isReported(watch.id, 'm')).toBe(true);
    expect(repo.removeWatch('other', watch.id)).toBe(false);
    expect(repo.removeWatch('g', watch.id)).toBe(true);
    expect(repo.isReported(watch.id, 'm')).toBe(false);
  });
});
