# VRCLogger Client (BanLogger)

A Windows desktop app (Electron) that watches your local VRChat log files and
checks the people you meet against your group's blacklists.

```
  backend  <──  Discord bot + dashboard  <──  [ this client ]
```

The client talks to **your dashboard and nothing else**. It never calls the
backend or the VRChat API directly, and there is no hosted/public API — you
point it at the dashboard you run.

It stores no moderation data. The only local database is a small user-name
cache to reduce lookups.

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Install — prebuilt](#install--prebuilt)
- [Install — from source](#install--from-source)
- [Building an installer](#building-an-installer)
- [First-time setup](#first-time-setup)
- [Settings](#settings)
- [Tabs](#tabs)
- [Integrations](#integrations)
- [Where things are stored](#where-things-are-stored)
- [Troubleshooting](#troubleshooting)

## What it does

- Tails the VRChat log directory and parses joins, leaves, avatar changes,
  world changes, and asset loads
- Checks each player against your group's user / avatar / group blacklists via
  the dashboard
- Resolves a display name to a stable VRChat user id — **including names the
  person has since changed away from**, using the dashboard's member cache
- Raises alerts in-app, as Windows toasts, or in VR (XSOverlay / OVRToolkit)
- Optional text-to-speech for blacklist and automod hits
- Optional OBS overlay served on localhost
- Optional IP-grabber domain detection in video player URLs

## Requirements

- **Windows** (the build targets NSIS and MSI)
- **VRChat** with logging enabled
- A running **[Discord bot + dashboard](../discord/README.md)** you can reach
- An **API key** generated in that dashboard
- For building from source: **Node.js 20+**

## Install — prebuilt

Grab `BanLogger-Setup-<version>.exe` (or `.msi`) from your releases page and run
it. Then jump to [First-time setup](#first-time-setup).

## Install — from source

```bash
git clone <your-fork-url>
cd VRCLogger-Groups-OSS/client
npm install
```

Run it in development:

```bash
npm test        # launches Electron against the working tree
```

> `npm test` is the dev-run script here; it does not run a test suite.

Native modules (`sqlite3`, `speaker`) compile during install. If that fails on
Windows you need the build toolchain:

```bash
npm install --global windows-build-tools
# or install "Desktop development with C++" via the Visual Studio Installer
```

## Building an installer

```bash
npm run build         # current platform
npm run build:win     # Windows: NSIS + MSI
```

Output lands in `dist/` as `BanLogger-Setup-<version>.exe` and `.msi`.

Build config lives in the `build` block of `package.json`
(appId `com.nekosunevr.banlogger`, icon `assets/icon.ico`). If you add a
top-level folder that must ship, add it to `build.win.files` or it will be left
out of the installer.

## First-time setup

1. **Generate an API key.** In the dashboard, open **Client API** and create a
   key for your Discord account. (A staff member can also use
   `/vrcmanageapikey`.)
2. **Launch the client** and open the **Settings** tab.
3. Fill in:
   - **Dashboard URL** — e.g. `https://your-dashboard.example.com`
     (the dashboard root, not `/api/client`)
   - **API key** — the key from step 1
   - **Group ID** — your `grp_...` id
4. Press **Test Connection**. It should confirm the group and your permissions.
5. Check **Log Directory** points at your VRChat logs — normally
   `%USERPROFILE%\AppData\LocalLow\VRChat\VRChat`.
6. Turn on the toggles you want (see below).

There is no default dashboard URL. If it is blank, lookups fail with
*"Dashboard URL is not configured."*

## Settings

### Paths

| Setting | Meaning |
| --- | --- |
| `Directories.LogDirectory` | VRChat log folder |
| `cache.cacheDirectory` | VRChat asset cache, read from VRChat's own `config.json` when present |
| `vrcx.db` | VRCX SQLite database, for the optional VRCX integration |

### Dashboard connection

| Setting | Meaning |
| --- | --- |
| `VRCLoggerApi.dashboardBaseUrl` | Dashboard root URL |
| `VRCLoggerApi.apiKey` | Client API key |
| `VRCLoggerApi.headerName` | Auth header, default `vrclogger-api-key` |
| `VRCLoggerApi.groupId` | `grp_...` id scoping requests |

### Toggles

| Toggle | Effect |
| --- | --- |
| `CheckUser` | Check joining players against the user blacklist |
| `CheckAutoMod` | Run automod checks on join |
| `CheckUserCache` | Use the cached user lookup |
| `CheckGroupsBL` | Check a player's groups against the group blacklist |
| `AviSwitch` | Log avatar switches |
| `AviLogger` | Log avatar details |
| `AviAnalysisStats` | Request avatar analysis stats |
| `assetslogger` | Log asset loads |
| `Countersavi` / `Countersvrca` | Counters in the UI |
| `VRNotify` | Send VR notifications (XSOverlay / OVRToolkit) |
| `TTSBL` | Speak blacklist hits |
| `TTSAutoMod` | Speak automod hits |
| `BOSAlert` | Extra alert sound |
| `vrcx` / `vrcxdata` | Use VRCX as a fallback name→id source |

### Privacy and safety

| Setting | Effect |
| --- | --- |
| `PrivacyandSafety.videoplayerinfo` | Log video player URLs |
| `PrivacyandSafety.ipgrabber` | Warn on known IP-grabber domains |

## Tabs

| Tab | Shows |
| --- | --- |
| Main Log | Everything |
| Joining/Leaving | Player joins and leaves |
| Detect Known Blacklist | Blacklist hits |
| Avatar Switch Blacklist | Blacklisted avatars |
| Assets Logger | Asset loads |
| Avatars Seen | Avatars observed |
| Moderation Logs | Moderation events and safety alerts |
| Settings | Configuration |

## Integrations

**VR notifications** — if SteamVR is running, alerts go to OVRToolkit or
XSOverlay when detected, otherwise to Windows notifications. Provided by
`@nekosuneprojects/vrnotications`.

**Text to speech** — via `say`, with `speaker`/`pcm-volume` for playback.

**VRCX** — reads the VRCX SQLite database as a *fallback* for resolving a
display name to a user id. The dashboard's member cache is tried first, since it
also matches historical names. Local only, port `22500`.

**OBS overlay** — a small HTTP server on `127.0.0.1` serving
[web/obs-overlay.html](web/obs-overlay.html). Add it as a browser source.

## Where things are stored

```
%APPDATA%\banlogger\config\config.sqlite     # settings
%APPDATA%\banlogger\config\usercache.sqlite  # local user-name cache
```

Delete `config.sqlite` to reset to defaults; it is rebuilt on next start.
Unknown keys are pruned automatically on upgrade.

## Project layout

```
client/
├── main.js                  # Electron main process, config defaults, overlay server
├── preload.js               # renderer bridge
├── index.js                 # VRChat log watcher and parser
├── APIClient/               # dashboard-backed list/count fetchers
├── AvatarUpload/            # avatar upload handling
├── Configfiles/             # log writers and config helpers
├── functions/
│   ├── vrcLoggerApiClient.js  # THE dashboard channel - all remote calls
│   ├── localUserCache.js      # local name cache
│   ├── configsqlite.js        # settings database
│   ├── VRChatAPI.js           # avatar analysis via the dashboard
│   ├── Notications.js         # VR / Windows notifications
│   ├── TTS.js, OSC.js, checkProcesses.js
├── VRChatLogUserID/
│   └── vrcga/{blacklist,automod,usercache}/   # per-join checks
├── playercounter/ SafetyProtection/ Splitlogjsonpart/ vrcx/
├── models/                  # Sequelize models for local config
├── web/                     # UI (index.html, js/, css/, obs-overlay.html)
└── assets/                  # icon, alert sound
```

Every outbound call goes through `functions/vrcLoggerApiClient.js`. If you are
adding a remote call, add it there.

## Troubleshooting

**"Dashboard URL is not configured."** — set the Dashboard URL in Settings.
There is no built-in fallback host any more.

**Test Connection returns 401/403** — the API key is wrong, revoked, or the
staff account behind it was deactivated. Generate a new one in the dashboard.

**Nothing appears in the logs** — check the Log Directory, and that VRChat has
logging enabled. VRChat writes a new log file per session, so restart VRChat
after changing the setting.

**Players show as `unknown`** — the log line had no user id. The client asks the
dashboard's member cache, then VRCX if enabled. If the person has never been
seen in your group, neither can resolve them.

**`npm install` fails building sqlite3/speaker** — install the Windows C++ build
tools (see [Install — from source](#install--from-source)).

**VR notifications do not appear** — SteamVR must be running, with XSOverlay or
OVRToolkit open. Without SteamVR it falls back to Windows notifications.

**Build succeeds but the app crashes with "module not found"** — a folder is
missing from `build.win.files` in `package.json`.
