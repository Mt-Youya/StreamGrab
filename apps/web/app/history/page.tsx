import { HistoryTable } from "@/components/history-table";

export const metadata = { title: "历史记录 — StreamGrab" };

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">下载历史</h1>
        <p className="text-muted-foreground text-sm mt-1">查看所有已下载的视频记录</p>
      </div>
      <HistoryTable />
    </div>
  );
}
