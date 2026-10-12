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

  // ── 窗口 / 托盘 / 系统集成 ─────────────────────────────────────────────
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowGetState: 'window:get-state',
  trayUpdate: 'tray:update',
  openExternal: 'shell:open-external',
  /** 主进程代取封面字节（canvas 取主色需要，绕开跨域画布污染） */
  colorExtract: 'cover:extract',
  appInfo: 'app:info',

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
  /** 侧栏是否折叠 */
  sidebarCollapsed: boolean
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
  sidebarCollapsed: false,
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
