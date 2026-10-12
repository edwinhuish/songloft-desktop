/**
 * preload：唯一的「渲染层 ↔ 系统能力」白名单桥。
 *
 * 三条硬约束（改这个文件前先读一遍）：
 *   1. 只暴露**具体方法**，绝不暴露 ipcRenderer 本身 —— 否则等于把整条 IPC 通道
 *      交给页面脚本，contextIsolation 就白开了。
 *   2. sandbox: true 下 preload 是 CJS，且只能用 electron 的 ipcRenderer / contextBridge。
 *   3. 订阅类接口必须返回「取消订阅」函数，否则 React 严格模式下的双次挂载会堆监听。
 */

import { contextBridge, ipcRenderer } from 'electron'

import { IPC } from '@shared/ipc'
import type { AppSettings, MediaCommand, ServerEntry, TraySnapshot, WindowState } from '@shared/ipc'
import type { CoverBytes, SongloftBridge, StoredCredentials } from '@shared/bridge'

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const bridge: SongloftBridge = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
    patch: (patch) => ipcRenderer.invoke(IPC.settingsPatch, patch) as Promise<AppSettings>,
    reset: () => ipcRenderer.invoke(IPC.settingsReset) as Promise<AppSettings>
  },
  credentials: {
    get: (url) => ipcRenderer.invoke(IPC.credentialsGet, url) as Promise<StoredCredentials | null>,
    set: (url, creds) => ipcRenderer.invoke(IPC.credentialsSet, url, creds) as Promise<void>,
    clear: (url) => ipcRenderer.invoke(IPC.credentialsClear, url) as Promise<void>
  },
  servers: {
    list: () => ipcRenderer.invoke(IPC.serversList) as Promise<ServerEntry[]>,
    upsert: (entry) => ipcRenderer.invoke(IPC.serversUpsert, entry) as Promise<ServerEntry[]>,
    remove: (url) => ipcRenderer.invoke(IPC.serversRemove, url) as Promise<ServerEntry[]>,
    probe: (url) => ipcRenderer.invoke(IPC.serversProbe, url)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize) as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize) as Promise<boolean>,
    close: () => ipcRenderer.invoke(IPC.windowClose) as Promise<void>,
    getState: () => ipcRenderer.invoke(IPC.windowGetState) as Promise<WindowState>
  },
  tray: {
    update: (snapshot: TraySnapshot) =>
      ipcRenderer.invoke(IPC.trayUpdate, snapshot) as Promise<void>
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url) as Promise<void>
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  cover: {
    bytes: (url) => ipcRenderer.invoke(IPC.colorExtract, url) as Promise<CoverBytes | null>
  },
  on: {
    mediaCommand: (handler) => subscribe<MediaCommand>(IPC.onMediaCommand, handler),
    windowState: (handler) => subscribe<WindowState>(IPC.onWindowState, handler),
    navigate: (handler) => subscribe<string>(IPC.onNavigate, handler)
  }
}

contextBridge.exposeInMainWorld('songloft', bridge)
