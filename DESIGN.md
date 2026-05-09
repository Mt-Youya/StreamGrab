---
name: StreamGrab
description: 多平台无水印视频下载工具，精准、克制、无噪声
colors:
  dark-bg: "#0b0f1a"
  surface: "#111827"
  surface-mid: "#1a2233"
  border: "#1e2d45"
  text-base: "#f0f4fc"
  text-muted: "#637089"
  destructive: "#d94f4f"
  mono-accent: "#4fffb0"
  light-bg: "#f7f9fc"
  light-surface: "#ffffff"
  light-border: "#dde4ee"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.text-base}"
    textColor: "{colors.dark-bg}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.mono-accent}"
    textColor: "{colors.dark-bg}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-mid}"
    textColor: "{colors.text-base}"
  input-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-base}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  input-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-base}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  nav-item-active:
    backgroundColor: "{colors.surface-mid}"
    textColor: "{colors.text-base}"
---

# Design System: StreamGrab

## 1. Overview

**Creative North Star: "The Extraction Engine"**

StreamGrab 的界面就是流程本身。没有装饰性元素，没有品牌 hero，没有指引用户"发现功能"的视觉技巧。界面存在的理由只有一个：让用户在 3 步之内从链接到文件。这是极客工具美学的核心承诺：用密度代替留白，用状态颜色代替装饰，用精确文字代替模糊图标。

视觉系统建立在深海军蓝黑的基础上（而非纯黑，纯黑没有空气感），每一个表面层级通过细微的亮度差异区分。没有阴影。没有渐变文字。颜色仅在表达状态语义时出现：错误用红，成功用淡绿（等宽强调色），加载用脉冲动画，否则回到中性。

这个系统明确拒绝的：下载网站的按钮轰炸和颜色混乱（y2mate 气质）；SaaS landing page 的卡片堆叠和渐变 hero；以及任何让界面"显得有设计感"而非"完成任务"的装饰。

**Key Characteristics:**
- 深色为第一公民，浅色为主题变体（而非相反）
- 等宽字体仅用于数字、文件大小、状态标签、进度等信息密度元素
- 颜色密度是唯一的状态分层手段：无阴影、无渐变
- 边框优于阴影：分割依赖 1px 低对比度线，不是 box-shadow
- 主流程（输入 → 解析 → 选画质 → 下载）的 CTA 对比度必须达到 AAA

## 2. Colors: The Depth Stack

这个调色板是一列深度栈，从暗底往上每级 surface 增加 2-3% 亮度，用于建立层次感而非阴影。唯一的有色强调是冷调的极光绿，仅用于成功状态和首要 CTA hover。

### Primary
- **Extraction Ground** (`#0b0f1a` / `oklch(0.13 0.025 258)`): 页面背景。深海军蓝黑，不是纯黑，带有轻微蓝色偏移让画面有空气感。
- **Surface Layer** (`#111827` / `oklch(0.16 0.022 258)`): 卡片、输入框、悬浮面板的背景色。比 Ground 亮 3%。
- **Surface Mid** (`#1a2233` / `oklch(0.20 0.020 258)`): 激活状态的导航项、选中 tab、hover 状态的控件背景。
- **Aurora Accent** (`#4fffb0` / `oklch(0.90 0.15 160)`): 成功状态、首要 CTA hover、下载进度完成指示。使用面积 ≤5%。

### Neutral
- **Frost Text** (`#f0f4fc` / `oklch(0.96 0.004 220)`): 正文、标题、所有主要文字。
- **Dim Text** (`#637089` / `oklch(0.55 0.012 234)`): 辅助说明、placeholder、版权行、非激活导航。
- **Grid Line** (`#1e2d45` / `oklch(0.22 0.018 258)`): 分割线、输入框边框、卡片边框。设计上几乎不可见，只为确认边界存在。

### Tertiary
- **Alert Red** (`#d94f4f` / `oklch(0.57 0.21 27)`): 错误消息、解析失败状态。仅语义使用。

### Light Mode Counterparts
- **Ice Surface** (`#f7f9fc`): 浅色背景，带极轻蓝调避免纯白刺眼。
- **Pane White** (`#ffffff`): 浅色卡片/输入框背景（浅色模式）。
- **Slate Border** (`#dde4ee`): 浅色模式分割线。

### Named Rules
**The No-Color Rule.** Aurora Accent 出现在 ≤5% 的像素上。它只标记成功和首要 CTA hover。任何其他颜色使用均为错误。状态靠密度区分，靠颜色只作为最后一层语义强调。

## 3. Typography: Functional Hierarchy

**Body Font:** 系统字体栈 (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
**Mono Font:** `JetBrains Mono`，回退 `Fira Code → Cascadia Code → Consolas`（仅限数字密度场景）

**Character:** 无衬线系统字体提供跨平台最优中文渲染，配等宽字体处理数值型内容（文件大小、进度百分比、时长、画质标签），两种字体的对比本身就是 UI 语法：等宽 = 数据，无衬线 = 说明。

### Hierarchy
- **Display** (700, 2.25rem, lh 1.1, ls -0.02em): 仅用于页面大标题，如 "StreamGrab"。全局唯一一处。
- **Title** (600, 1.125rem, lh 1.3, ls -0.01em): 区块标题、下载结果视频名称。
- **Body** (400, 0.875rem, lh 1.6): 所有说明文字、错误消息、状态描述。行宽上限 65ch。
- **Label** (Mono 500, 0.75rem, lh 1.4, ls 0.02em): 文件大小（114.5 MB）、画质标签（1080P、4K）、进度（72%）、时长（03:45）、平台标识。

### Named Rules
**The Mono-Data Rule.** 等宽字体仅用于数值型内容。用等宽字体写标题或说明文字是错误的。判断准则：这个文字会随数据变化数值吗？是 → 等宽；否 → 系统字体。

## 4. Elevation

StreamGrab 是完全平面的系统。没有 `box-shadow`，没有 `drop-shadow`。深度通过颜色密度传达：背景 → 表面 → 表面中层，三个亮度台阶构成所有层次关系。Sticky 导航用 `backdrop-filter: blur(8px)` + `border-bottom` 与内容分离，而非阴影。

**悬浮反馈**通过背景色从 transparent 切换到 `surface-mid` 实现，而非加阴影。这与"提取机器"的工业感匹配：状态切换是即时的，不是漂浮的。

### Named Rules
**The Flat-By-Default Rule.** 任何试图加 `box-shadow` 的元素都需要质疑。问：层次关系能用 border 或背景色密度表达吗？90% 的情况下答案是"可以"。阴影是保留给极少数真正需要脱离文档流的浮层（下拉菜单、tooltip）的奢侈品。

## 5. Components

### Buttons

工具感、即时响应、无圆润感。形状保持克制（6px 圆角），用颜色翻转而非阴影或位移表达交互。

- **Shape:** 轻微圆角（`6px`），避免完全方正的工业冷硬感，也避免 pill 按钮的圆润感。
- **Primary:** 前景色背景（`#f0f4fc`）+ 深色文字（`#0b0f1a`），高对比高辨识。Hover：背景切换到 Aurora Accent（`#4fffb0`）。`h-10 px-4`。
- **Ghost:** 透明背景，Dim Text 颜色。Hover：Surface Mid 背景 + Frost Text 颜色。`h-9 px-3`。
- **Destructive:** Alert Red 背景，不单独使用 outline destructive。
- **Icon Button:** `h-10 w-10`，Ghost 变体。

### Inputs / Fields

- **Style:** Surface Layer 背景（`#111827`），1px Grid Line 边框，6px 圆角，无填充背景切换。
- **Focus:** 边框变亮至 `text-muted`（`#637089`），加 2px ring（`oklch(0.55 0.012 234 / 0.4)`）。不用 Aurora Accent 做 focus ring，避免成功色与焦点状态混淆。
- **Placeholder:** Dim Text（`#637089`），字号同正文。
- **High:** `h-12 text-base`（主下载输入框），视觉上比导航控件更重要。
- **Error:** 边框变为 Alert Red，下方 `text-sm text-destructive` 错误行。

### Cards / Containers

仅在需要视觉分组时使用。能用间距和边框解决的不用卡片。

- **Corner Style:** 8px（比按钮稍大，容器感）
- **Background:** Surface Layer（`#111827`）
- **Shadow Strategy:** 无。边框 1px Grid Line 定边界。
- **Border:** `1px solid #1e2d45`
- **Internal Padding:** `24px`（大容器）/ `16px`（紧凑列表项）

### Navigation

- **Style:** 粘性顶栏，`background: rgba(11,15,26,0.9)` + `backdrop-filter: blur(8px)` + `border-bottom: 1px solid #1e2d45`。
- **Logo:** 系统字体 Bold，加 Download 图标前缀，视觉上属于导航而非 hero。
- **Nav Items:** Ghost 按钮变体，激活态背景 Surface Mid。不用下划线。
- **Theme Toggle:** Icon Ghost 按钮。`ml-2` 隔开。
- **Mobile:** 三条导航项 + toggle 在小屏依然能并排，`text-sm` 保持紧凑。

### Download Form (Signature Component)

主页核心组件，deserves special treatment。

- **URL Input:** `h-12`，全宽，视觉权重最高的输入框。
- **Parse Button:** `h-12 px-6`，Primary 变体，与 Input 等高形成一排。Loading 状态用 `Loader2` spin icon + "解析中" 文字。
- **Platform Hint:** Mono Label，`text-xs text-muted-foreground`，解析中显示平台特定等待提示。
- **错误行:** `text-sm text-destructive`，直接在输入框下方。不用 toast，不用 modal。

## 6. Do's and Don'ts

### Do:
- **Do** 用颜色密度（亮度台阶）区分层次，而不是阴影。深底 `#0b0f1a` → 表面 `#111827` → 中层 `#1a2233`。
- **Do** 用等宽字体（JetBrains Mono）展示所有数值：文件大小、画质（1080P/4K）、进度百分比、时长。
- **Do** 保持错误消息内联，紧跟出错的输入框，用 `text-sm text-destructive` 样式。
- **Do** 让 Aurora Accent（`#4fffb0`）只在成功状态和首要 CTA hover 时出现，总面积 ≤5%。
- **Do** 为主下载流程的所有可操作控件（输入框、解析按钮、下载按钮）保持 AAA 对比度。
- **Do** 用 `backdrop-filter: blur(8px)` + `border-bottom` 处理粘性导航，不加阴影。

### Don't:
- **Don't** 引入 y2mate / savefrom 那种下载网站气质：多余按钮、广告位形式的颜色区块、超过 2 个 CTA 并排。
- **Don't** 用 SaaS landing page 的卡片堆叠模式：等高等宽 icon + 标题 + 文字的重复 grid，或 hero 区的渐变背景 + 大数字。
- **Don't** 使用 `background-clip: text` 渐变文字。任何文字只用一个固定颜色。
- **Don't** 在卡片、列表项、告警框上使用大于 1px 的 `border-left` 彩色竖条作为装饰。
- **Don't** 在 `box-shadow` 为 `none` 以外的元素上加阴影，除非是真正脱离文档流的浮层（dropdown、tooltip）。
- **Don't** 用 Aurora Accent 做 focus ring，focus 与成功状态不能共用颜色，会破坏语义清晰度。
- **Don't** 用玻璃态（glassmorphism）作为装饰：模糊卡片、白色半透明面板叠在深色背景上。唯一允许的 blur 是导航 backdrop-filter，且仅服务于功能目的（防止内容与标题文字重叠）。
