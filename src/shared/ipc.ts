/**
 * 主进程 ↔ 渲染层的 IPC 契约。
 *
 * 渲染层**不能**直接 import electron（ESLint 会拦）。所有跨边界能力都经 preload
 * 白名单暴露成 `window.songloft`，渠道名只能从这里取 —— 避免两边各写一份字符串。
 */

import type { PlayMode } from './types'

export const IPC = {
  // ── 配置持久化（主进程持有 JSON 文件，渲染层只透过 IPC 读写）────────────────
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  settingsReset: 'settings:reset',

  // ── 凭据：token 落主进程，渲染层启动时拉一次 ──────────────────────────────
  credentialsGet: 'credentials:get',
  credentialsSet: 'credentials:set',
  credentialsClear: 'credentials:clear',

  // ── 服务器列表 ─────────────────────────────────────────────────────────
  serversList: 'servers:list',
  serversUpsert: 'servers:upsert',
  serversRemove: 'servers:remove',
  serversProbe: 'servers:probe',
  /** 各已保存服务器上登录过的账号名（只回非敏感的那一半，不含 token） */
  serversAccounts: 'servers:accounts',

  // ── 窗口 / 托盘 / 系统集成 ─────────────────────────────────────────────
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowGetState: 'window:get-state',
  trayUpdate: 'tray:update',
  openExternal: 'shell:open-external',
  /** 弹保存框把文本写盘（导出歌单备份；渲染层没有文件系统权限） */
  fileSave: 'file:save',
  /** 弹打开框读文本（导入歌单备份）；取消返回 null */
  fileOpen: 'file:open',
  /** 本机磁盘缓存（Chromium 的 HTTP 缓存）占用。服务端缓存那套走 HTTP 接口，这个是本机自己的 */
  localCacheStats: 'cache:stats',
  /** 清掉本机磁盘缓存，返回清理后的占用 */
  localCacheClear: 'cache:clear',
  /** 主进程代取封面字节（canvas 取主色需要，绕开跨域画布污染） */
  colorExtract: 'cover:extract',
  appInfo: 'app:info',
  /** 主进程代查 GitHub 上的最新 release（渲染层不直连第三方，也省掉 CORS 与 UA 的坑） */
  clientUpdateCheck: 'app:check-client-update',

  // ── 主进程 → 渲染层（单向推送）────────────────────────────────────────
  onMediaCommand: 'media:command',
  onWindowState: 'window:state',
  onNavigate: 'app:navigate'
} as const

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
  focused: boolean
}

export type MediaCommand =
  | { kind: 'play-pause' }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'seek'; delta: number }
  | { kind: 'volume'; delta: number }
  | { kind: 'toggle-mute' }
  | { kind: 'toggle-favorite' }
  | { kind: 'toggle-lyrics' }

/** 托盘菜单要显示的当前播放概要 */
export interface TraySnapshot {
  title: string | null
  artist: string | null
  playing: boolean
  favorite: boolean
}

/** 写盘结果：用户取消对话框时为 saved=false */
export interface FileSaveResult {
  saved: boolean
  path: string | null
}

/** 读到的文件（只回文本内容，路径不出主进程） */
export interface FileOpenResult {
  name: string
  contents: string
}

/**
 * 本机磁盘缓存（客户端自己的那份）。
 *
 * 与 `CacheStats`（服务端音乐缓存）是两码事：那份在服务器上、所有设备共用；这份是本机
 * Chromium 会话的 HTTP 缓存，落在 userData 里，换服务器 / 换账号都清，换台机器就没有。
 */
export interface LocalCacheStats {
  /** 已占用字节 */
  size: number
  /** 生效中的上限字节（0 = 交给 Chromium 按可用磁盘空间自行决定） */
  maxSize: number
}

export interface ServerProbeResult {
  ok: boolean
  /** 探到的后端版本（`/api/v1/version`） */
  version: string | null
  /** `/api/v1/health` 是否 200 */
  healthy: boolean
  /** 失败原因，ok 为 false 时给出 */
  error: string | null
  /** 探测耗时（毫秒） */
  elapsedMs: number
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  /** 是否以 AppImage 运行（决定要不要提示手动装 AppArmor profile） */
  appImage: boolean
  /** 打包态 / 开发态 */
  packaged: boolean
}

/**
 * 「客户端更新」的检查结果。
 *
 * 只报「有没有新版本」与发布页地址，**不含**下载与安装：桌面端的二进制归安装包与包管理器管，
 * 应用自己去换自己这件事另有代价（见 settings 里那条说明），不在这一步里。
 */
export interface ClientUpdateCheck {
  /** GitHub 上最新 release 的 tag（一般是 v1.2.3） */
  latestTag: string
  /** 该 release 的页面地址 —— 「打开发布页」用的就是它 */
  latestUrl: string
  /** 发布时间（ISO 字符串；拿不到就是空串） */
  publishedAt: string
}

/** 桌面端偏好设置（纯本地，不属于后端 configs） */
export interface AppSettings {
  /** 上次使用的服务器（按 URL 定位） */
  activeServerUrl: string | null
  theme: 'system' | 'dark' | 'light'
  accent: string
  /** 主题色是否跟随封面取色 */
  accentFromCover: boolean
  /** 界面密度 */
  density: 'comfortable' | 'compact'
  /** 玻璃质感强度 0–100 */
  glassIntensity: number
  /** 歌词字号 px */
  lyricFontSize: number
  /** 歌词是否显示翻译 / 罗马音 */
  lyricShowTranslation: boolean
  lyricShowRoman: boolean
  /** 关闭窗口时最小化到托盘而不是退出 */
  closeToTray: boolean
  /** 默认音量 0–1 */
  volume: number
  playMode: PlayMode
  /** 播放时是否把音量归一化参数带给后端 */
  volumeNormalize: boolean
  /** 音质偏好：'original' | '128' | '192' | '320' */
  quality: 'original' | '128' | '192' | '320'
  /** 忽略 TLS 证书校验（自签/内网证书）。只影响 Chromium 网络栈的本机会话。 */
  allowInsecureTls: boolean
  /**
   * 本机磁盘缓存上限（字节，0 = 不限）。
   *
   * Chromium 只在启动那一刻读一次上限（`--disk-cache-size`），运行中改不了 —— 所以这个值
   * 存下来、下次启动时交给它，设置页会明说「重启后生效」。
   */
  localCacheMaxSize: number
  /**
   * 启动时自动检查更新（服务端与客户端各查一次）。
   *
   * 两次都是普通读取：客户端那次由主进程直连 GitHub，服务端那次是问后端 `/upgrade/check`。
   * 关掉就完全不因为这件事联网（两边都不查）。
   */
  autoCheckUpdate: boolean
  /** 侧栏是否折叠 */
  sidebarCollapsed: boolean
  /** 扩展主框架里那条侧边栏是否折叠（与主侧栏分开存：两者宽度与用途都不同） */
  extensionSidebarCollapsed: boolean
  /** 记住的播放队列（会话恢复） */
  lastQueue: number[]
  lastQueueIndex: number
  lastQueueContext: { type: string; key: string } | null
  /** 最近播放（本地，最多 200 条，最新在前） */
  recentSongIds: number[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeServerUrl: null,
  theme: 'system',
  accent: '#7c5cff',
  accentFromCover: true,
  density: 'comfortable',
  glassIntensity: 62,
  lyricFontSize: 30,
  lyricShowTranslation: true,
  lyricShowRoman: false,
  closeToTray: false,
  volume: 0.8,
  playMode: 'order',
  volumeNormalize: false,
  quality: 'original',
  allowInsecureTls: false,
  // 与上游客户端的默认档一致：本机缓存默认给 1 GB，再多就该自己清或调小了
  localCacheMaxSize: 1024 ** 3,
  // 默认开着：查一次很便宜，而「不知道自己落后了」的代价更大；嫌烦的人可以关掉
  autoCheckUpdate: true,
  sidebarCollapsed: false,
  extensionSidebarCollapsed: false,
  lastQueue: [],
  lastQueueIndex: -1,
  lastQueueContext: null,
  recentSongIds: []
}

export interface ServerEntry {
  url: string
  name: string
  lastUsedAt: number
}
