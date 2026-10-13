# Songloft Desktop

> 本仓库：<https://github.com/edwinhuish/songloft-desktop>

[Songloft](https://github.com/songloft-org/songloft-player) 的 **Electron 桌面客户端**。

Songloft 是「客户端 + 自建 Go 后端」的结构：后端管曲库、标签与转码，客户端只做展示与播放。
本仓库重写的是**客户端**，只面向 Windows / macOS / Linux 桌面，不含移动端与 Web 端，
也**不含后端**（后端见 [songloft-org/songloft](https://github.com/songloft-org/songloft)）。

> **为什么换成 Electron**：完整的选型论证（性能、体积、跨平台一致性、开发效率、生态与维护
> 成本，以及 vs Tauri / Wails / Qt / Avalonia / Compose Multiplatform / 全原生 等 10 条技术
> 路线的横向对比）见 [`docs/electron-migration-evaluation.md`](docs/electron-migration-evaluation.md)。

---

## 功能

### 曲库与检索

- 服务端分页 + 无限滚动；按类型（本地 / 电台）与歌手、专辑、流派、语种、风格分面筛选，7 种排序
- 关键词搜索；`Ctrl+K` 命令面板（命令 / 歌曲 / 歌单混合检索）
- 多选与批量操作（播放、入队、加入歌单、收藏、移除、删除），支持「全选当前筛选结果」
- 文件夹浏览：曲库页里切到「文件夹」标签，按目录树逐层进入（面包屑可逐级跳回）

### 歌单与收藏

- 歌单创建 / 编辑 / 删除、封面、置顶、可见性；`position` 排序下可拖拽重排
- 把歌曲行直接拖到侧栏歌单即可加入
- 收藏与最近播放（本机记录，最多 200 条）

### 播放

- 播放 / 暂停 / 上一首 / 下一首；顺序、列表循环、单曲循环、随机四种模式
- 播放队列：任意来源入队、拖拽重排、双击跳转、清空；**跨重启恢复**（且不会自动出声）
- 原唱 / 伴奏音轨切换（后端提供多音轨时）
- 音量与静音、音质上限、后端响度归一化
- **系统媒体控件**：通过 Media Session 交给 Chromium 自动映射到 Linux 的 MPRIS、Windows 的
  SMTC、macOS 的 Now Playing，不需要为每个平台写原生桥；键盘媒体键另有兜底

### 歌词

- 四路歌词合并（主歌词 / 翻译 / 罗马音 / 逐字），逐字高亮，点击任意一行直接跳转过去
- 翻译与罗马音可单独开关，字号可调

### 曲库维护

- 扫描（带进度与取消）、重新导入、音乐根目录与排除目录
- 清理失效歌曲、重复歌曲检测（音频指纹）

### 外观与桌面集成

- 亮色 / 暗色 / 跟随系统；强调色可**跟随封面取主色**做整页联动；界面密度、玻璃质感可调
- 无边框窗口 + 自绘标题栏（双击最大化）、窗口尺寸记忆、单实例运行
- 托盘菜单（当前曲目、播放控制、显示 / 隐藏窗口、退出），可选「关闭到托盘」
- 多服务器管理与自签证书开关；登录令牌可查看与吊销

---

## 安装与运行

需要自建一个 Songloft 后端（默认 `http://localhost:58091`，默认管理员 `admin` / `admin`）。
首次启动在登录页填写后端地址；自签证书可在设置里单独放开。后端没起来时应用不会崩，
会停在带可操作提示的登录页。

Linux x64 提供三种形态：

| 形态 | 适用 |
|---|---|
| `.deb` | Debian / Ubuntu |
| `AppImage` | 免安装，双击即用 |
| `.tar.gz` | 解压即用，适合自行放置 |

### 任务栏图标（Linux / GNOME）

GNOME（Wayland）画任务栏图标只认**宿主上**的 `.desktop` 条目：窗口自己声明的图标传不出去
（`xdg_toplevel` 协议里没有图标字段），GNOME 拿窗口上报的 app_id 去找同名条目，再用条目里的
`Icon=`（详见 [AGENTS.md](AGENTS.md) §8.11）。

* `.deb`：装好即生效。
* `AppImage` / `.tar.gz` / 开发态：都不往系统里装任何东西，所以**直接双击运行时任务栏里是一个
  占位齿轮** —— 这是 GNOME 的已知限制，不是产物坏了。要显示成应用图标，二选一：
  * 用 AppImageLauncher / Gear Lever 之类的集成工具接管这个 AppImage（产物里已经带了合规的
    条目与 hicolor 图标）；
  * 或者在本仓库里跑一次 `pnpm run desktop:install`（`bash scripts/desktop-integration.sh
    install /path/to/Songloft.Desktop-x.AppImage` 可指向某个 AppImage；卸载用
    `pnpm run desktop:uninstall`）。它只写 `~/.local/share` 下两份文件，并把路径打出来。

**目前没有自动更新**，升级需要手动替换。自行构建的方式见 [`docs/development.md`](docs/development.md)。

---

## 平台支持现状

代码是按三平台（Windows / macOS / Linux）写的，但**当前只交付 Linux x64**：打包配置里只有
Linux 目标，Windows / macOS 的安装包、代码签名与公证尚未落地，也尚未在这两个平台上做过验证
—— 例如 macOS 上无边框窗口的窗口控制仍在右上角，与系统惯例不符。

---

## 与上游 Flutter 版的差异

### 已对齐

曲库浏览（类型 / 分面 / 排序 / 无限滚动）、歌单增删改与拖拽重排、收藏、最近播放、文件夹浏览、
逐字歌词与点击跳转、播放队列、命令面板、扫描与重复检测、设置项、亮暗主题、多服务器与令牌管理、
JS 插件（扩展）的安装 / 启停 / 卸载 / 排序 / 本地包上传 / 批量更新 / 残留数据清理，
以及插件商店的订阅源管理与按源筛选。

**插件系统的形态差异**：插件装在服务端、页面由服务端提供，客户端只做「入口 + 装载」。
上游把插件挂在底部导航栏的 Tab 上；本端没有底部导航栏，改成**标题栏左上角一个「扩展」入口**
（图标 + 文字 + 一颗下拉三角，三角里从上到下是「插件商店 / 插件管理」、一条分割线、以及所有
已开启的扩展 —— 扩展项点一下直接进去，管理动作都在「插件管理」那一栏），点主操作把标题栏
以下整块换成扩展主框架：左侧栏固定「插件商店 / 插件管理」两条入口、
中间列出已安装的扩展、右下角一颗收起按钮（浮在列表上，不占一行；这条侧栏在插件管理页可以
设成展开 / 折叠 / 隐藏），右侧那一栏在商店 / 管理 / 某个扩展的页面之间切换。宿主用
`<webview>` 装载插件页，因此**插件自带的界面一行都不用重写**。紧挨着它的「Songloft」也是一颗
拆分按钮：左边回到原生的那一面，右边的下拉是原来的导航菜单（首页 / 曲库 / 歌单 / 我喜欢 /
最近 / 设置）。

**两面都在 DOM 里，来回切时各自保持离开时的样子**：原生面停在哪个页面、滚到哪儿、列表加载了
多少，扩展面在商店的第几页、筛的是哪个订阅源、正在放哪个扩展 —— 切走再切回来都是原样
（正在出声的扩展也继续出声，不会因为切去曲库就被关掉）。

### 尚未实现

| 能力 | 说明 |
|---|---|
| 插件系统 | 商店里标着「有新版本」的条目只能逐个装 —— 后端的批量更新（「全部更新」）只覆盖**声明了远程更新源**的插件 |
| 均衡器 | 上游直接给 libmpv 设音频滤镜；本端可用 Web Audio 的 `BiquadFilterNode` 实现 |
| 无缝播放 / 淡入淡出 | 上游由 mpv 提供；`HTMLAudioElement` 不原生支持 gapless |
| DLNA 投送 | 上游约 989 行 |
| 桌面歌词悬浮窗 | 上游约 690 行 |
| 迷你播放器 | 上游播放器有桌面 / 移动 / 迷你三种形态 |
| Bundle 本地模式 | 上游可内嵌 Go 后端（桌面端以子进程拉起 `songloft-server`），免服务器、启动即自动登录。**本端只支持连接远程后端** |
| 歌曲元数据编辑、手动指定歌词、添加网络歌曲 | 后端端点已写进客户端，界面入口尚未做 |
| 自动更新 / 崩溃上报 | 上游设置里有「升级」入口；本端升级需手动替换安装包，也没有崩溃上报 |
| 多语言界面 | 上游有中 / 英 / 西三语（约 22,941 行本地化产物），本端界面目前只有中文 |

### 工程与实现上的差异

| 维度 | 上游 Flutter 版 | 本版本 |
|---|---|---|
| 交付平台 | 六端（含移动端与 Web） | 仅桌面三平台，当前实际交付 Linux x64 |
| 音频链路 | 横跨 8 个包 + libmpv 原生库 + 每平台一套系统媒体桥 | `HTMLAudioElement` + Media Session，解码在 Chromium 内部 |
| 界面渲染 | 自带 Skia / Impeller | 自带 Chromium，三平台同一渲染引擎 |
| 安装体积 | deb 声明安装体积 100 MB | 实测安装后 284 MB、deb 95.4 MiB、AppImage 111.8 MiB —— 约 2.8 倍；内存仍是明显劣势 |
| 插件宿主 | Dart 宿主跑 JS 插件（服务端 QuickJS 沙箱），需要跨语言桥 | 插件页面直接以 `webview` 装进窗口，宿主与插件页之间没有语言边界；沙箱仍在服务端 |

体积与内存的实测口径见 [`docs/electron-migration-evaluation.md`](docs/electron-migration-evaluation.md) 第 3.1 节。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/development.md`](docs/development.md) | 开发指南：环境要求、命令、目录结构、架构、安全模型、打包要点、测试 |
| [`AGENTS.md`](AGENTS.md) | 面向 AI 编码代理的项目说明（架构地图、约定、雷区） |
| [`docs/electron-migration-evaluation.md`](docs/electron-migration-evaluation.md) | 换栈评估报告：10 条技术路线的横向对比与结论 |
| [`NOTICE`](NOTICE) | 随产物分发的第三方组件署名与编解码器许可说明 |
| [`docs/e2e-walkthrough.png`](docs/e2e-walkthrough.png) | 端到端巡检覆盖的 22 个界面状态汇总图 |

---

## 许可

Apache-2.0，正文见 [`LICENSE`](LICENSE)。上游
[songloft-player](https://github.com/songloft-org/songloft-player) 亦为 Apache-2.0。
随产物分发的第三方组件、以及 Chromium 内置编解码器需要自行确认的许可事项，见 [`NOTICE`](NOTICE)。
