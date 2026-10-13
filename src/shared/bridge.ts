/**
 * preload 暴露给渲染层的白名单接口。
 *
 * 渲染层能做的**全部**跨边界动作就在这里，一个不多。类型放 shared 是为了让
 * preload 的实现和渲染层的调用共用同一份签名 —— 两边各写一份必然漂移。
 */

import type {
  AppInfo,
  AppSettings,
  ClientUpdateCheck,
  FileOpenResult,
  FileSaveResult,
  LocalCacheStats,
  MediaCommand,
  ServerEntry,
  ServerProbeResult,
  TraySnapshot,
  WindowState
} from './ipc'
import type { StoredCredentials } from './bridge-types'

export type { StoredCredentials }

export interface CoverBytes {
  base64: string
  mime: string
}

export interface SongloftBridge {
  settings: {
    get(): Promise<AppSettings>
    patch(patch: Partial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
  }
  credentials: {
    get(url: string): Promise<StoredCredentials | null>
    set(url: string, creds: Omit<StoredCredentials, 'savedAt'>): Promise<void>
    clear(url: string): Promise<void>
  }
  servers: {
    list(): Promise<ServerEntry[]>
    upsert(entry: ServerEntry): Promise<ServerEntry[]>
    remove(url: string): Promise<ServerEntry[]>
    probe(url: string): Promise<ServerProbeResult>
    /** 服务器 URL → 该服务器上登录过的账号名（没登录过的没有这一项） */
    accounts(): Promise<Record<string, string>>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    getState(): Promise<WindowState>
  }
  tray: {
    update(snapshot: TraySnapshot): Promise<void>
  }
  shell: {
    openExternal(url: string): Promise<void>
  }
  files: {
    /** 弹保存框把文本写盘；用户取消时 saved 为 false */
    save(suggestedName: string, contents: string): Promise<FileSaveResult>
    /** 弹打开框读文本；取消返回 null */
    open(): Promise<FileOpenResult | null>
  }
  cache: {
    /** 本机磁盘缓存（Chromium 的 HTTP 缓存）的占用与**生效中**的上限 */
    stats(): Promise<LocalCacheStats>
    /** 清掉本机缓存并返回清理后的占用 */
    clear(): Promise<LocalCacheStats>
  }
  app: {
    info(): Promise<AppInfo>
    /**
     * 查 GitHub 上有没有新的客户端版本（只查不装）。
     *
     * 传「GitHub 加速代理」前缀；老后端没有这项设置时传空串即可。主进程代查是因为渲染层
     * 直连第三方会撞上 CORS 与 `User-Agent` 这两个改不动的限制（见 src/main/release.ts）。
     */
    checkClientUpdate(proxyPrefix?: string): Promise<ClientUpdateCheck>
  }
  cover: {
    /** 取封面缩略图字节（base64），供 canvas 取主色 —— 绕开跨域画布污染 */
    bytes(url: string): Promise<CoverBytes | null>
  }
  /** 订阅主进程推送，返回取消订阅函数 */
  on: {
    mediaCommand(handler: (command: MediaCommand) => void): () => void
    windowState(handler: (state: WindowState) => void): () => void
    navigate(handler: (path: string) => void): () => void
  }
}
