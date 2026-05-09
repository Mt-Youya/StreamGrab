/**
 * 解析结果缓存层
 *
 * 自动选择后端：
 * - 有 KV_REST_API_URL 环境变量 → Vercel KV（Redis）
 * - 否则 → 进程内 Map（本地 session 级，重启清空）
 *
 * TTL 按平台不同：
 * - tiktok/douyin：3600s（流 URL 较短命）
 * - 其他：21600s（6h）
 */
import type { VideoInfo } from "@streamgrab/types";

// ── Key 标准化 ──────────────────────────────────────────────
const ID_PATTERNS: Record<string, RegExp> = {
  bilibili: /(?:BV|bv)([a-zA-Z0-9]{10})/,
  douyin:   /video\/(\d+)/,
  tiktok:   /video\/(\d+)/,
  youtube:  /(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/,
};

function buildCacheKey(url: string, platform: string): string {
  const m = ID_PATTERNS[platform]?.exec(url);
  const id = m ? m[1] : Buffer.from(url).toString("base64url").slice(0, 32);
  return `streamgrab:parse:${platform}:${id}`;
}

function ttlFor(platform: string): number {
  return platform === "tiktok" || platform === "douyin" ? 3600 : 21600;
}

// ── 进程内 Map 后端（本地 / Vercel 无 KV 时）──────────────
interface CacheEntry { info: VideoInfo; expiresAt: number }
const _memCache = new Map<string, CacheEntry>();

function memGet(key: string): VideoInfo | null {
  const entry = _memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _memCache.delete(key); return null; }
  return entry.info;
}

function memSet(key: string, info: VideoInfo, ttl: number): void {
  _memCache.set(key, { info, expiresAt: Date.now() + ttl * 1000 });
}

function memDelete(key: string): void {
  _memCache.delete(key);
}

// ── Redis 后端（Upstash 或 ioredis）──────────────────────
// 包名通过 process.env 或运行时构造，完全绕过 Turbopack 静态分析

// 优先 Upstash（HTTP，Serverless 友好），其次 ioredis（TCP，传统 Redis）
function makeRedisClient() {
  // Upstash：需要 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
  if (process.env["UPSTASH_REDIS_REST_URL"] && process.env["UPSTASH_REDIS_REST_TOKEN"]) {
    try {
      // 包名拆分成数组再 join，让 Turbopack 静态分析无法识别
      const pkgName = ["@upstash", "redis"].join(String.fromCharCode(47));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Redis } = require(/* webpackIgnore: true */ pkgName);
      return { type: "upstash", client: new Redis() };
    } catch { /* 未安装，跳过 */ }
  }
  // ioredis：需要 REDIS_URL
  if (process.env["REDIS_URL"]) {
    try {
      const pkgName = ["io", "redis"].join("");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require(/* webpackIgnore: true */ pkgName);
      return { type: "ioredis", client: new Redis(process.env["REDIS_URL"]) };
    } catch { /* 未安装，跳过 */ }
  }
  return null;
}

const _redis = makeRedisClient();

async function kvGet(key: string): Promise<VideoInfo | null> {
  if (!_redis) return null;
  try {
    if (_redis.type === "upstash") {
      return await _redis.client.get(key) as VideoInfo | null;
    }
    const raw = await _redis.client.get(key);
    return raw ? JSON.parse(raw) as VideoInfo : null;
  } catch { return null; }
}

async function kvSet(key: string, info: VideoInfo, ttl: number): Promise<void> {
  if (!_redis) return;
  try {
    if (_redis.type === "upstash") {
      await _redis.client.set(key, info, { ex: ttl });
    } else {
      await _redis.client.set(key, JSON.stringify(info), "EX", ttl);
    }
  } catch { /* ignore */ }
}

async function kvDelete(key: string): Promise<void> {
  if (!_redis) return;
  try {
    await _redis.client.del(key);
  } catch { /* ignore */ }
}

// ── 公开 API ─────────────────────────────────────────────
const useKV = !!_redis;

export async function getCached(url: string, platform: string): Promise<VideoInfo | null> {
  const key = buildCacheKey(url, platform);
  const result = useKV ? await kvGet(key) : memGet(key);
  if (result) console.log(`[cache] hit key=${key}`);
  return result;
}

export async function setCached(url: string, platform: string, info: VideoInfo): Promise<void> {
  const key = buildCacheKey(url, platform);
  const ttl = ttlFor(platform);
  if (useKV) await kvSet(key, info, ttl);
  else memSet(key, info, ttl);
  console.log(`[cache] set key=${key} ttl=${ttl}s backend=${useKV ? "kv" : "mem"}`);
}

export async function deleteCached(url: string, platform: string): Promise<void> {
  const key = buildCacheKey(url, platform);
  if (useKV) await kvDelete(key);
  else memDelete(key);
  console.log(`[cache] delete key=${key}`);
}
