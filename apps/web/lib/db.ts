/**
 * 历史记录存储 — 纯前端 localStorage 实现（Vercel 兼容）
 * 服务端调用时返回空结果，所有实际读写发生在客户端组件中。
 */
import type { HistoryRecord, Platform } from "@streamgrab/types";

const STORAGE_KEY = "streamgrab_history";
const MAX_RECORDS = 200;

function isClient() {
  return typeof window !== "undefined";
}

function readAll(): HistoryRecord[] {
  if (!isClient()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryRecord[];
  } catch {
    return [];
  }
}

function writeAll(records: HistoryRecord[]) {
  if (!isClient()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    // localStorage 可能已满，忽略
  }
}

export function insertHistory(record: HistoryRecord): void {
  const records = readAll().filter((r) => r.id !== record.id);
  writeAll([record, ...records]);
}

export function listHistory(platform?: Platform, limit = 100): HistoryRecord[] {
  const records = readAll();
  const filtered = platform ? records.filter((r) => r.platform === platform) : records;
  return filtered.slice(0, limit);
}

export function deleteHistory(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));
}

export function deleteAllHistory(): void {
  if (isClient()) localStorage.removeItem(STORAGE_KEY);
}
