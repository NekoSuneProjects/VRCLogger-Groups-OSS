# VRCLogger — Discord Bot + Dashboard

One Discord bot serving **exactly one Discord server**, tracking **exactly one
VRChat group**.

This is the only component that stores data. It owns the database, the staff
list, the blacklists, the API keys, and the group/member caches. The backend is
a stateless VRChat proxy; the desktop client is a read-only consumer.

```
  backend  <──  [ this bot + dashboard ]  <──  client
  (VRChat)      MySQL + SQLite                 (desktop app)
```

## Contents

- [Requirements](#requirements)
- [Install from source](#install-from-source)
- [Configuration](#configuration)
- [Discord application setup](#discord-application-setup)
- [First run in Discord](#first-run-in-discord)
- [Slash commands](#slash-commands)
- [Web dashboard](#web-dashboard)
- [Client API](#client-api)
- [Group and member cache](#group-and-member-cache)
- [Storage layout](#storage-layout)
- [Migrating from the multi-server build](#migrating-from-the-multi-server-build)
- [Troubleshooting](#troubleshooting)

## Requirements

- **Node.js 20+**
- **MySQL or MariaDB** — shared tables (blacklists, staff, API keys, caches)
- A **Discord application** with a bot user
- The **[backend](../backend/README.md)** running and reachable

## Install from source

```bash
git clone <your-fork-url>
cd VRCLogger-Groups-OSS/discord
npm install
cp config/settings-template.json config/settings.json
```

Then edit `config/settings.json` (see below) and start:

```bash
npm start      # equivalent to: node .
```

On Windows there is also `run-dev.bat`.

### Run as a service

```bash
pm2 start index.js --name vrclogger-bot
```

## Configuration

Everything lives in **one file**: `config/settings.json`. It is gitignored.

### Minimum viable config

```json
{
  "token": "YOUR_DISCORD_BOT_TOKEN",
  "clientid": "YOUR_DISCORD_APP_ID",
  "TestingServerID": "123456789012345678",
  "SQL": {
    "HOST": "127.0.0.1",
    "PORT": 3306,
    "USER": "vrclogger",
    "PASS": "secret",
    "DB": "VRCLogger"
  },
  "VRCAPI": {
    "VRCBackEndURL": "http://127.0.0.1:3688",
    "groupid": "grp_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "groupName": "My Group",
    "ACCESS": {
      "ban": ["owner", "co-owner", "admin"],
      "unban": ["owner", "co-owner"],
      "blacklister": ["owner", "co-owner", "admin"],
      "reacted": ["owner", "co-owner"],
      "requester": ["owner", "co-owner"],
      "tags": ["owner", "co-owner", "admin", "mod", "trainee", "it-tech"],
      "userlookup": ["owner", "co-owner", "admin", "it-tech"]
    }
  }
}
```

### Top level

| Key | Meaning |
| --- | --- |
| `token` | Discord bot token. **Required.** |
| `clientid` | Discord application id. |
| `TestingServerID` | The one Discord server this bot serves. **Required.** Interactions from any other server are ignored. |
| `SQL` | MySQL/MariaDB connection. **Required.** |
| `developerID` | Discord user ids with bot-owner commands and admin panel access. |
| `helpdesk` | Defaults used when building a VRChat moderation report. |
| `DASHBOARD` | Web dashboard settings — see [below](#web-dashboard). |

### `VRCAPI` — the one VRChat group

| Key | Meaning |
| --- | --- |
| `VRCBackEndURL` | URL of the [backend](../backend/README.md). **Required.** |
| `groupid` | The VRChat group id (`grp_...`). **Required.** |
| `groupName` | Display name. `/setup` refreshes this from VRChat. |
| `VRCProxyNode` | Optional proxy node URL. |
| `ownerDiscordIds` | Discord ids treated as group owners. |
| `ACCESS` | Which staff roles may perform which action. |
| `LoggerCategoryId` | Discord category holding the log channels. Written by `/setup`. |
| `LoggerTextChannel` | Map of event type → channel id. Written by `/setup`. |
| `reqnotify` | `{ enable, REQCHANNEL }` for join-request notifications. |
| `globalAnalytics` | `{ autoShare }` — records moderation actions to the shared analytics store. |
| `groupCacheIntervalMs` | How often to refresh the group/member cache. Default `900000` (15 min). |

### `ACCESS` roles

Roles come from the staff table (`/vrcaddstaff`, `/vrcaddadmin`), not from
Discord roles. Recognised values: `owner`, `co-owner`, `admin`, `mod`,
`trainee`, `it-tech`.

## Discord application setup

1. Create an application at <https://discord.com/developers/applications>.
2. **Bot** tab → add a bot → copy the token into `token`.
3. Enable these **Privileged Gateway Intents**:
   - Server Members Intent
   - Message Content Intent
   - Presence Intent
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`.
   Permissions: Manage Channels, View Channels, Send Messages, Send Messages in
   Threads, Create Public Threads, Embed Links, Attach Files, Read Message
   History, Manage Messages.
5. Invite the bot to the server whose id you put in `TestingServerID`.

For dashboard login you also need, under **OAuth2**, a client secret and this
redirect URI:

```
http://127.0.0.1:3434/auth/discord/callback
```

## First run in Discord

1. Start the backend, then the bot.
2. Run **`/setup`** — creates the logger category and channels, and writes their
   ids back into `config/settings.json`.
3. Add staff with **`/vrcaddadmin`** and **`/vrcaddstaff`** so they can use the
   moderation commands and buttons.
4. Optional: **`/globalautoshare state:on`** to record actions to the shared
   analytics store.

Slash commands are registered **to the one configured server**, so they appear
immediately — there is no global propagation delay. Any leftover global commands
from older builds are cleared on start.

## Slash commands

### VRChat moderation

| Command | Description |
| --- | --- |
| `/vrcban` | Ban a VRChat user from the group (opens a modal) |
| `/vrcunban` | Unban a VRChat user |
| `/vrccheck` | Look up a VRChat account |
| `/vrcuserbl` | Manage the user blacklist |
| `/vrcavibl` | Manage the avatar blacklist |
| `/vrcgroupsbl` | Manage the group blacklist |

### Staff

| Command | Description |
| --- | --- |
| `/vrcaddstaff` | Add a staff member |
| `/vrcaddadmin` | Add an admin |
| `/vcrupdatestaff` | Update a staff member's role |
| `/vrcremovestaff` | Deactivate a staff member |
| `/vrcremoveadmin` | Deactivate an admin |
| `/vrcmanageapikey` | Manage client API keys for staff |

### Setup and analytics

| Command | Description |
| --- | --- |
| `/setup` | Create/reuse logger channels and save their ids |
| `/removelogger` | Delete logger channels and clear the saved mappings |
| `/globalautoshare state:<on\|off>` | Toggle shared analytics for the group |
| `/globalhistory` | Shared community analytics for a VRChat user |

### General / owner

`/help`, `/ping`, `/aboutbot`, and `/uptime`, `/restart`, `/reloadcmd`
(developers only).

> None of these take a `groupid` option any more — there is only one group.

## Web dashboard

Served by the bot itself at `DASHBOARD.baseUrl` (default
`http://127.0.0.1:3434/dashboard`).

Sign-in is Discord OAuth. Access is granted to the server owner, users with
Discord Administrator, and active staff — each seeing only what their role
allows.

```json
"DASHBOARD": {
  "enabled": true,
  "host": "0.0.0.0",
  "port": 3434,
  "baseUrl": "http://127.0.0.1:3434",
  "discordClientId": "YOUR_DISCORD_APP_CLIENT_ID",
  "discordClientSecret": "YOUR_DISCORD_APP_CLIENT_SECRET",
  "sessionSecret": "CHANGE_ME_TO_A_LONG_RANDOM_SECRET",
  "adminDiscordIds": ["OPTIONAL_EXTRA_BOT_ADMIN_ID"],
  "cache": {
    "enabled": true,
    "ttlSeconds": 300,
    "namespace": "banlogger:dashboard",
    "redis": {
      "enabled": false,
      "url": "redis://:password@127.0.0.1:6379/0",
      "host": "127.0.0.1",
      "port": 6379,
      "username": "",
      "password": "",
      "db": 0,
      "tls": false,
      "timeoutMs": 2000
    }
  }
}
```

If `DASHBOARD.baseUrl` is a public domain, set it here **and** add
`<baseUrl>/auth/discord/callback` as a redirect URI in the Discord portal.

Redis is optional. Without it the dashboard uses an in-process memory cache,
which is fine for a single instance.

### Tabs

Overview, Events, Users, Members, Blacklists, Staff, Global History, Client API,
Setup, Join Invites.

### Admin pages

Require the signed-in user to be in `developerID` or `DASHBOARD.adminDiscordIds`:

- `/admin/safety` — safety lists
- `/safetyjson.json`, `/domains.json` — public safety feeds

Public policy pages are at `/privacy` and `/terms`.

### Environment overrides

`DASHBOARD_ENABLED`, `DASHBOARD_HOST`, `DASHBOARD_PORT`, `DASHBOARD_BASE_URL`,
`DASHBOARD_DISCORD_CLIENT_ID` (or `DISCORD_CLIENT_ID`),
`DASHBOARD_DISCORD_CLIENT_SECRET` (or `DISCORD_CLIENT_SECRET`),
`DASHBOARD_DISCORD_REDIRECT_URI`, `DASHBOARD_SESSION_SECRET`,
`DASHBOARD_CACHE_ENABLED`, `DASHBOARD_CACHE_TTL_SECONDS`,
`DASHBOARD_CACHE_NAMESPACE`, `REDIS_ENABLED`, `REDIS_URL`, `REDIS_HOST`,
`REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_TLS`,
`REDIS_TIMEOUT_MS`.

## Client API

The desktop client authenticates with a key generated in the dashboard's
**Client API** tab (or via `/vrcmanageapikey`), sent as the header:

```
vrclogger-api-key: <key>
```

| Route | Purpose |
| --- | --- |
| `GET /api/client/bootstrap` | Validate the key, return group + permissions |
| `GET /api/client/overview` | Counters |
| `GET /api/client/events` | Group audit events |
| `GET /api/client/users` | Per-user event stats |
| `GET /api/client/blacklists` | User / avatar / group blacklists |
| `GET /api/client/staff` | Staff list |
| `GET /api/client/members` | Cached group members, including those who left |
| `GET /api/client/resolve-name/:name` | Display name → user id, **including old names** |
| `GET /api/client/names/:userId` | Every known display name for a user |
| `GET /api/client/profile/:id` | User or avatar profile (`usr_` / `avtr_`) |
| `GET /api/client/user/:userId` | User profile |
| `GET /api/client/users/:userId/profile` | User profile (alias) |
| `GET /api/client/avatar/:avatarId` | Avatar profile |
| `GET /api/client/avatars/:avatarId/profile` | Avatar profile (alias) |
| `GET /api/client/check/:userId` | Quick blacklist check |
| `GET /api/client/automod/check/:userId` | Automod check |
| `GET /api/client/world` | World / instance lookup |
| `GET /api/client/global-history` | Shared analytics |
| `POST /api/client/avatar-analysis` | Avatar analysis |

Each route also has an explicitly scoped form,
`/api/client/:guildId/:groupId/...`, which the client may use instead. Both
resolve to the same single server and group.

## Group and member cache

Every `groupCacheIntervalMs` (default 15 minutes) the bot fetches the group and
its full member list from the backend and reconciles two tables.

**Why it matters:** VRChat users rename themselves, and old log lines only carry
the old name. The cache makes those still resolvable.

- Members who leave are kept with `active = false` — **rows are never deleted**,
  so a departed member's name still resolves.
- Every observed rename is appended to `vrc_user_name_history`.
- `/api/client/resolve-name/:name` matches current *and* historical names,
  returning `historical: true` when it matched an old one.

Tables involved:

| Table | Holds |
| --- | --- |
| `vrc_group_cache` | Group snapshot (name, owner, member count, icon) |
| `vrc_group_member_cache` | One row per member ever seen, active or not |
| `vrc_user_name_history` | Every `old name → new name` transition |
| `vrc_user_profile_cache` | Cached VRChat user profiles |
| `vrc_avatar_profile_cache` | Cached avatar metadata |

The client uses this automatically: when a VRChat log line has a display name
but no user id, it asks the dashboard before falling back to VRCX.

## Storage layout

**MySQL** — blacklists, staff, API keys, queue, profile/group/member caches.

**SQLite** — per-group event cache:

```
config/data/sqlite/<groupId>_groupscache.sqlite
```

Example:

```
config/data/sqlite/grp_6992afc4-7157-4dbe-8e15-9480ef84c713_groupscache.sqlite
```

## Migrating from the multi-server build

On first start, if `config/settings.json` has no `TestingServerID` +
`VRCAPI.groupid`, the bot folds in the first legacy profile it finds and writes
the result back:

1. `config/guilds/<guildId>/config.json` (or `profile.json`)
2. `config/guilds/<guildId>.json`
3. `bot_configs/*.json`

If that profile used `VRCAPI.groups[]`, **only the first group is kept** — the
rest are dropped with a warning in the console. SQLite files under
`config/guilds/<guildId>/sqlite/` are copied to `config/data/sqlite/`.

Afterwards `config/guilds/` and `bot_configs/` are no longer read and can be
deleted. **Review the generated `config/settings.json` before going live.**

### Removed in this build

- Multiple Discord servers per bot, and multiple VRChat groups per server
- The per-guild bot token override
- The `groupid` option and group pickers on slash commands
- Cross-server Share Ban / Adopt Ban, and the `shareban` channel config
- The `LINKUP` profile lookup
- Guild backups: the backup engine, `/admin/backups`, the viewer, and the
  `/downloads/*` and `/backups/*` routes
- The federated public blacklist. Flagged-group lists now come from this bot's
  own `vrc_vrcga_blacklist_groups` table.
- Automatic VRChat help desk submission. VRChat now requires a signed-in account
  to file a report, so the Report button replies with the form link plus a
  prefilled subject and description for a moderator to submit.

## Project layout

```
discord/
├── index.js                  # entry: load config, login, start dashboard
├── handler/index.js          # loads events + slash commands, registers to the guild
├── config/
│   ├── settings-template.json  # copy to settings.json
│   ├── settings.json           # your config (gitignored)
│   ├── discordbotcfg.json      # bot version/creator metadata
│   ├── emojis.json, help.json, tags.json
│   └── data/sqlite/            # per-group event cache
├── events/                   # ready, interactionCreate, interactionModal
├── lib/
│   ├── appConfig.js          # single-config loader + legacy migration
│   ├── vrcGroup.js           # the one-group accessor
│   ├── groupCache.js         # group/member cache + name backtracking
│   ├── datastores.js         # Sequelize models
│   ├── dashboard.js          # web dashboard + client API
│   ├── dashboardCache.js     # memory/Redis cache
│   ├── globalAnalytics.js    # shared analytics store
│   └── safetyRegistry.js     # safety lists
├── SlashCommands/            # botowners/ general/ vrchat/
├── templates/dashboard/      # dashboard HTML
└── utils/                    # vrchat client, log helpers, user id parsing
```

## Troubleshooting

**Slash commands do not appear** — check `TestingServerID` matches the server and
the bot was invited with the `applications.commands` scope.

**"Missing bot token" / "Missing TestingServerID" / "Missing VRCAPI.groupid"** —
`config/settings.json` is incomplete. Start from `config/settings-template.json`.

**Bot starts but logs nothing** — confirm the backend is running and
`VRCAPI.VRCBackEndURL` points at it. `GET <backend>/v1/vrchat/account` should
report `authenticated: true`.

**Dashboard redirects to `?setup=1`** — `discordClientId`, `discordClientSecret`,
or `sessionSecret` is missing.

**Dashboard login fails with an OAuth error** — the redirect URI in the Discord
portal must exactly match `<baseUrl>/auth/discord/callback`.

**Old display names do not resolve** — the cache needs at least one poll after a
rename. Check the console for `[group-cache]` lines; each name change is logged.

**SQL errors on start** — the bot runs `sync({ alter: true })`, so the database
user needs `CREATE`, `ALTER`, and `INDEX` as well as read/write.
