"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/lib/detect-platform";
import { formatFileSize } from "@/lib/utils";
import { listHistory, deleteHistory } from "@/lib/db";
import type { HistoryRecord, Platform } from "@streamgrab/types";
import { Trash2, Search, RefreshCw } from "lucide-react";

const PLATFORMS: Array<{ value: Platform | ""; label: string }> = [
  { value: "", label: "全部平台" },
  { value: "bilibili", label: "Bilibili" },
  { value: "douyin", label: "抖音" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
];

export function HistoryTable() {
  const [platform, setPlatform] = useState<Platform | "">("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [records, setRecords] = useState<HistoryRecord[]>([]);

  const load = useCallback(() => {
    setRecords(listHistory(platform || undefined));
  }, [platform]);

  useEffect(() => { load(); }, [load]);

  function handleDelete(id: string) {
    deleteHistory(id);
    load();
  }

  function handleDeleteSelected() {
    selected.forEach((id) => deleteHistory(id));
    setSelected(new Set());
    load();
  }

  const filtered = records.filter((r) =>
    r.title.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题..."
            className="pl-8"
          />
        </div>
        <Select
          value={platform}
          onChange={(e) => { setPlatform(e.target.value as Platform | ""); }}
          className="w-36"
        >
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
        <Button variant="outline" size="icon" onClick={load}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
            <Trash2 className="h-4 w-4 mr-1" />
            删除 {selected.size} 项
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">暂无下载记录</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(filtered.map((r) => r.id)));
                      else setSelected(new Set());
                    }}
                  />
                </th>
                <th className="p-3 text-left">视频</th>
                <th className="p-3 text-left hidden sm:table-cell">平台</th>
                <th className="p-3 text-left hidden md:table-cell">画质</th>
                <th className="p-3 text-left hidden md:table-cell">大小</th>
                <th className="p-3 text-left hidden lg:table-cell">时间</th>
                <th className="p-3 text-center w-16">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((record) => (
                <tr key={record.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(record.id)}
                      onChange={() => toggleSelect(record.id)}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {record.cover && (
                        <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
                          <Image
                            src={record.cover}
                            alt=""
                            fill
                            className="object-cover"
                            unoptimized
                          />
                        </div>
                      )}
                      <span className="line-clamp-1 font-medium">{record.title}</span>
                    </div>
                  </td>
                  <td className="p-3 hidden sm:table-cell">
                    <Badge className={PLATFORM_COLORS[record.platform]}>
                      {PLATFORM_LABELS[record.platform]}
                    </Badge>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{record.quality}</td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">
                    {formatFileSize(record.size)}
                  </td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground text-xs">
                    {new Date(record.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="p-3 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleDelete(record.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
