# VRCLogger Backend

A thin Express proxy in front of the VRChat API, signed in as **one VRChat
account** — the logger account for your group.

```
  [ this backend ] ──> VRChat API
         ^
         └── Discord bot + dashboard
```

**It stores nothing.** No database, no SQLite file, no audit-log cache. Every
request is passed through to VRChat and the response handed straight back. All
history and de-duplication live in the Discord bot's database.

It also holds no staff data and knows nothing about Discord. Permissions,
staff lists, and API keys are entirely the Discord bot's job.

## Requirements

- **Node.js 20+**
- A **VRChat account** that is a member of your group, with a role that has the
  moderation permissions you want to use (ban, unban, kick, view audit log,
  manage join requests)
- Network access to `api.vrchat.cloud`

> **Use a dedicated account.** Do not use a personal VRChat account. The backend
> keeps a long-lived session and will be logged in continuously.

## Install from source

```bash
git clone <your-fork-url>
cd VRCLogger-Groups-OSS/backend
npm install
```

`npm install` runs a `postinstall` that pulls `betterlog.js` straight from
GitHub (`github:NekoSuneVR/betterlog.js`), so the machine needs git and network
access to GitHub. If that host is unreachable the install will fail here.

### Configure

```bash
cp config/config-example.json config/config.json
```

Then edit `config/config.json`:

```json
{
  "PORT": 3688,
  "VRChat": {
    "loginRetryCooldownMs": 300000,
    "loginMaxRetries": 2,
    "account": {
      "name": "logger",
      "user": "YOUR_VRCHAT_USERNAME",
      "pass": "YOUR_VRCHAT_PASSWORD",
      "twofa": "YOUR_TOTP_SECRET"
    }
  },
  "debug": false
}
```

| Key | Meaning |
| --- | --- |
| `PORT` | HTTP port to listen on. `PORT` env var overrides it. |
| `VRChat.account.name` | Label used in logs only. |
| `VRChat.account.user` / `.pass` | VRChat login. |
| `VRChat.account.twofa` | TOTP **secret** (the seed, not a 6-digit code). Leave `""` if 2FA is off. |
| `loginRetryCooldownMs` | Wait between login retries. Default 5 minutes. |
| `loginMaxRetries` | Retries after the first attempt. Default 2. |
| `debug` | Extra request logging. |

`config/config.json` is gitignored. Never commit credentials.

### Run

```bash
npm start          # installs betterlog.js, then node index.js
# or, once dependencies are in place:
node index.js
```

On start you should see the port, the logger account name, and a successful
VRChat login. Until that login succeeds every route except `/` returns **503**.

### Run as a service

There is no bundled service wrapper. Any process manager works:

```bash
# pm2
pm2 start index.js --name vrclogger-backend

# systemd (ExecStart)
/usr/bin/node /opt/vrclogger/backend/index.js
```

## Verifying it works

```bash
curl http://127.0.0.1:3688/
# {"Status":"ONLINE!"}

curl http://127.0.0.1:3688/v1/vrchat/account
# {"status":200,"message":"VRChat logger account.","data":{...,"authenticated":true}}
```

If `authenticated` is `false`, check the logs — the login is failing or still
in its retry backoff.

## API

All routes are `POST` with a JSON body unless noted. Base path `/v1/vrchat`.

### Status

| Route | Method | Purpose |
| --- | --- | --- |
| `/` | GET | Liveness check |
| `/v1/vrchat/account` | GET | Logger account name and login state |

### Groups — moderation (`/v1/vrchat/groups/moderation`)

| Route | Body | Purpose |
| --- | --- | --- |
| `/banmember` | `groupid, userid, groupname` | Ban a user from the group |
| `/unbanmember` | `groupid, userid, groupname` | Remove a ban |
| `/kickmember` | `groupid, userid, groupname` | Kick a member |
| `/getauditlogs` | `groupid, groupname` | Group audit log, read live from VRChat |
| `/getauditlogsold` | `groupid, groupname` | Raw audit log passthrough |
| `/getgroupmembers` | `groupid, groupname` | Full member list (paged internally) |
| `/getmemberrequests` | `groupid, groupname` | Pending join requests |
| `/requestjoingroup` | `groupid, userid, action, groupname` | Accept/reject a join request |
| `/postmemberrequests` | `groupid, userId, action, block, groupname` | Respond to a member request |

`/getgroupmembers` is what powers the bot's member cache and display-name
history, so leave it enabled.

### Groups — other

| Base | Purpose |
| --- | --- |
| `/v1/vrchat/groups` | Group lookup (`/getgroup`) |
| `/v1/vrchat/groups/messages` | Group announcements |
| `/v1/vrchat/groups/invite` | Send group invites |
| `/v1/vrchat/groups/invites` | Pending invites: accept / decline / ignore |
| `/v1/vrchat/groups/join` | Join a group |
| `/v1/vrchat/groups/membership` | Membership + visibility (used to force `hidden`) |
| `/v1/vrchat/groups/role` | Group roles |
| `/v1/vrchat/groups/search` | Group search |
| `/v1/vrchat/groups/posts` | Group posts |

### Users, worlds, avatars, misc

| Base | Purpose |
| --- | --- |
| `/v1/vrchat/users/search` | User lookup by id, and a user's groups |
| `/v1/vrchat/users/friends` | Friend list |
| `/v1/vrchat/users/online` | Online state |
| `/v1/vrchat/world` | World and instance lookup |
| `/v1/vrchat/avatars` | Avatar lookup and analysis |
| `/v1/vrchat/calendar` | Group events / calendar |
| `/v1/vrchat/prints` | Prints |
| `/v1/vrchat/inventory` | Inventory (stickers etc.) |

## Security

This backend has **no authentication**. Anything that can reach the port can act
as your VRChat logger account.

- Bind it to localhost, or keep it on a private network
- Do not expose it to the internet
- If the bot runs on another host, use a firewall rule, VPN, or an
  authenticating reverse proxy in front

## Project layout

```
backend/
├── index.js                 # app, route mounting, listen
├── config.js                # config loader
├── dependencies.js          # shared requires (express, cors, betterlog, ...)
├── config/
│   ├── config-example.json  # template — copy to config.json
│   └── config.json          # your config (gitignored)
├── endpoints/               # one router per API area
│   ├── Groups/ Users/ Worlds/ Avatars/ Calendar/ Prints/ Inventory/
└── modules/
    ├── vrchatnode.js                   # VRChat client, login, all API calls
    └── vrchat-user-public-profile.js   # getUser() extension
```

## Troubleshooting

**Every route returns 503** — the VRChat login has not succeeded. Check the logs
for the failure and confirm username, password, and TOTP secret.

**`npm install` fails on betterlog.js** — the `postinstall` fetches it from
GitHub. Check git and GitHub access on the machine.

**Login fails with 2FA errors** — `twofa` must be the TOTP *secret* (the long
seed you get when enabling 2FA), not a current 6-digit code.

**Rate limiting** — VRChat throttles aggressively. The backend has a built-in
throttle, but if you see 429s, increase the bot's `VRCAPI.groupCacheIntervalMs`
and avoid hammering the audit-log route.

**Unused dependencies** — `package.json` still lists a few packages that are no
longer required (`node-2fa`, `queue-fifo`, `p-limit`, `swagger-*`, `websocket`,
`winston`). They are harmless; remove them if you want a leaner install.
