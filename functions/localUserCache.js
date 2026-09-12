const os = require("os");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3");
const pkg = require("../package.json");

const appInstallPath = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  pkg.name
);
const configDir = path.join(appInstallPath, "config");
const dbPath = path.join(configDir, "usercache.sqlite");

let dbPromise = null;

function getDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      fs.mkdirSync(configDir, { recursive: true });
      const db = new sqlite3.Database(dbPath, error => {
        if (error) {
          reject(error);
          return;
        }

        db.run(
          `CREATE TABLE IF NOT EXISTS usercache (
            userId TEXT PRIMARY KEY,
            displayName TEXT,
            bio TEXT,
            dateJoined TEXT,
            lastPlatform TEXT,
            firstSeenAt TEXT NOT NULL,
            lastSeenAt TEXT NOT NULL
          )`,
          createError => {
            if (createError) {
              reject(createError);
              return;
            }

            resolve(db);
          }
        );
      });
    });
  }

  return dbPromise;
}

async function run(sql, params = []) {
  const db = await getDatabase();

  return new Promise((resolve, reject) => {
    db.run(sql, params, function(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve(this);
    });
  });
}

async function get(sql, params = []) {
  const db = await getDatabase();

  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row || null);
    });
  });
}

async function upsertUserCache(user) {
  if (!user || !user.userId) {
    return null;
  }

  const now = new Date().toISOString();
  const existing = await getUserCache(user.userId);

  await run(
    `INSERT INTO usercache (
      userId,
      displayName,
      bio,
      dateJoined,
      lastPlatform,
      firstSeenAt,
      lastSeenAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      displayName = excluded.displayName,
      bio = COALESCE(excluded.bio, usercache.bio),
      dateJoined = COALESCE(excluded.dateJoined, usercache.dateJoined),
      lastPlatform = COALESCE(excluded.lastPlatform, usercache.lastPlatform),
      lastSeenAt = excluded.lastSeenAt`,
    [
      user.userId,
      user.displayName || existing?.displayName || "Unknown User",
      user.bio || null,
      user.dateJoined || null,
      user.lastPlatform || null,
      existing?.firstSeenAt || now,
      now
    ]
  );

  return getUserCache(user.userId);
}

async function getUserCache(userId) {
  return get("SELECT * FROM usercache WHERE userId = ?", [userId]);
}

module.exports = {
  getUserCache,
  upsertUserCache
};
