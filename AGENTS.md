# AGENTS.md

面向 AI 编码代理（以及第一次接手的人）的项目说明。目标是让你**不必先读完全部源码**就能
改对地方、跑对命令、避开已经踩过的坑。

> 人类读者请看 [`README.md`](README.md)；换栈的技术选型论证见
> [`docs/electron-migration-evaluation.md`](docs/electron-migration-evaluation.md)。

---

## 1. 这是什么

Songloft 音乐播放器的 **Electron 桌面客户端**。

* 上游原项目 [`songloft-org/songloft-player`](https://github.com/songloft-org/songloft-player)
  是 Flutter 客户端 + 自建 Go 后端。**本仓库只重写客户端，且只做 Windows / macOS / Linux 桌面**，
  不含移动端、Web 端，也**不含后端**。
* 后端协议、接口语义、曲库模型**完全沿用上游**，不做私有扩展。
* 本仓库地址：<https://github.com/edwinhuish/songloft-desktop>

本地联调需要另外跑一个 Songloft 后端（默认 `http://localhost:58091`，默认管理员 `admin` / `admin`）。
后端没起来时应用不会崩，会停在带可操作提示的登录页。

---

## 2. 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 运行时 | Node.js | `>= 22.12.0` |
| 包管理 | pnpm | `12.4.1`（`packageManager` 已锁） |
| 容器 | Electron | `44.7.0` |
| 构建 | electron-vite / vite | `5.0.0` / `7.3.7` |
| 界面 | React + TypeScript | `19.3.0` / `6.0.3` |
| 状态 | zustand | `5.0.15` |
| 测试 | vitest | `5.0.4` |
| 打包 | electron-builder | `26.15.3` |
| 规范 | ESLint（flat config）/ Prettier | `10.12.0` / `3.9.10` |

**运行期依赖只有 `zustand` 一个** —— 其余全在 `devDependencies`。加新依赖前先问自己能不能不加。

---

## 3. 命令

```bash
pnpm install              # postinstall 会拉 Electron 二进制
pnpm dev                  # 开发（渲染层 HMR）

pnpm run check            # ★ 提交前必跑：typecheck + lint + format:check + test
pnpm run build            # 产出 out/（main + preload + renderer）
pnpm run e2e              # 端到端 UI 巡检（起 mock 后端 + 截图 + 断言）
pnpm run pack:linux       # 打 deb / AppImage / tar.gz 到 release/
pnpm run verify:package   # 校验打包产物的桌面集成项
pnpm run icons            # 由 build/icon.svg 生成全套图标 + 托盘图
```

| 想改的东西 | 至少跑这些 |
|---|---|
| `src/shared/` 的纯函数 | `pnpm run check` |
| 渲染层组件 / 页面 | `pnpm run check` + `pnpm run e2e` |
| 主进程、preload、IPC | `pnpm run check` + `pnpm run e2e` |
| `package.json` / `electron-builder.yml` / `build/` | 上面全部 + `pnpm run pack:linux` + `pnpm run verify:package` |

---

## 4. 目录职责

```
src/
├─ main/          Electron 主进程（Node 环境，唯一持有系统权限的地方）
│  ├─ index.ts        生命周期、窗口创建、安全策略与 CSP、setDesktopName、userData 覆盖
│  ├─ windows.ts      BrowserWindow 构造（contextIsolation / sandbox / nodeIntegration）
│  ├─ media-keys.ts   媒体键（globalShortcut 兜底；优先走 Media Session 自动映射）
│  ├─ store.ts        本地持久化：设置 / 凭据 / 服务器列表（JSON，落在 userData）
│  ├─ probe.ts        后端探测（本地 Blob 解码，避免为它关掉 webSecurity）
│  ├─ tray.ts         托盘图标与菜单
│  └─ app-menu.ts     应用菜单（窗口无边框、看不到菜单栏，但它提供全局加速键）
├─ preload/        contextBridge 白名单 —— 渲染层唯一的对外通道（window.songloft）
├─ shared/         两侧共用的**纯代码**，无副作用、可直接单测
│  ├─ types.ts        后端数据模型（Song / Playlist / Facet…）
│  ├─ ipc.ts          IPC 频道常量 + 跨进程传输的类型 + 默认设置
│  ├─ bridge.ts       window.songloft 的接口定义（白名单的唯一事实源）
│  ├─ bridge-types.ts 桥接层的小类型
│  ├─ lyric.ts        歌词四路合并 + 解析 + 当前行/逐字定位
│  └─ links.ts        对外 URL 常量（本仓库 / 上游）
└─ renderer/       React 19 + zustand
   ├─ api/           client.ts（fetch 封装）/ endpoints.ts（端点清单，来自上游 Flutter 实现）
   ├─ state/         useAuth / usePlayer / usePlaylists / useSettings / useUi / useToasts
   ├─ pages/         9 个页面：Home / Library / Playlists / PlaylistDetail / Favorites /
   │                 Recent / Search / Settings / Login
   │                 （「文件夹」不是独立页面，是 LibraryPage 里的一个标签，见 FoldersView）
   ├─ components/    Sidebar / TitleBar / SongTable / PlayerBar / LyricsView / CommandPalette /
   │                 Panel / ContextMenu / Modal / Toasts / SelectionBar / …
   ├─ hooks/         useSongList / usePlaylistSongs / useAsync
   ├─ lib/           url（资源 URL 拼接）/ color / accent / format / concurrency
   └─ styles/        tokens.css / base.css / components.css / index.css
```

---

## 5. 架构与数据流

1. **渲染层是「不可信的」**，所有系统能力经 `preload` 白名单（`window.songloft`）转出，
   注册在 `src/shared/bridge.ts`，实现在 `src/preload/index.ts`，由 `ipcRenderer.invoke` 落到主进程。
2. **IPC 频道名一律用 `IPC` 常量**（`@shared/ipc`），不要写字符串字面量 —— 先加常量再接线。
3. **播放**走 `HTMLAudioElement` + **Media Session API**。Chromium 会把它自动映射成 Linux 的
   MPRIS / Windows 的 SMTC / macOS 的 Now Playing，**不需要**为每个平台写原生桥。
   键盘媒体键另走 `globalShortcut` 兜底。
4. **媒体地址带 `access_token` 查询参数**（`lib/url.ts`）：封面/音频是交给 `img` / `audio` 直接请求的，
   走不了带 `Authorization` 头的 fetch 封装。
5. **封面取主色由主进程代取字节**（`cover:extract`）：渲染层直接读跨域 `canvas` 会污染画布。
6. **持久化只在主进程**（`store.ts`）：设置（本地偏好）/ 凭据（token）/ 服务器列表。
   渲染层启动时拉一次，之后靠 IPC 读写。

---

## 6. 硬性约定

* **渲染层不得** `import electron` / `node:fs` / `node:child_process` —— ESLint
  `no-restricted-imports` 会拦。需要新能力就「加 IPC 常量 → preload 白名单 → 渲染层调 `window.songloft`」。
* **`shared/` 只放纯代码**：无副作用、不读全局、不 import electron。这样它既能被两侧复用，又能直接单测。
* **代码风格**：Prettier 说了算（`printWidth: 100`、无分号、单引号）。`pnpm run format` 一键修。
  源码文件**不允许**超出 `printWidth` —— `format:check` 挂在 `check` 里，超了会红。
* **注释与文档用中文**，且解释「**为什么**」而不是复述代码。
* 优先用约束把错误变成不可能（类型、常量、断言脚本），而不是靠注释提醒。
* 遵循 DRY：同一个值出现第二处时，提取到 `shared/`（例如 `shared/links.ts` 的两个 URL）。
* **不要为了通过 lint 而写 `eslint-disable`**：先判断规则是不是在指出真问题。

---

## 7. 验证方式（各自能抓到什么）

| 手段 | 能抓到 |
|---|---|
| `pnpm run check` | 类型错误、lint、格式、`shared/` 纯函数的行为（单测） |
| `pnpm run e2e` | **界面真的渲染成了什么**：真实点击 + DOM 断言 + 截图 |
| `pnpm run verify:package` | **打包产物里的桌面集成**是否正确（解包 deb / AppImage / tar.gz 后断言） |

**为什么必须有 E2E 而不只是截图**：截图看着正常、实际少几行的缺陷是真实发生过的
（见下节「歌词丢行」）。E2E 的断言用**内容**而不只是计数 —— 例如流派分面的卡片数与歌手分面
同为 5，只数个数区分不出「有没有点中 chip」，所以断言的是卡片的**文字**变成流派名。

`scripts/e2e/` 的结构：`server.mjs`（mock 后端）、`drive.mjs`（CDP 驱动器 + 步骤与断言）、
`run.sh`（编排）、`fixtures/`（自动登录配置与封面）。产物落在 `.e2e/`（已 gitignore）。

---

## 8. 雷区（都已踩过，改之前先读）

### 8.1 桌面身份：`.desktop` 文件名 = 身份 + `.desktop`，且身份**别以 `.desktop` 结尾**

Electron 的权威口径：`app.setDesktopName(name)` 的 `name` 去掉结尾那层 `.desktop` 才是
**应用身份**（Wayland 的 `app_id` / X11 的 `WM_CLASS`）。GNOME / Dock 就是拿这个身份去找同名
`.desktop` 条目，并据此把窗口与已固定的启动器图标合并。

本项目身份 = `io.github.edwinhuish.songloft-desktop`，四处取值：

| 位置 | 值 |
|---|---|
| `package.json` → `desktopName` | `io.github.edwinhuish.songloft-desktop` |
| `src/main/index.ts` → `app.setDesktopName()` | `io.github.edwinhuish.songloft-desktop` |
| `electron-builder.yml` → `appId` / `StartupWMClass` | `io.github.edwinhuish.songloft-desktop` |
| 安装后的 `.desktop` 文件名 | `io.github.edwinhuish.songloft-desktop.desktop` |

⚠️ **身份刻意不以 `.desktop` 结尾。** electron-builder 的算术是固定的
（`getDesktopFileName()` 削掉一层 `.desktop`、`FpmTarget` 拼装时再补一层）。若身份**自己也以
`.desktop` 结尾**（本仓库历史取值 `com.songloft.desktop` 正好踩中），「文件名 → 身份」会多削
一层，只能靠「多写一层后缀」抵消 —— 而 `com.songloft.desktop` 与
`com.songloft.desktop.desktop` **视觉上"都以 `.desktop` 结尾"**、`StartupWMClass` 也都对、
构建更不报错。改用反域名形态后这类歧义不复存在，**别再改回去**。

**症状是静默的，而且不只是外观**：GNOME 50 起 `xdg-desktop-portal` 会拿这个身份换门户授权，
对不上时 `globalShortcut` 被直接拒绝（`org.freedesktop.portal.Error.NotAllowed`）
**且错误不冒到应用层**（Electron #52218）—— 本项目的媒体键兜底正走这条路。

**改上面四处中的任何一处，必须同时改其余几处，并重跑 `pnpm run verify:package`。**

### 8.2 `ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化成纯 Node

部分 agent / CI 的 shell 会导出它，症状是主进程一启动就崩（或 `electron.app === undefined`）。
跑脚本或调试时：`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS`。

### 8.3 AppImage 的 AppArmor profile 要单独带

deb 那份由 electron-builder 内建生成并自动安装；**AppImage 没有安装步骤**，必须靠
`extraResources` 带上，否则 Ubuntu 24.04+ 上双击没反应（终端里却能跑）。

### 8.4 `build/` 不进包

`buildResources` 不参与打包。运行期要读的文件（如托盘图）必须写进 `extraResources`。

### 8.5 图标渲染会静默丢渐变

ImageMagick 渲 SVG 可能整体渲成黑白**且退出码为 0**。`scripts/make-icons.sh` 因此改成
用 Chrome 渲染，并在渲染后用**色相直方图**断言至少 3 个色相族（另有灰度图反向验证，确保断言本身有效）。

### 8.6 歌词「四路合并」的静默丢行

后端可能同时给 `lyric` / `tlyric` / `rlyric` / `lxlyric`。**主歌词（`lyric`）定义行集**，
逐字歌词（`lxlyric`）只**挂靠**到对应行上。历史缺陷是 `base = wordSource ?? main` ——
一旦有逐字歌词就整份换掉主歌词，于是逐字源没覆盖的行被**整行丢弃**，
表现为「歌词莫名其妙少几句」且无任何报错。回归用例在 `src/shared/lyric.test.ts`。

### 8.7 时间戳对齐要用容差最近邻，不要分桶

上游/后端对同一句的时间戳可能有 ±ms 级写法差异。按固定宽度分桶（`Math.round(t * 50)`）
会让 `12.000` 与 `12.010` 落进相邻两桶而漏配。现在用单调游标 + 容差内最近邻
（`ALIGN_TOLERANCE = 0.04`）。

### 8.8 CSP 只在打包态注入

开发态要连 HMR 的 websocket 与 react-refresh 的内联脚本，套上 CSP 会直接打断热更新。

### 8.9 `sandbox: true` 决定了 preload 必须是 CJS

沙箱环境不支持 ESM preload，`electron.vite.config.ts` 里因此把 preload 的产物固定成 `.cjs`。

### 8.10 写校验脚本时的三类「假结果」

`scripts/verify-package.sh` 的注释里记了三条（都对它自己踩过）：

1. **别用 `X="$(函数)"` 从「会打印报告的函数」里取值** —— 报告函数既 `echo` ✓/✗ 又要回传值，
   命令替换会把**整份报告**当成返回值，断言于是永远失败。多返回值走全局变量。
2. **`set -o pipefail` + `grep -q` 会 SIGPIPE 假阴性** —— `tar -tzf x | grep -q y` 明明命中却判失败。
   先把输出落成变量，再单独 grep。
3. **路径含空格就别按空白切列** —— productName 是 `Songloft Desktop`，落地成 `/opt/Songloft Desktop/…`，
   `awk '{print $1}'` 会截断。

---

## 9. 不要做

* 不要只改 `.desktop` 相关的三处之一（见 8.1）。
* 不要给渲染层开 Node 能力，也不要为了省事把 `contextIsolation` / `sandbox` 关掉。
* 不要在渲染层把 token 拼进请求头去取封面/音频 —— 那两处只能走查询参数。
* 不要把 `build/` 当运行期资源目录。
* 不要在 `shared/` 里引入副作用或 electron 依赖。
* 不要为了让 `format:check` 通过而给文件加 `prettier-ignore` —— 直接跑 `pnpm run format`。
* 不要提交 `out/` / `release/` / `.e2e/` 与根目录的 `electron.vite.config.*.mjs`
  （后者是 electron-vite 的转译副本，正常会被自动删除，异常残留时已在 `.gitignore` 里）。

---

## 10. 与上游的能力差异

已对齐：曲库浏览（类型 / 分面 / 排序 / 无限滚动）、歌单增删改与拖拽重排、收藏、最近播放、
文件夹浏览、逐字歌词与点击跳转、播放队列、命令面板、扫描与重复检测、设置项。

未实现（换栈后需重做）：`jsplugin` 插件系统（上游约 6,100 行）、均衡器、无缝播放 / 淡入淡出、
DLNA 投送、桌面歌词。详见 README 的「与上游 Flutter 版的差异」一节。
