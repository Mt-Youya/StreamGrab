import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@streamgrab/types", "@streamgrab/core", "@streamgrab/parsers"],
  serverExternalPackages: ["playwright", "@distube/ytdl-core", "youtubei.js", "better-sqlite3", "undici"],
  // ffmpeg-wasm 需要 SharedArrayBuffer，要求 COOP + COEP headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.bilibili.com" },
      { protocol: "https", hostname: "**.douyinpic.com" },
      { protocol: "https", hostname: "**.douyinstatic.com" },
      { protocol: "https", hostname: "**.tiktokcdn.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
};

export default nextConfig;
