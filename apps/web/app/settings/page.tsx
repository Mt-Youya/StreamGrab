"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, LogIn, LogOut, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Server } from "lucide-react";
import QRCode from "qrcode";

const SETTINGS_KEY = "streamgrab_settings";

interface Settings {
  httpProxy: string;
  ytdlpPath: string;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as Settings;
  } catch {}
  return { httpProxy: "", ytdlpPath: "yt-dlp" };
}

type BiliLoginState = "idle" | "loading" | "qrcode" | "scanned" | "confirmed" | "error";

interface SysFeature {
  ok: boolean;
  note: string;
  install?: string;
}
interface SysCheck {
  isVercel: boolean;
  deps: {
    ffmpeg: { available: boolean; version?: string };
    playwright: { available: boolean };
    browserlessToken: boolean;
  };
  features: Record<string, SysFeature>;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    httpProxy: "http://127.0.0.1:7897",
    ytdlpPath: "yt-dlp",
  });
  const [saved, setSaved] = useState(false);
  const [sysCheck, setSysCheck] = useState<SysCheck | null>(null);

  // Bilibili 登录状态
  const [biliState, setBiliState] = useState<BiliLoginState>("idle");
  const [biliMsg, setBiliMsg] = useState("");
  const [biliLoggedIn, setBiliLoggedIn] = useState(false);
  const [qrcodeDataUrl, setQrcodeDataUrl] = useState("");
  const qrcodeKeyRef = useRef("");
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    // 系统依赖检查
    fetch("/api/system-check")
      .then((r) => r.json())
      .then((d: SysCheck) => setSysCheck(d))
      .catch(() => {});
    // 检查当前登录状态
    fetch("/api/bilibili-login")
      .then((r) => r.json())
      .then((d: { loggedIn: boolean }) => setBiliLoggedIn(d.loggedIn))
      .catch(() => {});
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  function handleSave() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function update(key: keyof Settings, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleBiliLogin() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setBiliState("loading");
    setBiliMsg("正在生成二维码...");
    try {
      const resp = await fetch("/api/bilibili-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const data = (await resp.json()) as {
        success: boolean;
        url?: string;
        qrcode_key?: string;
        error?: string;
      };
      if (!data.success || !data.url || !data.qrcode_key) {
        throw new Error(data.error ?? "生成二维码失败");
      }
      qrcodeKeyRef.current = data.qrcode_key;
      // 生成二维码图片
      const dataUrl = await QRCode.toDataURL(data.url, { width: 200, margin: 1 });
      setQrcodeDataUrl(dataUrl);
      setBiliState("qrcode");
      setBiliMsg("请用哔哩哔哩 App 扫码登录（3 分钟内有效）");

      // 开始轮询
      pollTimerRef.current = setInterval(async () => {
        try {
          const pr = await fetch("/api/bilibili-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "poll", qrcode_key: qrcodeKeyRef.current }),
          });
          const pd = (await pr.json()) as { success: boolean; status?: string };
          if (pd.status === "scanned") {
            setBiliState("scanned");
            setBiliMsg("已扫码，请在手机上确认登录...");
          } else if (pd.status === "confirmed") {
            clearInterval(pollTimerRef.current!);
            setBiliState("confirmed");
            setBiliLoggedIn(true);
            setBiliMsg("登录成功！高清画质已解锁");
            setQrcodeDataUrl("");
          } else if (pd.status === "expired") {
            clearInterval(pollTimerRef.current!);
            setBiliState("error");
            setBiliMsg("二维码已过期，请重新生成");
            setQrcodeDataUrl("");
          }
        } catch {
          // 轮询出错，继续等待
        }
      }, 2000);
    } catch (e) {
      setBiliState("error");
      setBiliMsg((e as Error).message);
    }
  }

  async function handleBiliLogout() {
    await fetch("/api/bilibili-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setBiliLoggedIn(false);
    setBiliState("idle");
    setBiliMsg("");
    setQrcodeDataUrl("");
  }

  const FEATURE_LABELS: Record<string, string> = {
    bilibili_parse: "B站解析",
    bilibili_hq: "B站高清下载（音视频合并）",
    douyin: "抖音解析",
    tiktok: "TikTok",
    youtube: "YouTube",
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">设置</h1>
        <p className="text-muted-foreground text-sm mt-1">配置平台登录和下载选项</p>
      </div>

      {/* 环境检查 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            运行环境
            {sysCheck && (
              <span className="text-xs font-normal text-muted-foreground ml-auto">
                {sysCheck.isVercel ? "☁️ Vercel 部署" : "💻 本地部署"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!sysCheck ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              检测中...
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(sysCheck.features).map(([key, f]) => (
                <div key={key} className="flex items-start gap-2 text-sm">
                  {f.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-medium">{FEATURE_LABELS[key] ?? key}</span>
                    <span className="text-muted-foreground ml-2">{f.note}</span>
                    {!f.ok && f.install && (
                      <pre className="mt-1 text-xs bg-muted rounded px-2 py-1 overflow-x-auto">{f.install}</pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bilibili */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Bilibili 设置</span>
            {biliLoggedIn && (
              <span className="text-xs font-normal text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle className="h-3 w-3" /> 已登录
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            未登录可解析到 480P，登录普通账号可解析到 1080P，大会员账号可解析到 4K/HDR。
          </p>

          {/* 二维码展示区 */}
          {qrcodeDataUrl && (
            <div className="flex flex-col items-center gap-2 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrcodeDataUrl} alt="Bilibili 扫码登录" className="rounded border" />
              <p className={`text-xs ${biliState === "scanned" ? "text-green-600" : "text-muted-foreground"}`}>
                {biliMsg}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {biliLoggedIn ? (
              <Button variant="outline" onClick={handleBiliLogout} className="gap-2">
                <LogOut className="h-4 w-4" />
                退出登录
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={handleBiliLogin}
                disabled={biliState === "loading" || biliState === "qrcode" || biliState === "scanned"}
                className="gap-2 flex-1"
              >
                {biliState === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : biliState === "qrcode" || biliState === "scanned" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {biliState === "qrcode" || biliState === "scanned"
                  ? "等待扫码..."
                  : biliState === "loading"
                    ? "生成中..."
                    : "扫码登录"}
              </Button>
            )}
            {(biliState === "error" || (biliState === "qrcode" && !biliLoggedIn)) && (
              <Button variant="ghost" size="icon" onClick={handleBiliLogin} title="重新生成">
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>

          {biliState === "error" && <p className="text-xs text-destructive">{biliMsg}</p>}
          {biliState === "confirmed" && (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> {biliMsg}
            </p>
          )}
          {biliState === "idle" && !biliLoggedIn && !biliMsg && (
            <p className="text-xs text-muted-foreground">不登录也可以解析，只是画质最高到 480P。</p>
          )}
        </CardContent>
      </Card>

      {/* 抖音 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">抖音设置</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            抖音解析完全自动化——粘贴链接后，系统会启动无头浏览器自动处理所有签名和认证，无需配置 Cookie，每次解析约需
            10–15 秒。下载的视频均为无水印版本。
          </p>
        </CardContent>
      </Card>

      {/* 网络代理 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">网络代理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">HTTP 代理地址</label>
            <Input
              value={settings.httpProxy}
              onChange={(e) => update("httpProxy", e.target.value)}
              placeholder="http://127.0.0.1:7897"
            />
            <p className="text-xs text-muted-foreground">TikTok 和 YouTube 需要通过代理访问。</p>
          </div>
        </CardContent>
      </Card>

      {/* yt-dlp */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">yt-dlp 配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">yt-dlp 可执行文件路径</label>
            <Input
              value={settings.ytdlpPath}
              onChange={(e) => update("ytdlpPath", e.target.value)}
              placeholder="yt-dlp"
            />
            <p className="text-xs text-muted-foreground">
              若 yt-dlp 不在 PATH 中，请填写完整路径，如 /usr/local/bin/yt-dlp。
            </p>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} className="w-28">
          {saved ? <CheckCircle className="h-4 w-4 mr-1" /> : null}
          {saved ? "已保存" : "保存设置"}
        </Button>
        <p className="text-xs text-muted-foreground">设置保存在浏览器本地存储中</p>
      </div>
    </div>
  );
}
