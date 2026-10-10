import { ChannelType, Collection, type Client, type VoiceState } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { botConfig } from '../src/config/bot.config';
import type { TempVoiceConfig } from '../src/config/types';
import { UserError } from '../src/core/errors';
import { createDatabase } from '../src/database';
import { TempVoiceControls } from '../src/modules/tempVoice/controls';
import { SqliteTempVoiceRepository } from '../src/modules/tempVoice/repository';
import { TempVoiceService } from '../src/modules/tempVoice/service';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

const noopLogger: any = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeChannel(id: string, extra: Record<string, unknown> = {}): any {
  const channel: any = {
    id,
    type: ChannelType.GuildVoice,
    parentId: 'cat1',
    userLimit: 0,
    bitrate: 64_000,
    members: new Collection<string, any>(),
    permissionOverwrites: {
      cache: new Collection(),
      edit: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    isVoiceBased: () => true,
    delete: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    setName: vi.fn(async () => undefined),
    ...extra,
  };
  return channel;
}

function makeMember(guild: any, id: string, name: string, bot = false): any {
  const member: any = {
    id,
    guild,
    displayName: name,
    user: { username: name.toLowerCase(), bot },
    permissions: { any: () => false },
    voice: { channel: null, channelId: null },
  };
  member.voice.setChannel = vi.fn(async (channel: any) => {
    member.voice.channel = channel;
    member.voice.channelId = channel.id;
    channel.members.set(id, member);
  });
  return member;
}

function setup(overrides: Partial<TempVoiceConfig> = {}) {
  const config: TempVoiceConfig = { ...botConfig.tempVoice, creationCooldownMs: 0, ...overrides };
  const repo = new SqliteTempVoiceRepository(createDatabase(':memory:'));
  const controls = new TempVoiceControls(repo, config, noopLogger);

  const guild: any = {
    id: 'g1',
    available: true,
    maximumBitrate: 96_000,
    roles: { everyone: { id: 'g1' } },
    channels: { cache: new Collection<string, any>() },
  };
  const client = { user: { id: 'bot' }, guilds: { cache: new Collection([['g1', guild]]) } } as any;

  const created: any[] = [];
  guild.channels.create = vi.fn(async (options: any) => {
    const channel = makeChannel(`temp${created.length + 1}`, { name: options.name, guild });
    created.push(channel);
    guild.channels.cache.set(channel.id, channel);
    return channel;
  });

  const lobby = makeChannel('lobby', { name: 'Create', guild });
  guild.channels.cache.set('lobby', lobby);
  repo.upsertTarget({
    channelId: 'lobby',
    guildId: 'g1',
    categoryId: null,
    nameTemplate: null,
    userLimit: null,
    bitrate: null,
    createdBy: 'admin',
    createdAt: 1,
  });

  const service = new TempVoiceService(client as Client, repo, controls, config, noopLogger);

  /** Simulates Discord's voice event for a member switching channels. */
  const move = async (member: any, from: any, to: any) => {
    from?.members.delete(member.id);
    if (to) {
      to.members.set(member.id, member);
      member.voice.channel = to;
      member.voice.channelId = to.id;
    } else {
      member.voice.channel = null;
      member.voice.channelId = null;
    }
    await service.handleVoiceStateUpdate(
      { channelId: from?.id ?? null, channel: from, member } as unknown as VoiceState,
      { channelId: to?.id ?? null, channel: to, member } as unknown as VoiceState,
    );
  };

  return { service, controls, repo, guild, lobby, created, move, config };
}

describe('temporary voice lifecycle', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
  });

  it('creates a channel when a user joins the target and moves them into it', async () => {
    const alice = makeMember(h.guild, 'u1', 'Alice');
    await h.move(alice, null, h.lobby);

    expect(h.created).toHaveLength(1);
    expect(h.created[0].name).toBe("Alice's Channel");
    expect(alice.voice.setChannel).toHaveBeenCalledWith(h.created[0], expect.any(String));
    expect(h.repo.getChannel('temp1')).toMatchObject({ ownerId: 'u1', targetId: 'lobby' });
    expect(h.created[0].send).toHaveBeenCalledOnce(); // welcome message
  });

  it('ignores joins of non-target channels and of bots', async () => {
    const other = makeChannel('other');
    await h.move(makeMember(h.guild, 'u1', 'Alice'), null, other);
    await h.move(makeMember(h.guild, 'b1', 'Bot', true), null, h.lobby);
    expect(h.created).toHaveLength(0);
  });

  it('deletes the channel once everyone has left', async () => {
    const alice = makeMember(h.guild, 'u1', 'Alice');
    await h.move(alice, null, h.lobby);
    const temp = h.created[0];

    await h.move(alice, temp, null);

    expect(temp.delete).toHaveBeenCalledOnce();
    expect(h.repo.getChannel('temp1')).toBeUndefined();
  });

  it('keeps the channel while someone remains and transfers ownership when the owner leaves', async () => {
    const alice = makeMember(h.guild, 'u1', 'Alice');
    const bob = makeMember(h.guild, 'u2', 'Bob');
    await h.move(alice, null, h.lobby);
    const temp = h.created[0];
    await h.move(bob, null, temp);

    await h.move(alice, temp, null);

    expect(temp.delete).not.toHaveBeenCalled();
    expect(h.repo.getChannel('temp1')?.ownerId).toBe('u2');
  });

  it('leaves the channel unclaimed when configured, and allows claiming', async () => {
    const h2 = setup({ ownerLeaveBehavior: 'unclaimed' });
    const alice = makeMember(h2.guild, 'u1', 'Alice');
    const bob = makeMember(h2.guild, 'u2', 'Bob');
    await h2.move(alice, null, h2.lobby);
    const temp = h2.created[0];
    await h2.move(bob, null, temp);
    await h2.move(alice, temp, null);

    expect(h2.repo.getChannel('temp1')?.ownerId).toBeNull();
    await h2.controls.claim(bob);
    expect(h2.repo.getChannel('temp1')?.ownerId).toBe('u2');
  });

  it('removes the new channel if the user disconnects before being moved', async () => {
    const alice = makeMember(h.guild, 'u1', 'Alice');
    alice.voice.setChannel = vi.fn(async () => {
      throw new Error('Target user is not connected to voice.');
    });

    await h.move(alice, null, h.lobby);

    expect(h.created[0].delete).toHaveBeenCalledOnce();
    expect(h.repo.getChannel('temp1')).toBeUndefined();
  });

  it('enforces the creation cooldown per user', async () => {
    const h2 = setup({ creationCooldownMs: 60_000 });
    const alice = makeMember(h2.guild, 'u1', 'Alice');
    await h2.move(alice, null, h2.lobby);
    await h2.move(alice, h2.created[0], null);
    await h2.move(alice, null, h2.lobby);

    expect(h2.created).toHaveLength(1);
  });

  it('sweep() removes empty channels and stale records left over from downtime', async () => {
    h.repo.insertChannel({
      channelId: 'temp9',
      guildId: 'g1',
      ownerId: 'u1',
      targetId: 'lobby',
      createdAt: 1,
    });
    const stale = makeChannel('temp9', { guild: h.guild });
    h.guild.channels.cache.set('temp9', stale);
    h.repo.insertChannel({
      channelId: 'gone',
      guildId: 'g1',
      ownerId: 'u1',
      targetId: 'lobby',
      createdAt: 1,
    });

    await h.service.sweep();

    expect(stale.delete).toHaveBeenCalledOnce();
    expect(h.repo.getChannel('temp9')).toBeUndefined();
    expect(h.repo.getChannel('gone')).toBeUndefined();
  });
});

describe('owner controls', () => {
  it('only lets the owner of the channel they are in change it', async () => {
    const h = setup();
    const alice = makeMember(h.guild, 'u1', 'Alice');
    const bob = makeMember(h.guild, 'u2', 'Bob');
    await h.move(alice, null, h.lobby);
    const temp = h.created[0];
    await h.move(bob, null, temp);

    await expect(h.controls.rename(bob, 'Hijacked')).rejects.toBeInstanceOf(UserError);
    expect(temp.setName).not.toHaveBeenCalled();

    await expect(h.controls.rename(alice, 'Chill  zone')).resolves.toBe('Chill zone');
    expect(temp.setName).toHaveBeenCalledWith('Chill zone', expect.any(String));
  });

  it('refuses to act when the member is not in a temporary channel', async () => {
    const h = setup();
    const carol = makeMember(h.guild, 'u3', 'Carol');
    await expect(h.controls.setLocked(carol, true)).rejects.toThrow(
      /Join a temporary voice channel/,
    );

    carol.voice.channel = h.lobby; // the target lobby itself is not a temp channel
    await expect(h.controls.setLocked(carol, true)).rejects.toThrow(
      /not a temporary voice channel/,
    );
  });

  it('rate-limits renames to respect Discord’s channel-rename limit', async () => {
    const h = setup();
    const alice = makeMember(h.guild, 'u1', 'Alice');
    await h.move(alice, null, h.lobby);

    await h.controls.rename(alice, 'One');
    await h.controls.rename(alice, 'Two');
    await expect(h.controls.rename(alice, 'Three')).rejects.toThrow(/Try again/);
  });

  it('lock denies @everyone Connect but keeps the owner connected', async () => {
    const h = setup();
    const alice = makeMember(h.guild, 'u1', 'Alice');
    await h.move(alice, null, h.lobby);
    const temp = h.created[0];

    await h.controls.setLocked(alice, true);

    expect(temp.permissionOverwrites.edit).toHaveBeenCalledWith(
      h.guild.roles.everyone,
      { Connect: false },
      expect.any(Object),
    );
    expect(temp.permissionOverwrites.edit).toHaveBeenCalledWith(
      'u1',
      { Connect: true, ViewChannel: true },
      expect.any(Object),
    );
  });
});
