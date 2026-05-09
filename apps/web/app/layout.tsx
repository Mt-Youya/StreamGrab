import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Navigation } from "@/components/navigation";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";

// 使用系统字体，避免 Google Fonts 网络依赖
const inter = { className: "font-sans" };

export const metadata: Metadata = {
  title: "StreamGrab — 多平台无水印视频下载",
  description: "支持 Bilibili、抖音、TikTok、YouTube 的无水印高清视频下载工具",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive" src="/theme-init.js" />
      </head>
      <body className={`${inter.className} min-h-screen bg-background antialiased`}>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Navigation />
            <main className="flex-1">{children}</main>
            <footer className="border-t py-4 text-center text-sm text-muted-foreground">
              StreamGrab · 仅供个人学习研究使用
            </footer>
          </div>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
