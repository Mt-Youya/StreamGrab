import { bilibiliParser, douyinParser, tiktokParser, youtubeParser } from "@streamgrab/parsers";
import type { IVideoParser, ParseOptions, VideoInfo } from "@streamgrab/types";

const parsers: IVideoParser[] = [bilibiliParser, douyinParser, tiktokParser, youtubeParser];

export function findParser(url: string): IVideoParser | null {
  return parsers.find((p) => p.match(url)) ?? null;
}

export async function dispatch(url: string, options: ParseOptions = {}): Promise<VideoInfo> {
  const parser = findParser(url);
  if (!parser) {
    throw new Error(`不支持该平台链接: ${url}`);
  }
  return parser.parse(url, options);
}

export { parsers };
