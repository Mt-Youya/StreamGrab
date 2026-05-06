import { DownloadForm } from "@/components/download-form";
import { VideoPreview } from "@/components/video-preview";
import { QualitySelector } from "@/components/quality-selector";
import { DownloadQueue } from "@/components/download-queue";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">StreamGrab</h1>
        <p className="text-muted-foreground text-lg">多平台无水印高清视频下载</p>
      </div>

      <DownloadForm />
      <VideoPreview />
      <QualitySelector />
      <DownloadQueue />
    </div>
  );
}
