# MultiBot

A modular, multi-purpose Discord bot built with **discord.js v14** and **TypeScript**.
The first feature is **temporary voice channels**.

- **Temp voice channels** – admins designate a _target_ channel; joining it creates a personal
  channel and moves you in. The creator controls (only) that channel. It is deleted when empty.
- **Config-first** – every base setting lives in one typed file: [`src/config/bot.config.ts`](src/config/bot.config.ts).
- **Production-minded** – SQLite persistence with migrations, crash-safe startup reconciliation,
  structured logging, validated env, graceful shutdown, tests, CI, Docker.

## Quick start

```bash
npm install
cp .env.example .env        # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
npm run invite              # prints an invite link with exactly the permissions needed
npm run commands:deploy     # registers slash commands (set DEV_GUILD_ID for instant updates)
npm run dev                 # start with hot reload
```

Requires Node.js ≥ 22 (a `better-sqlite3` requirement). No privileged intents are needed (only `Guilds` and `GuildVoiceStates`).

### Required bot permissions

| Permission                 | Why                                                                            |
| -------------------------- | ------------------------------------------------------------------------------ |
| Manage Channels            | create / rename / delete temporary channels                                    |
| Move Members               | move the user into their new channel                                           |
| Manage Roles               | Discord requires it to edit permission overwrites (lock, hide, permit, reject) |
| View Channel, Connect      | see and move people into the channels it creates                               |
| Send Messages, Embed Links | welcome / ownership messages in the voice channel's text chat _(optional)_     |

`/tempvc setup` checks these and tells you exactly what is missing.

## Using temporary voice channels

**Admins** (anyone with _Manage Channels_ – configurable) :

| Command                                                                     | What it does                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/tempvc setup [channel] [category] [name-template] [user-limit] [bitrate]` | Designate a target. Omit `channel` and the bot creates one for you. |
| `/tempvc edit channel:… [reset] [options…]`                                 | Change a target's settings (`reset` clears overrides first).        |
| `/tempvc remove channel:…`                                                  | Stop using a channel as a target (it is not deleted).               |
| `/tempvc list`                                                              | Show targets, their settings and how many temp channels are live.   |

Name templates support `{displayName}` and `{username}`, e.g. `🎮 {displayName}'s lounge`.

**Channel owners** – `/voice …` only ever affects the temp channel you are _currently in_ and _own_:

`name` · `limit` · `bitrate` · `lock` / `unlock` · `hide` / `unhide` · `permit` · `reject` ·
`kick` · `reset-user` · `transfer` · `claim` · `info`

When the owner leaves while others stay, ownership **transfers** automatically (or the channel
becomes **unclaimed** – see `ownerLeaveBehavior`). Anyone inside can then `/voice claim` it.

## Configuration

Three layers, from broad to specific:

1. **`.env`** – secrets and deployment (token, DB path, log level). Validated on startup.
2. **`src/config/bot.config.ts`** – global defaults and feature flags. Every option is documented
   in [`src/config/types.ts`](src/config/types.ts). Highlights:

   | Option                            | Default                   | Meaning                                                 |
   | --------------------------------- | ------------------------- | ------------------------------------------------------- |
   | `tempVoice.enabled`               | `true`                    | Feature flag (also removes the commands on next deploy) |
   | `tempVoice.adminPermission`       | `ManageChannels`          | Who may run `/tempvc`                                   |
   | `tempVoice.nameTemplate`          | `{displayName}'s Channel` | Default channel name                                    |
   | `tempVoice.userLimit` / `bitrate` | `null`                    | `null` = copy from the target channel                   |
   | `tempVoice.deleteDelayMs`         | `0`                       | Grace period before deleting an empty channel           |
   | `tempVoice.creationCooldownMs`    | `5000`                    | Anti-spam: min. time between creations per user         |
   | `tempVoice.ownerLeaveBehavior`    | `'transfer'`              | `'transfer'` or `'unclaimed'`                           |
   | `tempVoice.blockedWords`          | `[]`                      | Words not allowed in channel names                      |
   | `tempVoice.announcements`         | `true`                    | Welcome / ownership messages in the VC text chat        |

3. **Per target, at runtime** – `/tempvc setup` / `/tempvc edit` override name template, category,
   user limit and bitrate for one target. Anything not overridden falls back to layer 2.

## Project structure

```
src/
├── index.ts                  composition root: builds services, wires events, logs in
├── config/
│   ├── bot.config.ts         ← base settings (edit this)
│   ├── types.ts              typed, documented config shape
│   └── env.ts                zod-validated environment
├── core/                     framework glue: types, logger, errors, event/command registry
├── database/                 SQLite connection + versioned migrations
├── commands/                 slash commands (thin: parse input → call a service → respond)
├── events/                   gateway event handlers
├── modules/
│   └── tempVoice/            ← the feature
│       ├── service.ts        lifecycle: create / delete / ownership hand-off / startup sweep
│       ├── controls.ts       owner actions + all authorisation checks
│       ├── repository.ts     persistence port + SQLite implementation
│       ├── templates.ts      name rendering & sanitising
│       ├── messages.ts       embeds posted in the channel
│       └── permissions.ts    bot permission requirements
├── scripts/                  deploy-commands, invite-url
└── utils/                    respond helpers, rate limiter
tests/                        vitest (unit + lifecycle tests with fake Discord objects)
```

### Adding a new feature

1. Create `src/modules/<feature>/` with a service (business logic) and, if it needs storage, a
   repository + a new entry in `src/database/migrations.ts`.
2. Add its settings to `config/types.ts` and `config/bot.config.ts` (including an `enabled` flag).
3. Add slash commands in `src/commands/` and register them in `commands/index.ts`.
4. Add event handlers in `src/events/` and list them in `events/index.ts`.
5. Construct the service in `index.ts` and expose it on `AppContext` (`core/types.ts`).
6. Add any new gateway intents to `intents` in `bot.config.ts`; re-run `npm run commands:deploy`.

Throw `UserError` for anything the user should see; everything else is logged and shown as a
generic message.

## Scripts

| Script                                             | Purpose                                   |
| -------------------------------------------------- | ----------------------------------------- |
| `npm run dev`                                      | Run with hot reload (`tsx watch`)         |
| `npm run build` / `npm start`                      | Compile to `dist/` / run the compiled bot |
| `npm run commands:deploy [-- --global \| --clear]` | Register (or clear) slash commands        |
| `npm run invite`                                   | Print the bot invite link                 |
| `npm run lint` · `typecheck` · `test` · `format`   | Quality gates (all run in CI)             |

## Deployment

```bash
docker compose up -d --build     # uses .env, persists the SQLite DB in a volume
```

or `npm ci && npm run build && npm run commands:deploy:prod && npm start` under a process manager.
Commands deployed with `DEV_GUILD_ID` set are guild-scoped; run with `--global` for production, and
`--clear` on the other scope to avoid duplicate commands.

> **Native module note:** `better-sqlite3` ships prebuilt binaries for Linux (glibc + musl), macOS and
> Windows, so the project's `.npmrc` sets `ignore-scripts=true` and no compiler is needed. On an
> unusual platform run `npm rebuild better-sqlite3 --ignore-scripts=false`.

## Behaviour notes & known limitations

- **Lock** denies `@everyone` the _Connect_ permission. If your server grants Connect through
  specific roles on the category, those roles can still join – adjust your category permissions
  accordingly. Lock and hide are about newcomers; use `kick` / `reject` to remove people already inside.
- Temp channels **inherit the permissions of their category**. If the target is not in a category
  (and no `category` is set), new channels get server defaults.
- Discord allows about **2 renames per channel per 10 minutes**; the bot enforces this itself so
  commands never hang on a rate limit.
- Discord caps a category at **50 channels**. If a category is full, creation fails (logged) and the
  user simply stays in the target channel – point `category` at a roomy one.
- If the bot is offline while people leave, the startup **sweep** deletes the now-empty channels and
  repairs ownership.
