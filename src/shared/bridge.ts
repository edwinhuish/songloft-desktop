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
  MiniCommand,
  MiniPlayerSnapshot,
  MiniWindowLayout,
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
    /**
     * 这三颗窗口钮一律**作用于调用它自己所在的那个窗口**（主进程按 event.sender 认窗口），
     * 不是「主窗口」：迷你窗那颗最小化不该把主窗口收掉，那颗关闭也只该关掉迷你条。
     */
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    getState(): Promise<WindowState>
  }
  /**
   * 迷你窗口（独立 BrowserWindow，见 main/mini-window.ts）。
   *
   * 两边各用一半：主窗口用它开关 + 推状态，迷你窗用它报尺寸 + 收状态 + 发遥控命令。
   * 为什么全要经主进程中转：两个渲染层之间没有直接通道，而播放的唯一事实源在主窗口那边。
   */
  mini: {
    /** 主窗口：开 / 关迷你窗 */
    setOpen(open: boolean): Promise<void>
    /** 迷你窗：报一下此刻的布局（条 / 面板 / 菜单），主进程据此算窗口高度 */
    resize(layout: MiniWindowLayout): Promise<void>
    /** 迷你窗：界面与设置都就绪了 —— 主进程据此显示窗口，并请主窗口推一份状态过来 */
    ready(): Promise<void>
    /** 主窗口：推一份播放状态（主进程转给迷你窗） */
    push(snapshot: MiniPlayerSnapshot): Promise<void>
    /** 迷你窗：发一条遥控命令（主进程转给主窗口执行） */
    command(command: MiniCommand): Promise<void>
    /** 主窗口：迷你窗开没开（按钮高亮、要不要继续推送都看它） */
    onOpen(handler: (open: boolean) => void): () => void
    /** 迷你窗：收到播放状态快照 */
    onState(handler: (snapshot: MiniPlayerSnapshot) => void): () => void
    /** 主窗口：迷你窗在要状态，请立刻推一份完整快照 */
    onRequest(handler: () => void): () => void
    /** 主窗口：收到一条遥控命令 */
    onCommand(handler: (command: MiniCommand) => void): () => void
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
    /** 设置被**别的窗口**改了（两个窗口各有一份 settings，见 shared/ipc.ts 那条说明） */
    settingsChanged(handler: (settings: AppSettings) => void): () => void
  }
}
