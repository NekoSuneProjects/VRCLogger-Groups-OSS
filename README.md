# BackendNode (VRCLogger BackendNode)

BackendNode is a lightweight Express proxy used by VRCLogger to fetch VRChat data and expose a small, stable API surface for other services.

## Features
- VRChat proxy endpoints for groups, users, worlds, and avatars
- Group moderation logging backed by a local SQLite database
- Optional logger webhook integration (nekowh/discord)

## Requirements
- Node.js LTS
- One or more VRChat accounts (dummy/bot accounts recommended)
- Optional: webhook endpoint for loggerPost

## Setup
```powershell
npm install
Copy-Item config\config-example.json config\config.json
npm start
```

## Configuration
Edit `config/config.json` after copying the example:
```json
{
  "PORT": 3688,
  "VRChat": {
    "loginCooldownMs": 60000,
    "loginJitterMs": 15000,
    "loginRetryCooldownMs": 300000,
    "loginMaxRetries": 2,
    "accounts": [
      {
        "name": "integration",
        "user": "",
        "pass": "",
        "twofa": "",
        "ports": [3688]
      },
      {
        "name": "profile-verify",
        "user": "",
        "pass": "",
        "twofa": "",
        "ports": [6432]
      }
    ]
  },
  "loggerPost": {
    "enable": true,
    "type": "nekowh|discord",
    "urladd": "",
    "urlupdate": "",
    "urlprivate": "",
    "token": ""
  },
  "debug": false
}
```
- `PORT`: Legacy single-account port. `process.env.PORT` overrides configured ports.
- `VRChat.user` / `VRChat.pass`: Login for the proxy account.
- `VRChat.twofa`: 2FA code if required.
- `VRChat.accounts`: Optional multi-account list. When present, the process listens on each account's `ports`, and requests on that port use that account.
- `VRChat.loginCooldownMs`: Delay between account login attempts. Defaults to `60000` when multiple accounts are configured.
- `VRChat.loginJitterMs`: Random extra delay added to cooldowns so restarts do not always hit at the same interval.
- `VRChat.loginRetryCooldownMs`: Delay before retrying a failed/rate-limited login.
- `VRChat.loginMaxRetries`: Retries after the first login attempt for retryable failures such as `429` and `5xx`.
- `loggerPost.*`: Webhook settings for outbound logging.

For single-account mode, remove `VRChat.accounts` and keep using `VRChat.user`, `VRChat.pass`, `VRChat.twofa`, and `PORT`.

## API Routes
- `GET /` -> `{ "Status": "ONLINE!" }`
- `POST /v1/vrchat/groups/messages`
- `POST /v1/vrchat/groups/moderation`
- `POST /v1/vrchat/groups/invite`
- `POST /v1/vrchat/groups/role`
- `POST /v1/vrchat/groups/search`
- `POST /v1/vrchat/groups/getgroup`
- `POST /v1/vrchat/groups/membership/join`
- `POST /v1/vrchat/groups/membership/visibility`
- `POST /v1/vrchat/groups/join`
- `GET /v1/vrchat/groups/invites/pending`
- `POST /v1/vrchat/groups/invites/accept`
- `POST /v1/vrchat/groups/invites/decline`
- `POST /v1/vrchat/groups/invites/ignore`
- `POST /v1/vrchat/groups/posts/get`
- `POST /v1/vrchat/users/search`
- `POST /v1/vrchat/users/friends`
- `GET /v1/vrchat/users/online`
- `POST /v1/vrchat/world`
- `POST /v1/vrchat/avatars`
- `POST /v1/vrchat/prints/get`
- `GET /v1/vrchat/prints/own`
- `POST /v1/vrchat/prints/upload`
- `POST /v1/vrchat/prints/edit`
- `POST /v1/vrchat/prints/delete`
- `GET /v1/vrchat/inventory`
- `POST /v1/vrchat/inventory/get`
- `GET /v1/vrchat/inventory/collections`
- `GET /v1/vrchat/inventory/drops`
- `GET /v1/vrchat/inventory/template/:inventoryTemplateId`
- `GET /v1/vrchat/inventory/own/:inventoryItemId`
- `GET /v1/vrchat/inventory/user/:userId/:inventoryItemId`
- `POST /v1/vrchat/inventory/user/get`
- `POST /v1/vrchat/inventory/consume`
- `POST /v1/vrchat/inventory/equip`
- `POST /v1/vrchat/inventory/unequip`
- `POST /v1/vrchat/inventory/spawn`
- `POST /v1/vrchat/inventory/cloning/pedestal`
- `POST /v1/vrchat/inventory/cloning/direct`
- `POST /v1/vrchat/inventory/update`
- `POST /v1/vrchat/inventory/delete`
- `POST /v1/vrchat/calendar/events`
- `POST /v1/vrchat/calendar/events/featured`
- `POST /v1/vrchat/calendar/events/search`
- `POST /v1/vrchat/calendar/groups/events`
- `POST /v1/vrchat/calendar/groups/event`
- `GET /v1/vrchat/calendar/groups/event/ics/:groupid/:calendarid`
- `POST /v1/vrchat/calendar/groups/event/create`
- `POST /v1/vrchat/calendar/groups/event/update`
- `POST /v1/vrchat/calendar/groups/event/delete`

## Notes
Invite-only groups cannot be joined directly. The join endpoint returns a clear error and includes the bot identity in the response.

## Examples
Join group (smart join, handles open/request/invite-only):
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/join \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX","confirmOverrideBlock":false}'
```
Success response:
```json
{
  "status": 200,
  "message": "Joined group.",
  "bot": {
    "id": "usr_XXXX",
    "displayName": "BotName"
  },
  "data": {}
}
```
Invite-only response:
```json
{
  "status": 403,
  "message": "Invite only. Please invite the bot to this group.",
  "bot": {
    "id": "usr_XXXX",
    "displayName": "BotName"
  }
}
```

Join group (direct join request, no join-state check):
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/membership/join \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX","confirmOverrideBlock":false}'
```

Set group visibility on bot profile:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/membership/visibility \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX","visibility":"hidden"}'
```
Visibility values: `visible`, `friends`, `hidden`.

List pending group invites:
```bash
curl -sS \
  http://localhost:3079/v1/vrchat/groups/invites/pending
```
Pending invites response:
```json
{
  "status": 200,
  "message": "Fetched pending group invites.",
  "bot": {
    "id": "usr_XXXX",
    "displayName": "BotName"
  },
  "data": []
}
```

Accept/decline/ignore invite:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/invites/accept \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX"}'

curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/invites/decline \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX"}'

curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/invites/ignore \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX"}'
```
Accept response:
```json
{
  "status": 200,
  "message": "Accepted group invite.",
  "bot": {
    "id": "usr_XXXX",
    "displayName": "BotName"
  },
  "data": {}
}
```
Decline response:
```json
{
  "status": 200,
  "message": "Declined group invite.",
  "bot": {
    "id": "usr_XXXX",
    "displayName": "BotName"
  },
  "data": {}
}
```
Ignore response:
```json
{
  "status": 200,
  "message": "Declined invite and blocked future invites.",
  "bot": {
    "id": "usr_XXXX",
    "displayName": "BotName"
  },
  "data": {}
}
```

## More Examples
Users search:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/users/search/search \
  -H 'Content-Type: application/json' \
  -d '{"search":"NekoUser"}'
```
User by id:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/users/search/userid \
  -H 'Content-Type: application/json' \
  -d '{"userid":"usr_XXXX"}'
```
User groups:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/users/search/usergroups \
  -H 'Content-Type: application/json' \
  -d '{"userid":"usr_XXXX"}'
```
User prints:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/users/search/prints \
  -H 'Content-Type: application/json' \
  -d '{"printsid":"prnt_XXXX"}'
```

Current online users:
```bash
curl -sS \
  http://localhost:3079/v1/vrchat/users/online
```

Friends:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/users/friends/sendfriendreq \
  -H 'Content-Type: application/json' \
  -d '{"userid":"usr_XXXX"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/users/friends/getfriendstatus \
  -H 'Content-Type: application/json' \
  -d '{"userid":"usr_XXXX"}'
```

Worlds:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/world/worldid \
  -H 'Content-Type: application/json' \
  -d '{"worldid":"wrld_XXXX"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/world/worldInstance \
  -H 'Content-Type: application/json' \
  -d '{"worldId":"wrld_XXXX","instanceId":"12345"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/world/search \
  -H 'Content-Type: application/json' \
  -d '{"search":"Neko"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/world/searchusers \
  -H 'Content-Type: application/json' \
  -d '{"search":"usr_XXXX"}'
```

Avatars:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/avatars/analysis \
  -H 'Content-Type: application/json' \
  -d '{"fileId":"file_XXXX","fileVersion":1}'
```
```bash
curl -sS \
  http://localhost:3079/v1/vrchat/avatars/useravatars/usr_XXXX
```

Group messages:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/messages/sendmessage \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX","title":"Notice","text":"Hello","bool":true,"groupname":"MyGroup"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/messages/getmessage \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX","groupname":"MyGroup"}'
```

Group moderation:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/moderation/getauditlogs \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX","groupname":"MyGroup"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/moderation/banmember \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX","userid":"usr_XXXX","groupname":"MyGroup"}'
```

Group invite (invite a user):
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/invite/invitemember/grp_XXXX \
  -H 'Content-Type: application/json' \
  -d '{"userid":"usr_XXXX","groupname":"MyGroup"}'
```

Group roles:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/role/add/grp_XXXX \
  -H 'Content-Type: application/json' \
  -d '{"userId":"usr_XXXX","groupRoleId":"grprole_XXXX","groupname":"MyGroup"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/role/get/grp_XXXX \
  -H 'Content-Type: application/json' \
  -d '{"groupname":"MyGroup"}'
```

Group search:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/search/NekoGroup \
  -H 'Content-Type: application/json' \
  -d '{"groupname":"NekoGroup"}'
```

Group get by id:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/getgroup \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX"}'
```

Group posts (list):
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/groups/posts/get \
  -H 'Content-Type: application/json' \
  -d '{"groupid":"grp_XXXX","n":50,"offset":0,"publicOnly":true}'
```

Prints:
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/prints/get \
  -H 'Content-Type: application/json' \
  -d '{"printid":"prnt_XXXX"}'
```
```bash
curl -sS \
  http://localhost:3079/v1/vrchat/prints/own
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/prints/upload \
  -H 'Content-Type: application/json' \
  -d '{"imageBase64":"BASE64_PNG","note":"Hello","timestamp":"2026-01-16T12:00:00Z","worldId":"wrld_XXXX","worldName":"World Name"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/prints/edit \
  -H 'Content-Type: application/json' \
  -d '{"printid":"prnt_XXXX","imageBase64":"BASE64_PNG","note":"Updated note"}'
```
```bash
curl -sS -X POST \
  http://localhost:3079/v1/vrchat/prints/delete \
  -H 'Content-Type: application/json' \
  -d '{"printid":"prnt_XXXX"}'
```

## Local Storage
- Group moderation logs are stored in `config/groups_Loggers.sqlite`.

## Notes
- This is an open-source fork of VRCLogger. Use it responsibly and respect VRChat terms.
- If you are using a real account, enable 2FA and keep the credentials private.

## License
See `LICENSE`.
