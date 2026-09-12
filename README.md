# BanLogger (One Discord Server, One VRChat Group)

This build runs one Discord bot serving exactly one Discord server, tracking exactly one VRChat group.

## Requirements

- Node.js 20+
- MySQL/MariaDB (for shared tables)
- Discord bot token + app id
- VRChat backend API URL (`VRCBackEndURL`)

## Install

```bash
npm install
```

## Config File

There is one config file:

- `config/settings.json`

Start from:

- `config/settings-template.json`

It holds everything: the bot identity, the dashboard, the SQL connection, the one
Discord server id (`TestingServerID`), and the one VRChat group (`VRCAPI`).

```json
{
  "token": "YOUR_BOT_TOKEN",
  "clientid": "YOUR_DISCORD_APP_ID",
  "TestingServerID": "123456789012345678",
  "SQL": {
    "HOST": "",
    "PORT": 3306,
    "USER": "",
    "PASS": "",
    "DB": "VRCLogger"
  },
  "VRCAPI": {
    "VRCBackEndURL": "http://127.0.0.1:3077",
    "VRCProxyNode": "http://127.0.0.1:3401",
    "groupid": "grp_main",
    "groupName": "Main Group",
    "ownerDiscordIds": ["DISCORD_USER_ID_OWNER_1"],
    "globalAnalytics": { "autoShare": false },
    "ACCESS": {
      "ban": ["owner", "co-owner", "admin"],
      "unban": ["owner", "co-owner"],
      "blacklister": ["owner", "co-owner", "admin"],
      "reacted": ["owner", "co-owner"],
      "requester": ["owner", "co-owner"],
      "tags": ["owner", "co-owner", "admin", "mod", "trainee", "it-tech"],
      "userlookup": ["owner", "co-owner", "admin", "it-tech"]
    },
    "LoggerCategoryId": "",
    "reqnotify": {
      "enable": false,
      "REQCHANNEL": ""
    },
    "LoggerTextChannel": {
      "BANMEMBER": "",
      "JOINMEMBER": ""
    }
  }
}
```

`TestingServerID` must be the Discord server this bot serves. Interactions from
any other server are ignored, and slash commands are registered to that server
only (so they appear instantly, with no global propagation delay).

`VRCAPI.groupid` is the one VRChat group that is logged. There is no `groups[]`
array and no `groupid` option on the slash commands.

## Start Bot

```bash
npm start
```

## Web Dashboard

The bot starts a Discord-login dashboard at:

- `http://127.0.0.1:3434/dashboard`

Access is limited to Discord users who own the configured Discord guild or have the Discord Administrator permission in that guild. Each signed-in user only sees the Discord servers and VRChat groups configured for servers they can administer.

The dashboard keeps a live connection open for the selected Discord server and VRChat group. Audit logs, counters, staff/queue views, blacklist views, and global share history refresh automatically when stored data changes.

The `Setup` tab helps Discord owners/admins add or edit one or more VRChat groups for the selected Discord server. It can look up a group, save it into `VRCAPI.groups`, call the VRChat backend smart join/request flow, load/accept/decline/ignore pending group invites, and shows the VRChat bot-role permissions that must be enabled before logger features will work. Bot group membership visibility is forced to `hidden` automatically after joins/invite accepts and checked periodically for configured groups.

The `Client API` tab generates a per-user, per-Discord-server, per-VRChat-group API key for the selected group. Discord server owners/admins can generate access directly; active `/vrcaddstaff` users can generate keys for logger data access using their configured staff role. Client requests use the `vrclogger-api-key` header and only need the dashboard client API URL plus that key header. User checks and automod checks are served by the dashboard client API at `/check/<userId>` and `/automod/check/<userId>`.

Public policy pages are served at:

- `http://127.0.0.1:3434/privacy`
- `http://127.0.0.1:3434/terms`

Safety lists are managed from a bot-admin panel, which requires the signed-in Discord user to be in top-level `developerID` or `DASHBOARD.adminDiscordIds`:

- `http://127.0.0.1:3434/admin/safety`
- `http://127.0.0.1:3434/safetyjson.json`
- `http://127.0.0.1:3434/domains.json`
- `http://127.0.0.1:3434/api/public/groups?type=CRASHER&q=`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/avatarblacklist`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/count`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/list`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/groupslist`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/groups/check/<groupId>`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/groups/check-user/<userId>`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/getPrints/<printId>`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/getSticker/<fileId>`
- `http://127.0.0.1:3434/v5/games/api/vrchat/yoinker/getSticker/<usr_...>/<inv_...>`

Old sticker logs that contain `file_...` use the generated VRChat file URL. New sticker logs that contain `usr_... spawned sticker inv_...` use the backend inventory route `/v1/vrchat/inventory/user/:userId/:inventoryItemId`; the single-segment route also accepts `?userId=<usr_...>` for `inv_...` lookups.

Public group sharing is opt-in per group entry and defaults to private. `COMMUNITY`, `ALLY`, `ALLIED`, and `AFFILIATED` group entries are never shown through public group endpoints. Deleted safety-admin entries are archived, hidden from public pulls, and still available in the safety admin archive view.

Client API profile lookups are served from the dashboard with the same `vrclogger-api-key` header used by `/api/client/bootstrap`:

- `GET /api/client/user/<usr_...>?groupId=<grp_...>&refresh=true`
- `GET /api/client/users/<usr_...>/profile?groupId=<grp_...>&refresh=true`
- `GET /api/client/profile/<usr_...>?groupId=<grp_...>&refresh=true`
- `GET /api/client/avatar/<avtr_...>?groupId=<grp_...>&ownerId=<usr_...>&refresh=true`
- `GET /api/client/avatars/<avtr_...>/profile?groupId=<grp_...>&ownerId=<usr_...>&refresh=true`
- `POST /api/client/avatar-analysis` with `{ "fileId": "file_...", "fileVersion": 1 }`

User profile lookups hydrate bio/profile fields from the VRChat backend and track display-name changes in `vrc_user_name_history` by matching the stable `usr_...` id. Avatar profile lookups use cached data, the selected group's avatar blacklist row, or the backend owner avatar list when `ownerId` is provided.

Add dashboard settings to `config/settings.json`:

```json
"DASHBOARD": {
  "enabled": true,
  "host": "0.0.0.0",
  "port": 3434,
  "baseUrl": "http://127.0.0.1:3434",
  "discordClientId": "YOUR_DISCORD_APP_CLIENT_ID",
  "discordClientSecret": "YOUR_DISCORD_APP_CLIENT_SECRET",
  "sessionSecret": "CHANGE_ME_TO_A_LONG_RANDOM_SECRET",
  "adminDiscordIds": ["OPTIONAL_EXTRA_BOT_ADMIN_DISCORD_ID"],
  "cache": {
    "enabled": true,
    "ttlSeconds": 300,
    "namespace": "banlogger:dashboard",
    "redis": {
      "enabled": true,
      "url": "redis://:YOUR_REDIS_PASSWORD@127.0.0.1:6379/0",
      "host": "127.0.0.1",
      "port": 6379,
      "username": "",
      "password": "YOUR_REDIS_PASSWORD",
      "db": 0,
      "tls": false,
      "timeoutMs": 2000
    }
  }
},
"LINKUP": {
  "baseUrl": "https://linkup.nekosunevr.co.uk",
  "userApiKey": "OPTIONAL_LINKUP_USER_API_KEY",
  "profileEndpoint": "/api/profile/:discordId",
  "userLookupEndpoint": "/api/user"
}
```

Dashboard VRChat backend reads are cached for 5 minutes by default. Redis is optional but recommended when multiple people use the dashboard or client API at the same time. If Redis is not configured, the dashboard falls back to in-process memory cache for the current bot process.

The dashboard can also fall back to the top-level `clientid`, but setting `DASHBOARD.discordClientId` is clearer. In the Discord Developer Portal, add this redirect URI to the same application:

```text
http://127.0.0.1:3434/auth/discord/callback
```

If the dashboard is behind a domain, set `DASHBOARD.baseUrl` to that public URL and add `<baseUrl>/auth/discord/callback` as the redirect URI instead.

Environment variables can override config:

- `DASHBOARD_ENABLED`
- `DASHBOARD_HOST`
- `DASHBOARD_PORT`
- `DASHBOARD_BASE_URL`
- `DASHBOARD_DISCORD_CLIENT_ID` or `DISCORD_CLIENT_ID`
- `DASHBOARD_DISCORD_CLIENT_SECRET` or `DISCORD_CLIENT_SECRET`
- `DASHBOARD_DISCORD_REDIRECT_URI`
- `DASHBOARD_SESSION_SECRET`
- `DASHBOARD_CACHE_ENABLED`
- `DASHBOARD_CACHE_TTL_SECONDS`
- `DASHBOARD_CACHE_NAMESPACE`
- `REDIS_ENABLED`
- `REDIS_URL` such as `redis://:password@127.0.0.1:6379/0` or `rediss://:password@host:6380/0`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_USERNAME`
- `REDIS_PASSWORD`
- `REDIS_DB`
- `REDIS_TLS`
- `REDIS_TIMEOUT_MS`

## First Setup In Discord

1. Invite the bot to the Discord server set in `TestingServerID`.
2. Run `/setup` to create the logger channels and save their IDs.
3. Use `/globalhistory vrcuserid:<usr_...|customId|profileURL> view:<all|bans|unbans|kicks|warns|joins|leaves|history>` to query global shared analytics.
4. Use `/globalautoshare state:<on|off>` to toggle realtime auto-share. Only the Discord server owner can run it.

## SQLite Storage Layout

One store, for the one VRChat group:

- `config/data/sqlite/<groupId>_groupscache.sqlite`

Example:

- `config/data/sqlite/grp_6992afc4-7157-4dbe-8e15-9480ef84c713_groupscache.sqlite`

## Migrating From The Multi-Server Build

On first start, if `config/settings.json` has no `TestingServerID` + `VRCAPI.groupid`,
the bot folds in the first legacy profile it finds and writes the result back to
`config/settings.json`:

1. `config/guilds/<guildId>/config.json` (or `profile.json`)
2. `config/guilds/<guildId>.json`
3. `bot_configs/*.json`

If that profile used `VRCAPI.groups[]`, only the **first** group is kept; the rest
are dropped with a warning in the console. Any SQLite files under
`config/guilds/<guildId>/sqlite/` are copied to `config/data/sqlite/`.

After migrating, `config/guilds/` and `bot_configs/` are no longer read and can be
deleted. Review the generated `config/settings.json` before going live.

Removed in this build:

- Multiple Discord servers per bot, and multiple VRChat groups per server.
- The per-guild bot token override.
- The `groupid` option and group pickers on slash commands.
- The cross-server Share Ban / Adopt Ban buttons and their `shareban` channel config.
- The `LINKUP` profile lookup.
- Guild backups: the `backup/` engine, the `/admin/backups` panel, the backup viewer,
  and the `/downloads/*` and `/backups/*` routes.
- Automatic VRChat help desk submission. VRChat now requires a signed-in account to
  file a request, so the Report button replies with the moderation form link plus a
  prefilled subject and description for the moderator to submit themselves.
