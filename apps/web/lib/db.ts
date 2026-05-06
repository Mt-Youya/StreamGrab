import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { HistoryRecord, Platform } from "@streamgrab/types";

const dbPath = process.env["DATABASE_PATH"] ?? "./data/db.sqlite";
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS download_history (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    quality TEXT NOT NULL,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER,
    cover TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )
`);

interface DbRow {
  id: string;
  title: string;
  platform: string;
  quality: string;
  url: string;
  filename: string;
  size: number | null;
  cover: string;
  created_at: number;
}

function toRecord(row: DbRow): HistoryRecord {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform as Platform,
    quality: row.quality,
    url: row.url,
    filename: row.filename,
    size: row.size ?? undefined,
    cover: row.cover,
    createdAt: row.created_at,
  };
}

export function insertHistory(record: HistoryRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO download_history
     (id, title, platform, quality, url, filename, size, cover, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.title,
    record.platform,
    record.quality,
    record.url,
    record.filename,
    record.size ?? null,
    record.cover,
    record.createdAt
  );
}

export function listHistory(platform?: Platform, limit = 100): HistoryRecord[] {
  if (platform) {
    const rows = db
      .prepare("SELECT * FROM download_history WHERE platform = ? ORDER BY created_at DESC LIMIT ?")
      .all(platform, limit) as DbRow[];
    return rows.map(toRecord);
  }
  const rows = db
    .prepare("SELECT * FROM download_history ORDER BY created_at DESC LIMIT ?")
    .all(limit) as DbRow[];
  return rows.map(toRecord);
}

export function deleteHistory(id: string): void {
  db.prepare("DELETE FROM download_history WHERE id = ?").run(id);
}

export function deleteAllHistory(): void {
  db.prepare("DELETE FROM download_history").run();
}
