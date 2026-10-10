import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database';
import {
  SqliteTempVoiceRepository,
  type TempVoiceTarget,
} from '../src/modules/tempVoice/repository';

const target: TempVoiceTarget = {
  channelId: 't1',
  guildId: 'g1',
  categoryId: null,
  nameTemplate: null,
  userLimit: null,
  bitrate: null,
  createdBy: 'admin',
  createdAt: 1,
};

describe('SqliteTempVoiceRepository', () => {
  let repo: SqliteTempVoiceRepository;

  beforeEach(() => {
    repo = new SqliteTempVoiceRepository(createDatabase(':memory:'));
  });

  it('round-trips and updates targets (upsert keeps created_by / created_at)', () => {
    repo.upsertTarget(target);
    expect(repo.getTarget('t1')).toEqual(target);

    repo.upsertTarget({ ...target, nameTemplate: 'Room', userLimit: 5, createdBy: 'someone-else' });
    expect(repo.getTarget('t1')).toEqual({ ...target, nameTemplate: 'Room', userLimit: 5 });
    expect(repo.listTargets('g1')).toHaveLength(1);
  });

  it('deletes targets and reports whether anything was deleted', () => {
    repo.upsertTarget(target);
    expect(repo.deleteTarget('t1')).toBe(true);
    expect(repo.deleteTarget('t1')).toBe(false);
  });

  it('manages temp channel records and ownership', () => {
    repo.insertChannel({
      channelId: 'c1',
      guildId: 'g1',
      ownerId: 'u1',
      targetId: 't1',
      createdAt: 1,
    });
    repo.insertChannel({
      channelId: 'c2',
      guildId: 'g1',
      ownerId: 'u2',
      targetId: 't1',
      createdAt: 2,
    });

    expect(repo.countChannelsByTarget('t1')).toBe(2);

    repo.setOwner('c1', null);
    expect(repo.getChannel('c1')?.ownerId).toBeNull();

    repo.deleteChannel('c1');
    expect(repo.getChannel('c1')).toBeUndefined();
    expect(repo.listAllChannels()).toHaveLength(1);
  });

  it('purges all data for a guild', () => {
    repo.upsertTarget(target);
    repo.upsertTarget({ ...target, channelId: 't2', guildId: 'g2' });
    repo.insertChannel({
      channelId: 'c1',
      guildId: 'g1',
      ownerId: 'u1',
      targetId: 't1',
      createdAt: 1,
    });

    repo.deleteGuildData('g1');

    expect(repo.listTargets('g1')).toHaveLength(0);
    expect(repo.listAllChannels()).toHaveLength(0);
    expect(repo.listTargets('g2')).toHaveLength(1);
  });
});
