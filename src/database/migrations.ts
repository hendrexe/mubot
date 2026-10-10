import type { Db } from './index';

/**
 * Append-only list of schema migrations. The index + 1 is stored in `PRAGMA user_version`, so
 * never edit or reorder existing entries – add a new one instead.
 */
const migrations: readonly string[] = [
  /* 1 – temporary voice channels */
  `
  CREATE TABLE temp_voice_targets (
    channel_id    TEXT PRIMARY KEY,
    guild_id      TEXT NOT NULL,
    category_id   TEXT,
    name_template TEXT,
    user_limit    INTEGER,
    bitrate       INTEGER,
    created_by    TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX idx_temp_voice_targets_guild ON temp_voice_targets (guild_id);

  CREATE TABLE temp_voice_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    owner_id   TEXT,
    target_id  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_temp_voice_channels_guild ON temp_voice_channels (guild_id);
  CREATE INDEX idx_temp_voice_channels_target ON temp_voice_channels (target_id);
  `,
];

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;

  for (let version = current; version < migrations.length; version++) {
    const sql = migrations[version];
    if (!sql) continue;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
