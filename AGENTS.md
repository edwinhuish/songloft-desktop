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
* 本仓库地址：<https://github.com/songloft-org/songloft-desktop>

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
pnpm run shots            # 把巡检截图整理成文档用图（docs/screenshots + docs/e2e-walkthrough.png）
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
│  ├─ data.ts         两份数据快照是否等价（页面切回时的**静默刷新**靠它判断「要不要动界面」）
│  ├─ version.ts      版本号比较（认不出来的写法一律判「不比它新」，宁可少提示一次更新）
│  └─ links.ts        对外 URL 常量（本仓库 / 上游）
└─ renderer/       React 19 + zustand
   ├─ api/           client.ts（fetch 封装）/ endpoints.ts（端点清单，来自上游 Flutter 实现）/
   │                 plugins.ts（JS 插件：列表 / 启停 / 卸载 / 顺序 / 商店）
   ├─ state/         useAuth / usePlayer / usePlaylists / useSettings / useUi / useToasts /
   │                 usePlugins（已装扩展 + 顺序 + 运行时音频状态，唯一事实源）/
   │                 useLibrary（曲库数据的版本号 + 后台任务守望，见 §5.7）
   ├─ pages/         10 个页面：Home / Library / Playlists / PlaylistDetail / Favorites /
   │                 Recent / Search / Settings / Login / Extensions（+ 同目录的 PluginStore）
   │                 （「文件夹」不是独立页面，是 LibraryPage 里的一个标签，见 FoldersView）
   ├─ components/    Sidebar / TitleBar / SongTable / PlayerBar / LyricsView / CommandPalette /
   │                 Panel / ContextMenu / Modal / Toasts / SelectionBar /
   │                 FullPlayer（满窗播放：盖在原生面上的浮层）/
   │                 MiniPlayer（迷你窗那一条，跑在**另一个窗口**里，见 §4）/
   │                 （同目录的 ../MiniApp.tsx 是那个窗口的根，与 App.tsx 并列）
   │                 ExtensionFrame（扩展主框架：左侧栏 + 右内容面）/
   │                 PluginSurface（扩展 webview 栈）/ PluginIcon /
   │                 RegistrySourcesDialog（管理订阅源）
   ├─ hooks/         useSongList / usePlaylistSongs / useAsync / useResponsiveSidebar /
   │                 usePageActive（页面槽的「我看得见吗」，见 §4 的页面槽那段）/
   │                 useHorizontalScroll（溢出时才出的横向滚动条）
   ├─ lib/           url（资源 URL 拼接）/ color / accent / format / concurrency /
   │                 responsive（断点判定，纯函数）/
   │                 plugin-actions（插件的停用 / 卸载 —— 确认与提示只有这一份，
   │                 将来再加入口别另写；lib/ 里唯一一个不是纯函数的）
   └─ styles/        tokens.css / base.css / components.css / index.css
```

★ **标题栏以下是「一个可替换的内容面」**，两种形态由 `useUi.surface` 切换
（见 `App.tsx` 的 Shell）：

| surface | 内容 | 谁在这儿 |
|---|---|---|
| `native` | 侧栏 + 工具条 + 主区 + 抽屉 + 播放条 | `NativeRoute`：home / library / playlists / settings… |
| `extensions` | 扩展主框架：左扩展侧栏 + 右内容面 | `ExtensionRoute`：`{name:'extensions',pane}`（商店/管理）与 `{name:'plugin',entryPath}`（某个扩展），见 §8.12 |

**两面都挂在 DOM 里，只把不走的那一面藏起来**（`.surface[data-hidden]`）。两条容易做错：

* **藏法必须是 `visibility: hidden`，不是 `display: none`**：后者让那一面失去布局，滚动
  位置与 guest 的渲染都不再有保证。而「切过去再切回来还是离开时的样子」要保的正是这些：
  原生面的滚动与已加载的列表、扩展面在商店的第几页、正在出声的那个扩展。
* **两面各有各的路由**（`nativeRoute` / `extensionRoute`），不是共用一份 —— 共用必然二选一，
  切过去就把另一份覆盖掉，「记住状态」从根上做不到。标题栏那两个入口的主点击走的是
  `showSurface`（只换面、不动任何路由），**不是** `navigate`；`navigate` 按目标的类型决定
  写哪一份，并把面切过去。

扩展那两条路由**不在 `renderRoute` 的 switch 里**（它的入参是 `NativeRoute`）—— 别顺手加
回去，加回去会被渲染到侧栏里那一小块去。它们刻意是两条路由而不是一条带 `view` 字段的：
侧栏高亮与 `pane` 语义本来就不一样。

**原生面内部同样是「挂着，只藏不走」**：`nativeRoute` 的每条对应一个页面槽
（`App.tsx` 的 `NativePages` / `PageSlot`，`.page-slot[data-hidden]`；首次访问才挂、之后不卸）。
于是切页只换「显示哪一槽」，页面里的筛选条件 / 排序方式 / 视图模式 / 滚动位置都还是离开时的
样子（`.main-scroll` 因此不再自己滚动 —— 滚动交给每个槽，共用一个滚动容器会把上一页的
`scrollTop` 带过去）。两条容易做错：

* **页面组件不许自己读「当前路由」**（`useUi(s => s.nativeRoute)`）：常驻之后，不活跃的那份
  实例读到的已经属于别人了，会当场变脸。参数一律由页面槽经 props 传进去（`LibraryPage`
  为此收 `route`）。
* **`library` 与 `folders` 是两个槽**，不是一个：共用一个槽的话，切标签会把「曲库」那一半的
  筛选条件一并卸掉。

代价是数据的新鲜度不再由「重新挂载」自动保证，改由那三个数据 hook 自己盯（见 §5.8）。

⚠️ **E2E 的选择器要限定在 `.surface-native` 里**：两面都在 DOM 里，而扩展面里也有一个用
同一套 class 的侧栏。`scripts/e2e/drive.mjs` 的 `offCenter()` 已经这么写了 —— 不限定的话
它会拿原生面那个侧栏的中心去量扩展面的图标，得到一个恒定的几十 px（断言"红了"，其实
什么都没测到）。

⚠️ **同一个理由，页面槽常驻之后 `drive.mjs` 的选择器一律走 `vis()`**（助手区那个包装）：
它把范围收回「不在 `[data-hidden]` 子树里」的那一份。直接用 `document.querySelectorAll`
会把藏在别的页里的 `.song-row` / `.card` / `.chip` 一起数进来 —— 计数翻倍，而断言看着还
"挺像那么回事"。

扩展面里**没有播放条**（宿主播放不会因此中断：音频是模块级对象、不挂在 DOM 上，见
`state/usePlayer` 的 `audio`），此时控制播放只能靠媒体键 / 托盘 / MPRIS。

**看播放器还有另外两个姿势**，都不属于 `surface`，也别往路由里塞（路由是"去哪一页"，
它们只是换个姿势看同一个播放器 —— 混进历史会让 Alt+← 退回到"收起满窗播放"这种中间态）：

* **满窗播放**（`useUi.fullPlayer`，`components/FullPlayer.tsx`）：底栏那颗封面点一下，
  标题栏以下整块换成大封面 + 歌曲信息 + 歌词 + 控制条，收起钮 / Esc 出去。
  它是**原生面里的一个浮层**（`z-index: 35` —— 压在播放条之上、标题栏之下，标题栏是无边框
  窗口唯一常驻的拖拽区与关闭入口，不能被它吃掉），但上边界要**伸到标题栏底下**
  （`top: -titlebar-h`，内容靠 `padding-top` 让开），标题栏再由 `.shell[data-fullplayer]`
  换成透明底 —— 满窗播放时这两块要的是**同一张**底色，各画一份「看着差不多」的糊封面
  在接缝处一定对不上。切去扩展面时它跟着一起被藏，切回来原样还在；
  底下的页面一直挂着没被卸载，收起后仍是离开时那一页。
* **迷你播放器**（底栏那颗按钮，`components/MiniPlayer.tsx` + `MiniApp.tsx`）：它是**另一个
  BrowserWindow**（`main/mini-window.ts`），主窗口一点都不动 —— 这也是它没有走 `surface`
  也没有走满窗播放那套「藏起来」的原因：它压根不在这个窗口里。
  两边靠主进程中转：主窗口推**播放状态快照**过去（轻的一半跟进度走、重的一半带队列与歌词
  和封面的 token），迷你窗把动作变成**遥控命令**发回来（`state/mini-host.ts` ↔
  `state/remotePlayer.ts`）。播放的唯一事实源永远在主窗口（`state/localPlayer.ts`），
  `state/usePlayer.ts` 因此是一个**分流器**：主窗口拿到真播放器、迷你窗拿到镜像 ——
  于是 `Queue` / `LyricsView` 这些组件两边共用同一份实现。

新加播放相关的界面时照着这条走：读同一个 `usePlayer`、复用 `PlayerProgress`（"拖动期间只动
本地 scrub、松手才 seek"只有那一份）与 `LyricsView`，别复制一份状态出去。

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
7. **曲库数据的各处副本靠一个「版本号」收敛**（`state/useLibrary`）：歌单与收藏在
   `usePlaylists` 里，曲库 / 搜索 / 歌单详情 / 文件夹 / 首页的列表则在各自 hook 的本地 state 里。
   而「扫描曲库」（含强制扫描）与「刷新元数据」是**服务端的后台任务**，客户端没有推送通道 ——
   任务一结束就把 `useLibrary.revision` +1：页面级的列表在 hook **内部**订阅它
   （`useAsync` / `useSongList` / `usePlaylistSongs`，所以调用方不必各自记得挂），
   store 级的副本由 `invalidate()` 重载。守望（`watchTasks()`）进应用查一次、在跑就轮询到停，
   **不依赖设置页是否挂在界面上**（刷新元数据动辄几分钟，用户多半已经走了）。
8. **切换页面时自动刷新，但只在数据真的变了才动界面**：页面槽是常驻的（见 §4 那段），
   所以「切回来」不再有重新挂载这一次机会，重取数据的责任落到那三个数据 hook 上 ——
   它们从 `usePageActive()` 读「我这一槽是不是看得见的那一页」，切回来时静默重取一次，
   再用 `shared/data.ts` 的 `sameData` 与手头这份比：**一样就一个字都不改**（不显示加载态、
   不重设列表、不动滚动位置），不一样才更新（退回第一页 —— 与手动点「刷新」同一条路径）。
   不活跃的页面连请求都不发；手动刷新、筛选条件变化、`revision` 变化照旧走「明着加载」。

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
`run.sh`（编排）、`shots.sh`（把截图整理成文档用图）、`fixtures/`（自动登录配置与封面）。
产物落在 `.e2e/`（已 gitignore）。

一次巡检 **74 步**，覆盖：首页 / 曲库（类型与分面筛选、文件夹逐级进入）/ 歌单 / 最近 / 收藏 /
搜索（含空态）/ 多选与右键菜单 / 设置九个分区 / 扩展面（商店、订阅源、插件管理、扩展页 webview）/
播放（面板与满窗的歌词、队列、迷你窗）/ 命令面板 / 退出登录与登录。每步一张截图。

⚠️ **迷你播放器在另一个窗口里**（独立 BrowserWindow，见 §4），所以那几步要切到**它的 CDP
target** 上跑 —— STEPS 里用第 5 项 `'mini'` 标出来（`drive.mjs` 的 `sessionFor`）。不标就会在
主窗口里找 `.mini-bar`，断言表现成 `NOT_FOUND`。

`pnpm run shots` 从这些截图生成**文档引用**的两份东西，`README.md` 与 `docs/development.md`
引的就是它们（都是生成物，改界面后重跑，别手工截图替换）：

| 产物 | 用途 |
|---|---|
| `docs/screenshots/*.png` | 主要界面单张图（1440 宽折到 1080），嵌进 README |
| `docs/e2e-walkthrough.png` | 全部 74 个状态的覆盖图，一格一步带步骤名 —— 用于一屏扫出「哪一格是空的」 |

截图一律是**浅色主题**：`fixtures/config.json` 里把 `theme` 写成了 `light`（`system` 在无桌面
偏好的 Xvfb 里本来也解析成浅色，写死只是为了避免随环境漂）。断言与主题无关，想换深色改这一项。

⚠️ 在 `drive.mjs` 里加断言时注意**口径的形状**：`settingText` / `modalText` 取的是**整段字符串**，
而 `containsAll` 早先只处理数组 —— 于是 8 条断言**恒假**，红的原因却像「界面上了错的内容」。
断言不是代码，写错了不会编译报错；每种口径都在这两个文件里写清了它是什么形状。

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
二进制。本地只存两样轻量配置：**谁出现在扩展侧栏里**（启用与否）与**谁在前**（`plugin-order`，
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

**扩展是一个「去处」，不是一排页签**：标题栏上只有左上角那一个「扩展」入口（拼图图标 +
文字，右侧还带一颗下拉三角），点主操作把标题栏以下整块换成扩展主框架（`showSurface`：
只换面，所以**上次停在哪一页就还是哪一页**，见 §4 那张表）—— 左是扩展侧栏，右是内容面
（插件商店 / 插件管理 / 某个扩展的 `webview`），三者在右侧那一栏里换，框架本身不动。
那颗下拉三角是「不必先进框架再点一次」的那条近路，内容是**两条固定入口（插件商店 /
插件管理）→ 分割线 → 当前已开启的扩展**：扩展项**没有二级菜单**，点一下直接进去。
它刻意只做**跳转**，管理动作一律留在「插件管理」那一栏（那儿有整行位置摆开关和按钮），
「静音」也仍在扩展侧栏的右键菜单里。

侧栏段落固定：**顶部两条固定入口**（插件商店 / 插件管理）、**中间一列已安装扩展**（可滚动）、
**右下角那颗「收起 / 展开」**。三条容易做错的地方：

* **侧栏复用主导航那一套 class**（`.sidebar` / `.nav-item` / `.sidebar-playlists` /
  `.sidebar-toggle`）：折叠时的图标居中、文字淡出、左侧强调条、滚动区让位都是现成的，另写一套
  必然与那边慢慢漂开 —— 两个侧栏宽度相同、折叠动效相同，本来就是一回事。列宽也共用
  `--sidebar-current` / `--sidebar-w` 那套令牌（`.ext-frame` 与 `.shell-body` 是同一套算术）。
* **收起/展开那颗按钮是贴在右下角右边缘上的一条窄条**（`.sidebar-toggle`：绝对定位、
  `right: 0`、13×26、**无底色**、颜色走 `--accent`）。它原来是一条占满整宽、带文字的底行，
  两条侧栏各吃掉 39px 高，而那里只剩这一个动作。两条随之而来的约束：**列表容器要留 34px
  底部空档**（无底色就压不住文字，只能让最后一行整个让开，否则歌单条数会与图标叠在一起）；
  **hover 不能靠底色**（.icon-btn 那条 hover 底色要在这儿压掉），改成与 `--text-1` 混一档
  提高对比度 —— 暗色主题下变亮、浅色主题下变暗，两边都是「更清楚」。
  没有可见文字 → 提示与 `aria-label` 任何时候都要挂。
* **中间那一列只列 `isDisplayable` 的**（启用且有 `entryPath`）：停用与「运行异常」的没有可
  打开的页面，列出来也点不动。它们在插件管理页里照样看得到、处理得了。
* **侧栏形态是设置项**（`settings.extensionSidebarState`：`expanded` / `collapsed` / `hidden`，
  与主侧栏那份分开存 —— 两者宽度、用途都不同），不进 `useUi`：这个框架没有「窗口太窄就自动
  收起」那一套。★ **一个设置既是「默认」也是「当前」**：右下角那颗按钮只在前两档之间切，
  三档的显式选择器在插件管理页顶部 —— 别再加一份「默认值」与「临时值」，那两份迟早对不上。
  `hidden` 时 `<nav>` **整个不渲染**（不是宽度给 0：那样 border-right 会留一道没用的竖线），
  于是那颗收起按钮也随它一起没了 —— 插件管理页那个选择器是唯一能改回来的地方
  （所以界面上把这句话写了出来）。

★ **`PluginSurface` 在框架里常驻**（哪怕当前显示的是插件商店，只是 `display: none` 藏起来）。
它是「活着的 = 当前显示的那个 ∪ 正在播放的那些」的实现，框架把它整块卸掉等于：用户点一下
「插件管理」，正在放的歌就断了。所以它必须容忍 `entryPath` 为空 = 不显示、只保活
（`display: none` 不会停掉 guest 的播放 —— 音频不挂在布局上）。

**标题栏上是两颗「拆分按钮」**（`.titlebar-split`：左半执行主操作、右半那颗小三角开下拉，
两块共用一颗胶囊，悬停/聚焦/菜单开着时整颗亮起、分隔线才出现）：Songloft（回播放页 /
导航菜单）与扩展（进扩展主框架 / 插件商店 + 插件管理 + 已开启的扩展）。所以**标题栏里不再
有独立的「折叠菜单」按钮**，原来那一份导航项一分为二，各自贴在自己的入口上。容易做错的：

* **两个 `aria-expanded` 要各自判断** `anchor === 自己的 ref`：只看 `open` 的话，打开一颗
  会让两颗都报「已展开」（`anchor` 的语义见 `ContextMenu.tsx`）。
* **菜单开着时，标题栏的拖拽区与扩展页的 webview 要暂时让开**（`html[data-menu='open']`
  那两条规则）：这两处的「点一下」都冒不到宿主的 window（前者被浏览器拿去拖窗口，后者
  在独立进程里），不让开就会「点标题栏 / 点扩展页都关不掉菜单」。标记由 `ContextMenuHost`
  打在 `documentElement` 上 —— 别改成让 Shell 渲染一个属性，那会让每次开关菜单都整页
  重渲染一次。
* **扩展下拉里只放跳转，不塞管理动作**（它和扩展侧栏是「怎么进去」，管理在「插件管理」
  那一栏）。真要再加一处「停用 / 卸载」入口，走 `lib/plugin-actions` 而不是另写一份 ——
  卸载确认里那句「数据会一并删除」漏一次就是真的丢数据。

`.titlebar-brand` 是 `flex: 0 1 auto`（名字先被省略号吃掉，不许把窗口按钮顶出去），
`.titlebar-actions` 是 `flex: none` + `margin-left: auto`（右端永远贴右缘），外加
`.titlebar { overflow: hidden }` 兜底：标题栏里任何一项都不许把布局撑出去。

**两种插件图标的 URL 规则完全不同，别互相套用**：

| 用在哪 | `icon` 字段的形态 | 拼法 |
|---|---|---|
| 已装插件（侧栏 / 下拉 / 管理页） | `static/` 下的**裸文件名** | `/api/v1/jsplugin/{entryPath}/static/{icon}`（该路由**无需认证**，别拼 token） |
| 商店条目（`PluginStore` 的 `StoreIcon`） | **`/api/v1/proxy?url=<encoded>`**（服务端替我们从源站取回来，顺手套了 GitHub 代理） | 走 `lib/url.ts` 的 `buildResourceUrl`：拼 `baseUrl` + `access_token` |

商店那条**不是** http(s) 开头的，`/api/v1/proxy` 也需要 token（见 middleware/auth.go 的
query 回退分支）—— 按「像不像外链」判断会让整店退成首字母兜底图。上游 Flutter 端在同一处
栽过（他们用 `endsWith('.svg')` 判断，而 `/api/v1/proxy` 结尾没有 `.svg`）。

**订阅源**（`api/plugins.ts` 的 `getPluginRegistries` / `updatePluginRegistries`）：后端只有
「整表读 / 整表写」两个口子（`GET|PUT /settings/plugin-registries`），没有单条增删改，也不是
`/jsplugins/*` 那一家 —— 界面上那个对话框因此是一张**草稿表**，点保存才整份 PUT 回去。
两条语义别弄错：**URL 就是身份**（后端按 URL 匹配条目来源、按 URL 查它自己的 token），所以
改地址等于换一个源、重复地址必须在客户端先拦住；**单源筛选**（`all_sources: false` +
`registry_url`）时后端**不会**去读它存的那份配置，私有源的 token 必须由调用方一起带上 ——
漏了只会得到一句「拉取注册表失败」，完全看不出是缺 token。

### 8.13 整窗透明度 = 透明窗口 + 整棵树 opacity，缺一半都只是「变暗」

设置里「窗口透明度」那两张滑块（`AppSettings.windowOpacity` / `miniWindowOpacity`：主窗与迷你
窗各自的整窗浓度）要真的透出桌面，必须**两件事同时成立**：

| 一半 | 在哪 | 少了它会怎样 |
|---|---|---|
| 窗口是**透明窗口** | `main/windows.ts` 的 `transparent: true`（恒开） | 界面再淡也只是与窗口那块底色混在一起，看着像「变暗」，桌面透不进来 |
| 整棵界面树带 opacity | `styles/base.css` 里 `body { opacity: var(--window-opacity) }` | 窗口虽有 alpha 通道，可每一层画上去的都是实心的，全被遮住 |

配套的三条：`html` / `body` **不许铺底色**（主窗口里底色一律由 `.shell` 画，迷你窗里由
`.mini-bar` / `.mini-panel` 画）；这条 opacity 挂在 `body` 而不是 `#root` 上 —— `Modal` 是
portal 到 `body` 的（见 `components/Modal.tsx`），挂在 `#root` 里的话对话框不跟着透，一开一关
是两个浓度；迷你那一份（`--mini-window-opacity`）由 `html[data-mini='true'] body` 顶掉 ——
两个窗口各是一棵独立的界面树，但**共用同一份样式表与同一套变量名**，不靠 <html> 上那个标记
（`main.tsx` 在第一帧之前就打上）就分不开。

★ 它和 `glassIntensity` / `lyricPanelOpacity` / `miniPanelOpacity` **不是一类**：那几项调的是
「某个面**自己那层底色**」有多厚，而窗口始终是实心的 —— 怎么调都只透出同一窗口里它下面的一层，
桌面永远进不来。播放条 / 迷你条自己的底色浓度因此写死在 `tokens.css` 的 `--bar-tint-opacity`
（57%），不再是设置项：让「整窗」与「底色」两层都能拧，只会让人说不清是哪一层在变。
`miniPanelOpacity` 是这里面唯一一个**相对值**（100% = 与播放条一致，见 `tokens.css` 那段）：
深浅两个主题下「跟着条走」对应的绝对值不一样，而用户手里只有一根滑块。

⚠ 透明窗口是**创建时**属性，运行中改不了 —— 所以它恒开、不跟设置开关（否则拧一次滑块就得
重启应用）。代价是窗口一直带 alpha 通道；两个浓度默认都是 100，观感与改动前一致。
⚠ Linux 下要有合成器（GNOME / KDE 默认都有，裸 WM 下退化成实心，不崩）。另外 Chromium 的
`backdrop-filter` **只模糊同一窗口里它下面的内容**，别指望透明窗口能「毛玻璃看穿到桌面」
（那是 macOS vibrancy / Windows backgroundMaterial 那种系统级能力）。扩展页是 `<webview>`，
guest 自己的背景不透明，那块也永远透不出来。

### 8.14 玻璃的 `--glass` 是无单位数字，两条 `calc` 得自己补单位

`settings.glassIntensity`（0–100）由 `state/useSettings.ts` 写到 `<html>` 的 `--glass` 上，
`tokens.css` 拿它算两样东西：模糊半径（`calc(8px + var(--glass) * 0.28px)`）与那层底色
（color-mix 里的 `* 0.7%`）。这两处**必须自己给单位** —— `--glass` 本身是裸数字，
写成 `8px + 62 * 0.28` 是「长度 + 数字」、`100% - 62 * 0.7` 是「百分比 - 数字」，两条都非法。

自定义属性**不校验**，非法值要到「使用处」才退化：`--glass-blur` / `--glass-tint` 双双失效，
`backdrop-filter` 与 `background` 各自退回初始值 —— 玻璃面整层变透明、模糊消失，
**控制台一声不响**。（历史形态：tokens.css 声明 `62%`、useSettings 写裸数字 `62`，两边互相打架。）

所以：`--glass` 只放裸数字，单位在样式表使用处补。改完跑 `pnpm run e2e` ——
`titlebarGlass` 那两条断言（满窗播放时标题栏换透明底、Esc 收起后回到玻璃底）就是为这件事设的。

---

## 9. 不要做

* 不要只改 `.desktop` 相关的三处之一（见 8.1）。
* 不要把「窗口 icon」当成任务栏图标的解决方案：Wayland 下它传不出去，缺的永远是宿主上
  那份 `.desktop`（见 8.11）。
* 不要让应用在启动时自行往 `~/.local/share` 之类的用户目录写桌面条目 / 图标：桌面集成走
  `pnpm run desktop:install`（显式命令，§8.11）。
* 不要给渲染层开 Node 能力，也不要为了省事把 `contextIsolation` / `sandbox` 关掉。
* 不要让 `html` / `body` 铺底色，也别以为「给界面加一层 opacity」就够 —— 整窗透明度要
  透明窗口与整棵树 opacity 一起成立（§8.13）。
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
* 不要在切到插件商店 / 插件管理时卸载 `PluginSurface`：那会把正在出声的扩展一起关掉，
  也就是「点一下插件管理，音乐就断了」（§8.12）。
* 不要在标题栏的扩展下拉里塞管理动作（停用 / 卸载）：那一份菜单只做跳转，管理在「插件管理」
  那一栏；真要再加入口就复用 `lib/plugin-actions`（§8.12）。

---

## 10. 与上游的能力差异

已对齐：曲库浏览（类型 / 分面 / 排序 / 无限滚动）、歌单增删改与拖拽重排、收藏、最近播放、
文件夹浏览、逐字歌词与点击跳转、播放队列、命令面板、扫描与重复检测、设置项。

**JS 插件（扩展）**：已实现「列表 / 启用停用 / 卸载 / 上传 zip / 从商店安装 / 调整顺序 /
批量更新 / 单插件更新（检查 + 下载）/ 常驻运行 / 清理残留数据」与「扩展主框架（插件商店 +
插件管理 + 扩展侧栏）」，商店那一栏还能管理订阅源（增删启停 + 私有源 token）并按源筛选。

插件管理页每一行尾部是「⋯」菜单（与上游 Flutter 端的行内 PopupMenuButton 对齐）：
**常驻运行**（`GET|PUT /settings/plugin-keep-alive` 的白名单，形态是 `{plugins:[entryPath…]}` ——
整表覆盖写，所以切换时**必须现读现改**，拿旧列表覆盖会抹掉别处刚加的项；白名单里的插件
跳过空闲卸载，见 jsplugin/health.go 的 checkIdle）、**更新**（先 `GET /{id}/check-update`
再 `POST /{id}/update`，后端装完会顺手重载）、一条分割线、**删除**（`DELETE /{id}`）。与上游的形态差异是**入口位置**：上游把插件
挂在底部导航栏的 Tab 上，本仓库没有底部导航栏，改成标题栏左上角一个入口，点下去把标题栏以下
整块换成扩展主框架（布局与坑见 §8.12）。仍缺一件：商店里标着「有新版本」的条目只能逐个装 ——
「全部更新」调的是后端的批量更新，它只覆盖**声明了远程更新源**（manifest 的 `updateUrl`）的
插件，其余的按 skipped 计。插件的**页面本身**仍由服务端提供（渲染在 webview 里），所以上游那些
插件自带的 UI 一行都不用重写。

未实现（换栈后需重做）：均衡器、无缝播放 / 淡入淡出、DLNA 投送、桌面歌词、
「缓存到本机」（把单曲下载到设备本地离线播放 —— 设置页里那份「本地缓存」是**另一回事**，
它清的是 Chromium 会话缓存）。详见 README 的「与上游 Flutter 版的差异」一节。
