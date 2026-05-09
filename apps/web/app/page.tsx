import { DownloadForm } from "@/components/download-form";
import { VideoPreview } from "@/components/video-preview";
import { QualitySelector } from "@/components/quality-selector";
import { DownloadQueue } from "@/components/download-queue";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 pb-16">
      {/* 输入区：视觉焦点，紧凑标题给输入框让位 */}
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">多平台 · 无水印 · 画质自选</p>
        <DownloadForm />
      </div>

      {/* 解析结果区：宽间距与上方输入区分隔 */}
      <div className="mt-10 space-y-4">
        <VideoPreview />
        <QualitySelector />
      </div>

      {/* 下载队列：语义上独立，间距更大 */}
      <div className="mt-8">
        <DownloadQueue />
      </div>
    </div>
  );
}
