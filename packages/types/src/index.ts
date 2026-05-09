export type Platform = "bilibili" | "douyin" | "tiktok" | "youtube";

export interface VideoStream {
  quality: string;
  label: string;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  bitrate?: number;
  size?: number;
  audioUrl?: string;
  /** yt-dlp format_id，用于精确指定下载格式（TikTok/YouTube） */
  formatId?: string;
  /** 该画质被权限锁定（需要登录或大会员），无实际下载地址 */
  locked?: boolean;
  /** 解锁该画质所需的条件说明 */
  lockReason?: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  cover: string;
  duration: number;
  author: string;
  platform: Platform;
  streams: VideoStream[];
  rawUrl: string;
}

export interface ParseOptions {
  cookie?: string;
  douyinCookieFile?: string;
  proxy?: string;
  format?: string;
  ytdlpPath?: string;
  // 浏览器抓取函数注入（抖音/TikTok 平台使用）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browserFetch?: (...args: any[]) => Promise<string>;
}

export type DownloadStatus = "pending" | "downloading" | "done" | "error";

export interface DownloadTask {
  taskId: string;
  status: DownloadStatus;
  progress: number;
  filename: string;
  error?: string;
  createdAt: number;
}

export interface HistoryRecord {
  id: string;
  title: string;
  platform: Platform;
  quality: string;
  url: string;
  filename: string;
  size?: number;
  cover: string;
  createdAt: number;
}

export interface IVideoParser {
  platform: Platform;
  match(url: string): boolean;
  parse(url: string, options: ParseOptions): Promise<VideoInfo>;
}

export interface ParseApiResponse {
  success: boolean;
  data?: VideoInfo;
  error?: string;
}

export interface DownloadApiRequest {
  url: string;
  streamUrl: string;
  audioUrl?: string;
  quality: string;
  filename: string;
  taskId: string;
  formatId?: string;
  outputFormat?: string; // mp4 | mkv | webm
  mimeType?: string;
  proxy?: string;
  ytdlpPath?: string;
}

export interface StatusApiResponse {
  taskId: string;
  status: DownloadStatus;
  progress: number;
  error?: string;
}
