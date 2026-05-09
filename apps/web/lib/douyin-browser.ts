/**
 * 抖音浏览器抓取实现
 *
 * 根据环境自动选择：
 * - 有 BROWSERLESS_TOKEN 环境变量 → Browserless 云端 API（Vercel）
 * - 否则 → 本地 Playwright（需安装 chromium）
 */

export async function douyinBrowserFetch(videoId: string, proxy?: string): Promise<string> {
  const token = process.env["BROWSERLESS_TOKEN"];
  if (token) {
    return fetchViaBrowserless(videoId, token, proxy);
  }
  return fetchViaLocalPlaywright(videoId, proxy);
}

async function fetchViaBrowserless(videoId: string, token: string, proxy?: string): Promise<string> {
  const proxyParam = proxy ? `&proxy=${encodeURIComponent(proxy)}` : "";
  const endpoint = `https://production-sfo.browserless.io/chromium/function?token=${token}${proxyParam}`;

  const code = `
    export default async ({ page }) => {
      let detailBody = null;
      page.on('response', async (resp) => {
        const url = resp.url();
        if (url.includes('/aweme/v1/web/aweme/detail/') && url.includes('${videoId}')) {
          const body = await resp.text().catch(() => '');
          if (body.includes('aweme_detail')) detailBody = body;
        }
      });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
      });
      await page.goto('https://www.douyin.com/video/${videoId}', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      const deadline = Date.now() + 15000;
      while (!detailBody && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 300));
      }
      if (!detailBody) throw new Error('超时未获取到抖音数据');
      return { data: detailBody };
    };
  `;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Browserless 请求失败 ${resp.status}: ${text.slice(0, 200)}`);
  }

  const result = (await resp.json()) as { data: string };
  return result.data;
}

async function fetchViaLocalPlaywright(videoId: string, proxy?: string): Promise<string> {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "zh-CN",
      ...(proxy ? { proxy: { server: proxy } } : {}),
    });

    let detailBody: string | null = null;
    context.on("response", async (resp) => {
      if (detailBody) return;
      const url = resp.url();
      if (url.includes("/aweme/v1/web/aweme/detail/") && url.includes(videoId)) {
        const body = await resp.text().catch(() => "");
        if (body.includes("aweme_detail")) detailBody = body;
      }
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
    });

    const page = await context.newPage();
    await page.goto(`https://www.douyin.com/video/${videoId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const deadline = Date.now() + 15000;
    while (!detailBody && Date.now() < deadline) {
      await page.waitForTimeout(300);
    }
    await browser.close();

    if (!detailBody) throw new Error("等待抖音 API 响应超时");
    return detailBody;
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}
