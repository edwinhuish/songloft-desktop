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
pnpm run pack:win         # 打 NSIS 安装包（要在 Windows 上跑；Linux/macOS 上跑不动）
pnpm run pack:mac         # 打 dmg / zip（要在 macOS 上跑）
pnpm run verify:package   # 校验打包产物的桌面集成项（只覆盖 Linux 产物）
pnpm run icons            # 由 build/icon.svg 生成全套图标 + 托盘图
pnpm run desktop:install  # 把本应用注册到当前用户桌面目录（GNOME 任务栏图标要它，见 §8.11）
pnpm run desktop:uninstall

pnpm run release          # ★ 发版：升版本 + 提交 + 打 v* 标签 + 推送，之后由 CI 三平台发布
```

| 想改的东西 | 至少跑这些 |
|---|---|
| `src/shared/` 的纯函数 | `pnpm run check` |
| 渲染层组件 / 页面 | `pnpm run check` + `pnpm run e2e` |
| 主进程、preload、IPC | `pnpm run check` + `pnpm run e2e` |
| `package.json` / `electron-builder.yml` / `build/` | 上面全部 + `pnpm run pack:linux` + `pnpm run verify:package` |
| `.github/workflows/` | 上面全部；`release.yml` 只能在真实 runner 上验证（见下） |

### 3.1 发版

`pnpm run release`（[bumpp](https://github.com/antfu-collective/bumpp)，配置见 `bump.config.ts`）
一步做四件事：**升 `package.json` 版本 → 提交 → 打 `v<版本>` 标签 → 推送**。
推送标签即触发 `.github/workflows/release.yml`：

| job | 做什么 |
|---|---|
| `preflight` | 先校验「标签 ↔ `package.json` 版本」一致（不一致就失败，不进入构建），再跑一遍 `pnpm run check` |
| `build` | **三平台并行**构建：`pack:linux` / `pack:win` / `pack:mac`，各自 `--publish never`，只把产物放进 `release/` 再作为 artifact 上传 |
| `release` | 三份都成功后汇总：`get-tags.sh` 查出前一个版本标签 → `generate-changelog.sh` 从提交历史按 `feat` / `fix` / … 分类生成发布说明 → 断言 deb / AppImage / tar.gz / exe / dmg 一样不缺 → 创建 Release 并上传（含 `SHA256SUMS.txt`）→ 最后再断言发布说明与资产都在 |

为什么要「先全部构建成功、再统一上传」：任何一个平台失败时都不该留下半份已发布的 Release
（已发布的 Release 收不回，用户可能已经下载）。

⚠️ **Windows / macOS 的构建只有 CI 能真正验证**，本地 Linux 只能跑通 `pack:linux` 那一条。
所以改了 `electron-builder.yml` 的 `win` / `mac` / `nsis` 段之后，别只跑 `pnpm run check`
就算完事 —— 要么推一个 tag，要么在 Actions 里手动触发 release 工作流（`workflow_dispatch`）。

⚠️ macOS 产物目前**未签名**（CI 里没有证书，`CSC_IDENTITY_AUTO_DISCOVERY=false`）。
用户首次打开会被 Gatekeeper 拦下；要正式分发得补签名与公证，见 `electron-builder.yml` 的 `mac` 段。


---

## 4. 目录职责

```
src/
├─ main/          Electron 主进程（Node 环境，唯一持有系统权限的地方）
│  ├─ index.ts        生命周期、窗口创建、安全策略与 CSP、setDesktopName、userData 覆盖
│  ├─ windows.ts      BrowserWindow 构造（contextIsolation / sandbox / nodeIntegration）
│  ├─ app-icon.ts     窗口图标定位（只对 X11 / Windows / macOS 生效；Wayland 见 §8.11）
│  ├─ media-keys.ts   媒体键（globalShortcut 兜底；优先走 Media Session 自动映射）
│  ├─ store.ts        本地持久化：设置 / 凭据 / 服务器列表（JSON，落在 userData）
│  ├─ cache.ts        本机磁盘缓存（Chromium 会话缓存）的占用 / 清理 / 启动上限
│  ├─ files.ts        导出 / 导入的文本文件对话框（读入限 32MB）
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
│  ├─ plugin.ts       JS 插件模型 / 排序纯函数 / 扩展页 URL 拼接 / PLUGIN_PARTITION
│  └─ links.ts        对外 URL 常量（本仓库 / 上游）
└─ renderer/       React 19 + zustand
   ├─ api/           client.ts（fetch 封装）/ endpoints.ts（端点清单，来自上游 Flutter 实现）/
   │                 plugins.ts（JS 插件：列表 / 启停 / 卸载 / 顺序 / 商店）
   ├─ state/         useAuth / usePlayer / usePlaylists / useSettings / useUi / useToasts /
   │                 usePlugins（已装扩展 + 顺序 + 运行时音频状态，唯一事实源）
   ├─ pages/         10 个页面：Home / Library / Playlists / PlaylistDetail / Favorites /
   │                 Recent / Search / Settings / Login / Extensions（+ 同目录的 PluginStore）
   │                 （「文件夹」不是独立页面，是 LibraryPage 里的一个标签，见 FoldersView）
   ├─ components/    Sidebar / TitleBar / SongTable / PlayerBar / LyricsView / CommandPalette /
   │                 Panel / ContextMenu / Modal / Toasts / SelectionBar /
   │                 ExtensionStrip（标题栏入口条）/ PluginSurface（扩展 webview 栈）/ PluginIcon
   ├─ hooks/         useSongList / usePlaylistSongs / useAsync / useExtensionStrip（入口条视窗）
   ├─ lib/           url（资源 URL 拼接）/ color / accent / format / concurrency
   └─ styles/        tokens.css / base.css / components.css / index.css
```

★ **标题栏以下是「一个可替换的内容面」**：原生页（侧栏 + 主区 + 播放条）或者某个扩展的
`webview`，由 `.shell[data-surface]` 切换（见 `App.tsx` 的 Shell 与 §8.12）。扩展**不是**
主内容区里的一个页签 —— 它的路由落在 `useUi` 的 `Route` 里，但不在 `renderRoute` 的 switch 里。

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

### 8.11 任务栏图标：Wayland 下只能靠**宿主上**的 `.desktop`，窗口 icon 传不出去

GNOME / Wayland 画任务栏（Dock / Alt-Tab）图标**不看窗口**：`xdg_toplevel` 协议里没有图标字段，
合成器至今也没提供 `xdg-toplevel-icon-v1`（本机 `WAYLAND_DEBUG=1` 抓到的全局列表里就没有它），
所以 `BrowserWindow({ icon })`（落到 X11 的 `_NET_WM_ICON`）只在 X11 / Windows / macOS 生效。
GNOME 认图标只有一条链，**任何一环断掉都只是画一个占位齿轮，没有任何报错**：

```
窗口上报的 app_id（= app.setDesktopName() 的入参 = package.json 的 desktopName）
  → 宿主上 $XDG_DATA_DIRS/applications/<app_id>.desktop（以及 ~/.local/share 那份）
  → 条目里的 Icon=（图标名）交给图标主题解析
```

关键是「宿主上」：gnome-shell 进程的 `XDG_DATA_DIRS` 是登录时就定下的（flatpak 导出目录 +
`/usr/local/share` + `/usr/share` + snapd），**不含任何 AppImage 挂载点**，而挂载点
（`/tmp/.mount_*`）在应用退出后还会消失。所以「双击即用」的 AppImage / tar.gz / 开发态在
GNOME 上必然只剩齿轮 —— 这是 GNOME 的已知限制（KDE 宽容是因为 KWin 会回退到窗口自己报的
图标，GNOME 不会）。`.deb` 例外：electron-builder 会装系统级条目 + hicolor 图标。

于是本仓库的策略是「**产物自身合规 + 显式集成**」，刻意**不在运行时偷偷往 `$HOME` 写文件**：

* `linux.icon` 指 `build/icons`（**目录**，16…512）而不是单张母版。electron-builder 会把目录里
  每个文件按它自声明的尺寸投进 `usr/share/icons/hicolor/<size>/apps/`；给单张 1024×1024 时
  产物里只会出现 `hicolor/1024x1024/` 这一个目录，而 hicolor 的 `index.theme` **没有声明**
  1024x1024 —— 「`Icon=` → 图标文件」这一步就会静默查不到（桌面集成工具照搬这套目录结构，
  一样查不到；1.0.0 的 AppImage 正是这个毛病）。`scripts/verify-package.sh` 的
  `check_icon_link` 同时断言「`Icon=` 有同名文件」和「落在被声明过的尺寸目录里」。
* 想让**开发态**或某个 AppImage 真的显示图标，跑显式命令 `pnpm run desktop:install`
  （`install [启动目标]` / `uninstall`，见 `scripts/desktop-integration.sh`）。它只写
  `$XDG_DATA_HOME/{applications,icons/hicolor/512x512/apps}` 两份文件、把路径打出来，
  不碰 `/usr`、不要 sudo，也不覆盖用户手工维护的条目（认 `X-Songloft-Managed=true` 标记）。

⚠️ 别把 `BrowserWindow` 的 `icon` 当成任务栏图标的解决方案（见 §9）：它解决的是另外三个平台；
Wayland 下缺的永远是宿主上那份 `.desktop`。

### 8.12 扩展（JS 插件）：装在后端，宿主只是遥控器

插件本体（manifest + `static/` + QuickJS 沙箱里的 JS）全在**服务端**，客户端不存任何插件
二进制。本地只存两样轻量配置：**谁出现在标题栏**（启用与否）与**谁在前**（`plugin-order`，
键是 `entryPath` 而不是 id）。排序纯函数在 `shared/plugin.ts` 的 `applyPluginOrder` ——
四条语义（孤儿条目跳过、重复取首个、未列入的按原顺序落尾、不改入参）来自上游
`plugin_order.dart`，回归用例在 `shared/plugin.test.ts`。

**承载用 `<webview>` 而不是 `<iframe>`**：`<iframe>` 是跨源的，宿主没有任何 API 能单独
静音它、也不知道它在不在出声（`webContents.setAudioMuted` 是整窗口级的，会连播放器一起
静音）。而「右键 → 静音」与「扩展图标上的播放中蒙版」正是要这两件事。给得太少会静默
失效，所以要记住四条配套约束：

1. **独立 session**（`shared/plugin.ts` 的 `PLUGIN_PARTITION`）。`applyCsp()` 是
   `defaultSession.webRequest.onHeadersReceived`，改写的是**整个会话**的响应头 ——
   插件页也在同一个来源上，不隔离就会被套上宿主的 CSP，症状是插件莫名其妙地坏掉、
   **且没有任何报错**。代价是权限拒绝与证书校验要给那份 session 单独配一遍（见
   `main/index.ts` 的 `hardenPluginSession`）。
2. **webviewTag 必须配套加固**：`will-attach-webview` 里把 guest 的 `preload` 删掉、
   `nodeIntegration` 关掉、沙箱与上下文隔离打开。开着 `webviewTag` 而不管它，等于把
   「要不要 Node」交给页面自己声明。
3. **「活着的 = 当前显示的那个 ∪ 正在播放的那些」**（见 `PluginSurface`）。视觉上永远只有
   一个槽位，实现上是一层栈：切走就销毁。不这样，「某个扩展在后台出声」根本无从存在，
   播放蒙版也就没意义了。
4. **webview 必须显式给 display 与尺寸**，否则默认 `inline` 把高度塌成 0，表现为「加载了
   却看不见」。

**标题栏入口条是「图标 + 名称」的一排，标签按内容取宽（不做统一宽度），靠左对齐**；
可见区**只能是除去左边 LOGO、右边那组按钮之后剩下的那一块，不许由内容撑开**（`flex: 1 1 0`
—— basis 取 0，内容的 max-content 就不进弹性基准了；取 `auto` 会先撑进基准再被 shrink 挤回，
过程中两侧各被挤掉几像素）。露不满的从右边裁掉。三个容易做错的地方：

* **溢出个数必须量真实几何**（`ExtensionStrip` 里数 `offsetLeft` / `offsetWidth`），不能按
  「每个按钮固定多少像素」反推 —— 宽度随名称长短浮动，那个常量必然算错。条上是
  **全渲染 + `overflow: hidden` 裁**的，所以数目一旦偏大，就会把裁掉的当成露着的（菜单里
  少列几个，用户再也点不到）。
* **只数「完全露出来」的**，所以「只露了一半」与「完全没露」一样进折叠菜单。对它们来说
  菜单是**唯一**的入口，所以判定还留了 1px 余量往严的那边靠（`CLIP_EPSILON`）。
* 「把被隐藏的扩展移进可视范围」只能靠**改变它在条上的位置**（裁切在右边，没有视窗可滚），
  所以 `useUi.extensionFront` 把刚被激活的那一个提到最前。它刻意**不写设置**：标题栏是
  工具栏，用户在管理页拖出来的顺序是配置 —— 写回去等于「点一次扩展就把自己排的顺序改了」。

`.titlebar-brand` 与 `.titlebar-actions` 都 `flex: none`，外加 `.titlebar { overflow: hidden }`
兜底：扩展条再长也不许把 LOGO 与窗口控制按钮挤动或顶出去。

入口条与菜单必须走同一个 `useExtensionStrip`：两边各算一套必然出现「菜单里列着一个其实
就在条上的扩展」。

---

## 9. 不要做

* 不要只改 `.desktop` 相关的三处之一（见 8.1）。
* 不要把「窗口 icon」当成任务栏图标的解决方案：Wayland 下它传不出去，缺的永远是宿主上
  那份 `.desktop`（见 8.11）。
* 不要让应用在启动时自行往 `~/.local/share` 之类的用户目录写桌面条目 / 图标：桌面集成走
  `pnpm run desktop:install`（显式命令，§8.11）。
* 不要给渲染层开 Node 能力，也不要为了省事把 `contextIsolation` / `sandbox` 关掉。
* 不要在渲染层把 token 拼进请求头去取封面/音频 —— 那两处只能走查询参数。
* 不要在 DOM 元素上写 `title=` 当提示：那是浏览器自带的黑框，配色不跟主题、出现时机也不受控。
  一律写 `data-tip="…"`，由 `components/Tooltip.tsx` 的全局浮层统一显示（图标按钮仍要留
  `aria-label`，浮层是 `aria-hidden` 的，不承担可访问名）。浮层默认摆在上方，按
  上→下→左→右 的顺序找第一个装得下的方位；只有折叠侧栏例外（`data-tip-place="right"`），
  因为那里条目竖排，往右才不遮邻居。
* 不要把 `build/` 当运行期资源目录。
* 不要在 `shared/` 里引入副作用或 electron 依赖。
* 不要为了让 `format:check` 通过而给文件加 `prettier-ignore` —— 直接跑 `pnpm run format`。
* 不要提交 `out/` / `release/` / `.e2e/` 与根目录的 `electron.vite.config.*.mjs`
  （后者是 electron-vite 的转译副本，正常会被自动删除，异常残留时已在 `.gitignore` 里）。
* 不要把扩展页装进 `<iframe>`：跨源 iframe 既静音不了、也探不到在不在出声（§8.12）。
* 不要把扩展页的 webview 放进 `defaultSession`：宿主注入的 CSP 会把插件页一起改写（§8.12）。
* 不要让入口条与折叠菜单各算一套「哪些扩展被挤出去了」：两处必须走 `useExtensionStrip`（§8.12）。

---

## 10. 与上游的能力差异

已对齐：曲库浏览（类型 / 分面 / 排序 / 无限滚动）、歌单增删改与拖拽重排、收藏、最近播放、
文件夹浏览、逐字歌词与点击跳转、播放队列、命令面板、扫描与重复检测、设置项。

**JS 插件（扩展）**：已实现「列表 / 启用停用 / 卸载 / 上传 zip / 从商店安装 / 调整顺序」
与「标题栏入口条 + 折叠菜单溢出列表 + 扩展管理页」。与上游的形态差异是**入口位置**：
上游把插件挂在底部导航栏的 Tab 上，本仓库没有底部导航栏，改成标题栏右侧的图标条
（布局与坑见 §8.12）。未做的部分：插件的商店「全部更新」、清理孤儿数据、以及各个源
的单独管理界面。插件的**页面本身**仍由服务端提供（渲染在 webview 里），所以上游那些
插件自带的 UI 一行都不用重写。

未实现（换栈后需重做）：均衡器、无缝播放 / 淡入淡出、DLNA 投送、桌面歌词、
「缓存到本机」（把单曲下载到设备本地离线播放 —— 设置页里那份「本地缓存」是**另一回事**，
它清的是 Chromium 会话缓存）。详见 README 的「与上游 Flutter 版的差异」一节。
