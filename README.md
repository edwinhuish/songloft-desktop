# Songloft Desktop

> 本仓库：<https://github.com/edwinhuish/songloft-desktop>

[Songloft](https://github.com/songloft-org/songloft-player)（Flutter 客户端 + Go 后端）的 **Electron 桌面客户端**。
Songloft 本身是「客户端 + 自建 Go 后端」的结构：后端管曲库与标签，客户端只做展示与播放。
本仓库是客户端的**桌面端重写版**，只考虑 Windows / macOS / Linux 桌面，不承载移动端与 Web 端。

> 换栈的完整取舍（性能、体积、跨平台一致性、开发效率、生态、维护成本，以及 Tauri / Wails /
> Flutter / Qt / Avalonia / Compose Multiplatform / 全原生 / uni-app x / Lynx 的横向对比）
> 见 [`docs/electron-migration-evaluation.md`](docs/electron-migration-evaluation.md)。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 面向 AI 编码代理的通用说明（也适合新人上手）：架构地图、命令、约定、雷区 |
| [`docs/electron-migration-evaluation.md`](docs/electron-migration-evaluation.md) | 换栈评估报告：10 条技术路线横向对比与结论 |
| [`docs/e2e-walkthrough.png`](docs/e2e-walkthrough.png) | 端到端巡检覆盖的 22 个界面状态汇总图 |

---

## 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | **>= 22.12.0** | 渲染层与主进程都用 ES2023+；E2E 巡检依赖全局 `WebSocket` |
| pnpm | 12.x | `packageManager` 已锁 `pnpm@12.4.1` |
| Songloft 后端 | 默认 `http://localhost:58091` | 本仓库**不含后端**。默认管理员 `admin` / `admin` |

后端没起来时应用不会崩，会停在「服务器连接失败」的登录页并给出可操作的提示。

---

## 快速开始

```bash
pnpm install          # 会通过 postinstall 拉取 Electron 二进制
pnpm dev              # 开发（HMR）

pnpm run check        # 类型 + lint + 格式 + 单测，提交前跑这个
pnpm run build        # 产出 out/（主进程 + preload + 渲染层）
pnpm run pack:linux   # 打 deb / AppImage / tar.gz 到 release/
pnpm run verify:package   # 校验打包产物里的桌面集成项
pnpm run e2e          # 端到端 UI 巡检（起 mock 后端 + 截图 + 断言）
```

### 脚本一览

| 脚本 | 作用 |
|---|---|
| `dev` | electron-vite 开发服务器，渲染层 HMR |
| `build` | 先 `typecheck` 再 `electron-vite build`，产物在 `out/` |
| `typecheck` | 分别检查主进程侧（`tsconfig.node.json`）与渲染层侧（`tsconfig.web.json`） |
| `test` | vitest，覆盖 `src/shared` 里的纯函数（歌词解析等） |
| `lint` / `format` | ESLint flat config / Prettier |
| `icons` | 从 `build/icon.svg` 渲染全套尺寸 + 托盘图，并断言渐变没丢（见下） |
| `pack:*` | electron-builder 打包，输出到 `release/` |
| `verify:package` | 校验 `.desktop` 文件名、`StartupWMClass`、AppArmor profile、托盘资源等 |
| `e2e` | 端到端巡检，见「测试」一节 |

---

## 架构

```
src/
├─ main/        Electron 主进程（Node 环境，唯一有系统权限的地方）
├─ preload/     contextBridge，唯一的渲染层↔主进程通道
├─ shared/      两侧共用的纯代码：类型、IPC 频道常量、歌词解析
└─ renderer/    React 19 + zustand 的界面层
```

### 安全模型

渲染层被当作**不可信**对待，所有系统能力都要经 `preload` 白名单转出：

| 措施 | 设置 | 为什么 |
|---|---|---|
| 上下文隔离 | `contextIsolation: true` | 渲染层拿不到 preload 的作用域 |
| 沙箱 | `sandbox: true` | preload 也跑在沙箱里（因此 preload 产物必须是 CJS） |
| Node 集成 | `nodeIntegration: false` | 渲染层没有 `require` / `process` |
| 渲染层禁 import | ESLint 规则拦 `electron` / `node:fs` / `node:child_process` | 防止依赖被随手引进渲染层 |
| CSP | **仅打包态**注入 | 开发态要连 HMR 的 websocket 与 react-refresh 内联脚本，套 CSP 会打断热更新 |
| 导航围栏 | 所有外部链接交给 `shell.openExternal` | 窗口本身不允许被导航到外部页面 |
| 自签证书 | 只对当前 session 放开校验 | 自建后端常用自签证书，但不能全局降低校验 |
| 封面取色 | 主进程代取字节 | 直接在渲染层 canvas 读跨域封面会污染画布 |

媒体播放走 `HTMLAudioElement` + **Media Session API**：Chromium 会把它自动映射成 Linux 的
MPRIS、Windows 的 SMTC、macOS 的 Now Playing，不需要为每个平台写一套原生桥。键盘媒体键另走
`globalShortcut` 兜底。

---

## Linux 打包要点

几个会**静默失败**（不报错，但产物在用户机器上是坏的）的点：

1. **`.desktop` 文件名 / `StartupWMClass` / `setDesktopName()` 是同一个身份的三处写法。**
   任一处对不上，GNOME 下图标会静默回落成占位齿轮。权威口径来自 Electron 文档：

   > `app.setDesktopName(name)` — `name` 是 `.desktop` 的**文件名**，必须与安装后 `.desktop`
   > 文件的文件名一致；`.desktop` 后缀可省。**这个名称去掉 `.desktop` 后缀就是应用身份**，
   > 在 Wayland 下作为 XDG 的 `app_id`、X11 下作为 `WM_CLASS`。

   本项目三处取值（身份 = `io.github.edwinhuish.songloft-desktop`）：

   | 位置 | 值 | 含义 |
   |---|---|---|
   | `package.json` → `desktopName` | `io.github.edwinhuish.songloft-desktop` | **应用身份**（反域名形态） |
   | `src/main/index.ts` → `app.setDesktopName()` | `io.github.edwinhuish.songloft-desktop` | 同上 |
   | `electron-builder.yml` → `StartupWMClass` | `io.github.edwinhuish.songloft-desktop` | 同上 |
   | 安装后的 `.desktop` 文件名 | `io.github.edwinhuish.songloft-desktop.desktop` | 身份 + `.desktop` |

   ⚠️ **为什么身份刻意不以 `.desktop` 结尾。** 文件名与身份之间是「**去掉结尾那层 `.desktop`**」的
   关系，而 electron-builder 的算术是固定的（`getDesktopFileName()` 削掉一层、`FpmTarget`
   拼装时再补一层）。若身份**自己也以 `.desktop` 结尾**（例如 `com.songloft.desktop`），
   这一步就会多削一层，只能靠「多写一层后缀」抵消：

   | `desktopName` | 落地的文件名 | 文件名去掉扩展名 = 身份 | 结论 |
   |---|---|---|---|
   | `com.songloft.desktop` | `com.songloft.desktop` | `com.songloft` | ❌ 身份被吃掉了应用段 |
   | `com.songloft.desktop.desktop` | `com.songloft.desktop.desktop` | `com.songloft.desktop` | ✅ 但配置里出现重复后缀 |

   两种写法**看起来都"以 `.desktop` 结尾"**、`StartupWMClass` 也都对、构建更不报错 ——
   所以本仓库直接改用反域名形态 `io.github.edwinhuish.songloft-desktop`，**三类取值完全一致、
   没有重复后缀**，这一整类歧义就不存在了。

   之所以不能只当"外观问题"：从 GNOME 50 起这个身份还会被拿去 `xdg-desktop-portal` 换
   `globalShortcut` 授权，身份对不上时门户直接拒绝、**错误不会冒到应用层**（Electron #52218）
   —— 本项目的媒体键兜底正好走这条路。

   `pnpm run verify:package` 会把上面这几项连同 postinst 引用的 AppArmor profile 一起断言掉。
2. **AppImage 的 AppArmor profile 要单独提供。** deb 那份由 electron-builder 内建生成并自动安装，
   AppImage 没有安装步骤，必须靠 `extraResources` 带上（`build/apparmor-profile`）。
3. **托盘图标不能指望 `build/` 进包。** `buildResources` 不参与打包，运行期要读的真实文件
   必须写进 `extraResources`（`build/icon-source.png` → `resources/tray.png`）。
4. **图标渲染会静默丢渐变。** ImageMagick 渲 SVG 时渐变可能整体变黑白且退出码为 0。
   `scripts/make-icons.sh` 因此改走 Chrome 渲染、并在渲染后用色相直方图断言至少 3 个色相族
   （还做了灰度图反向验证，确保断言本身有效）。
5. **AppImage 的 FUSE2 依赖。** Ubuntu 24.04+ 起 `libfuse2` 改名 `libfuse2t64`，
   用 `toolsets.appimage: '1.0.3'` 换成静态 runtime，彻底去掉这个依赖。

> 构建环境若导出 `ELECTRON_RUN_AS_NODE=1`（部分 agent / CI 的 shell 会这么干），Electron 会
> 退化成纯 Node，主进程一启动就崩。本地跑脚本或调试时记得 `env -u ELECTRON_RUN_AS_NODE`。

---

## 测试

### 单元测试

```bash
pnpm test
```

覆盖 `src/shared` 里的纯函数。目前最要紧的一批用例锁的是 `lyric.ts` 的一个**静默丢行**缺陷：
后端返回的四路歌词里，`lxlyric`（逐字）常常只覆盖副歌，而早先的实现是
`base = wordSource ?? main` —— 一旦有逐字歌词就整份换掉主歌词，于是主歌词里其余的行被
**整行丢弃**，界面上表现为「歌词莫名其妙少几句」，且没有任何报错。

同一批用例还覆盖了时间戳对齐：原先用「按 20ms 分桶」匹配，`12.000` 与 `12.010` 会分别落进
相邻两桶、恰好跨桶边界就漏配。现在改成单调游标 + 容差内最近邻。

### 端到端巡检

```bash
pnpm run e2e
```

`scripts/e2e/` 下是一个最小 mock 后端 + 基于 CDP 的驱动器：起一个**隔离的**虚拟显示
（不会抢你的焦点、也不会动你的真实配置），启动构建产物，用**真实 DOM 交互**逐个界面点击、
截图并**断言**。产物在 `.e2e/`（已 gitignore）。

为什么断言而不是只截图：上面那个歌词丢行缺陷就是「截图看着正常、实际少了几行」的典型。
巡检因此断言歌词面板必须出现 10 行（mock 的主歌词 10 行、逐字源只覆盖 4 行），
并断言曲库的类型筛选真的收敛了行数（43 → 41 → 0）、流派分面的**卡片文字**确实换成了流派名
（卡片数同为 5，只数个数区分不出「有没有点中 chip」）。

一次完整巡检覆盖 **22 个界面状态**，全部截图的汇总见 [`docs/e2e-walkthrough.png`](docs/e2e-walkthrough.png)。

---

## 与上游 Flutter 版的能力差异

已对齐：曲库浏览（类型 / 分面 / 排序 / 无限滚动）、歌单增删改与拖拽重排、收藏、最近播放、
文件夹浏览、逐字歌词与点击跳转、播放队列、命令面板、扫描与重复检测、设置项。

尚未实现（换栈后需要重新做，建议按此顺序排期）：

| 能力 | 备注 |
|---|---|
| `jsplugin` 插件系统 | 上游约 6,100 行。**这是换栈唯一可能产生溢出收益的地方**：上游把 JS 当扩展语言、宿主却是 Dart，换成 Electron 后宿主本身就是 JS，插件有机会在移动端与桌面端复用 |
| 均衡器 | 可用 Web Audio 的 `BiquadFilterNode` 实现 |
| 无缝播放 / 淡入淡出 | Chromium 的 `HTMLAudioElement` 不原生支持 gapless，需要预解码或 Web Audio 拼接 |
| DLNA 投送 | 生态空白，建议先 spike 再决定 |
| 桌面歌词 | 需要额外的透明置顶窗口 |

---

## 开发约定

* 提交前至少跑 `pnpm run check`（类型 + lint + 格式 + 单测）；动了界面再加 `pnpm run e2e`，
  动了打包配置再加 `pnpm run verify:package`。
* 渲染层**不得**直接 `import electron` / `node:fs` / `node:child_process`，能力一律经 `preload`
  白名单（`window.songloft`）转出 —— ESLint 会拦，理由见上面「安全模型」。
* 纯逻辑（歌词解析、URL 拼接等）放 `src/shared/`，两侧共用且可直接单测。
* 面向 AI 编码代理的完整说明（目录职责、命令、雷区、验证方式）见 [`AGENTS.md`](AGENTS.md)。

---

## 许可

Apache-2.0。上游 [songloft-player](https://github.com/songloft-org/songloft-player) 亦为 Apache-2.0。
