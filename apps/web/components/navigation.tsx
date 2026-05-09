"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Download, History, Settings, Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "下载", icon: Download },
  { href: "/history", label: "历史记录", icon: History },
  { href: "/settings", label: "设置", icon: Settings },
];

/** 轻量轮询 B站登录状态（30s 间隔，仅主页需要） */
function useBilibiliLoginStatus() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const resp = await fetch("/api/bilibili-login");
        if (!resp.ok) return;
        const data = (await resp.json()) as { loggedIn: boolean };
        setLoggedIn(data.loggedIn);
      } catch {}
    }
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  return loggedIn;
}

export function Navigation() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const bilibiliLoggedIn = useBilibiliLoginStatus();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-base tracking-tight text-foreground"
          aria-label="StreamGrab 首页"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          StreamGrab
        </Link>

        {/* Nav items */}
        <nav className="flex items-center gap-0.5" aria-label="主导航">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                pathname === href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
              aria-current={pathname === href ? "page" : undefined}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
              {/* B 站登录状态小点 — 设置页显示，提示用户配置 */}
              {href === "/settings" && bilibiliLoggedIn === false && (
                <span
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500"
                  title="B站未登录，4K/1080P+ 画质需要扫码登录"
                />
              )}
            </Link>
          ))}

          {/* 主题切换 */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="ml-1 h-8 w-8"
            aria-label={resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Moon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>
        </nav>
      </div>
    </header>
  );
}
