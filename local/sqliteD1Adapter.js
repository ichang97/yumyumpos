import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function normalizeParams(params) {
  return params.map((value) => {
    if (value === undefined) {
      return null;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return value;
  });
}

function toPlainRow(row) {
  return row ? { ...row } : null;
}

function returnsRows(sql) {
  return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
}

function applyMigrations(raw, migrationsDir) {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  if (!migrationsDir || !fs.existsSync(migrationsDir)) {
    return;
  }

  const appliedRows = raw.prepare('SELECT name FROM d1_migrations').all();
  const applied = new Set(appliedRows.map((row) => row.name));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const insertMigration = raw.prepare('INSERT INTO d1_migrations (name) VALUES (?)');

  for (const fileName of files) {
    if (applied.has(fileName)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8').trim();
    raw.exec('BEGIN IMMEDIATE;');
    try {
      if (sql) {
        raw.exec(sql);
      }
      insertMigration.run(fileName);
      raw.exec('COMMIT;');
    } catch (err) {
      try {
        raw.exec('ROLLBACK;');
      } catch {
      }
      throw err;
    }
  }
}

export function createSqliteD1Database(options = {}) {
  const dbPath =
    options.dbPath ||
    process.env.DB_PATH ||
    path.resolve(process.cwd(), 'data/yumyum-pos.sqlite');
  const migrationsDir =
    options.migrationsDir ?? path.resolve(process.cwd(), 'migrations');

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const raw = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    raw.exec('PRAGMA journal_mode = WAL;');
  }
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  applyMigrations(raw, migrationsDir);

  function makeStatement(sql, params = []) {
    return {
      sql,
      params,
      bind(...values) {
        return makeStatement(sql, normalizeParams(values));
      },
      async all() {
        const rows = raw.prepare(sql).all(...params);
        return {
          results: rows.map((row) => ({ ...row })),
          success: true,
          meta: { changes: 0, last_row_id: 0 },
        };
      },
      async first(colName) {
        const row = toPlainRow(raw.prepare(sql).get(...params));
        if (row === null) {
          return null;
        }
        if (colName !== undefined) {
          return row[colName] ?? null;
        }
        return row;
      },
      async run() {
        const info = raw.prepare(sql).run(...params);
        return {
          results: [],
          success: true,
          meta: {
            changes: Number(info.changes ?? 0),
            last_row_id: Number(info.lastInsertRowid ?? 0),
          },
        };
      },
    };
  }

  return {
    raw,
    prepare(sql) {
      return makeStatement(sql, []);
    },
    async batch(statements) {
      if (!Array.isArray(statements) || statements.length === 0) {
        return [];
      }
      const results = [];
      raw.exec('BEGIN IMMEDIATE;');
      try {
        for (const stmt of statements) {
          const boundParams = stmt.params || [];
          if (returnsRows(stmt.sql)) {
            const rows = raw.prepare(stmt.sql).all(...boundParams);
            results.push({
              results: rows.map((row) => ({ ...row })),
              success: true,
              meta: { changes: 0, last_row_id: 0 },
            });
          } else {
            const info = raw.prepare(stmt.sql).run(...boundParams);
            results.push({
              results: [],
              success: true,
              meta: {
                changes: Number(info.changes ?? 0),
                last_row_id: Number(info.lastInsertRowid ?? 0),
              },
            });
          }
        }
        raw.exec('COMMIT;');
        return results;
      } catch (err) {
        try {
          raw.exec('ROLLBACK;');
        } catch {
        }
        throw err;
      }
    },
    close() {
      raw.close();
    },
  };
}
