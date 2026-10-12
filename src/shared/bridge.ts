/**
 * preload 暴露给渲染层的白名单接口。
 *
 * 渲染层能做的**全部**跨边界动作就在这里，一个不多。类型放 shared 是为了让
 * preload 的实现和渲染层的调用共用同一份签名 —— 两边各写一份必然漂移。
 */

import type { AppInfo, AppSettings, MediaCommand, ServerEntry, ServerProbeResult, TraySnapshot, WindowState } from './ipc'
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
  app: {
    info(): Promise<AppInfo>
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
