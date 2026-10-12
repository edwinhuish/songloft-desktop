/**
 * 主进程入口。
 *
 * 职责边界（结构性的，不靠代码自觉）：
 *   * 只有主进程能碰文件系统与系统调用；
 *   * 渲染层没有任何 Node 能力，它要的一切都经 preload 白名单（见 src/preload）；
 *   * 承载界面的窗口 contextIsolation + sandbox 全开。
 */

import { BrowserWindow, app, ipcMain, session, shell } from 'electron'

import { IPC, type AppInfo, type AppSettings, type MediaCommand, type ServerEntry, type TraySnapshot } from '@shared/ipc'
import { installAppMenu } from './app-menu'
import { registerMediaKeys } from './media-keys'
import { fetchCoverBytes, probeServer } from './probe'
import { ConfigStore } from './store'
import { createTray, destroyTray, render as renderTray } from './tray'
import { createMainWindow } from './windows'

/**
 * ★ GNOME / Wayland 是按窗口 app_id 去找**同名 .desktop** 的。
 *   这个值必须同时等于 package.json 的 desktopName、electron-builder.yml 的
 *   linux.desktop.entry.StartupWMClass，以及产物 .desktop 的文件名词干 —— 四处同源，
 *   否则 Dock 上会显示成一个通用占位图标，且和已固定的启动器图标不合并。
 *   scripts/verify-package.sh 会做这个断言。
 */
app.setDesktopName('com.songloft.desktop.desktop')

// 只允许一个实例：第二次启动就把已有窗口顶到前面，而不是再开一个播放器。
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

const store = new ConfigStore()
let mainWindow: BrowserWindow | null = null
let isQuitting = false
let disposeMediaKeys: (() => void) | null = null

/** 自签证书开关：只作用于本应用的默认会话，不动系统设置。 */
function applyTlsPolicy(allowInsecure: boolean): void {
  const ses = session.defaultSession
  ses.setCertificateVerifyProc((_request, callback) => {
    // 0 = 接受；-3 = 交回 Chromium 默认校验
    callback(allowInsecure ? 0 : -3)
  })
}

/**
 * ★ CSP 只在打包态注入。开发态要连 electron-vite 的 HMR websocket 与内联的
 *   react-refresh preamble，套上 CSP 会直接把热更新打断 —— 开发体验与安全性在
 *   这里是有取舍的，选择「打包态严格」。
 *
 * 打包后渲染层需要的东西其实只有三样：自己的 bundle（file://）、后端地址
 * （http/https，地址由用户在设置里填）、以及封面取色的 blob:/data:。
 */
function applyCsp(): void {
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            // 样式里大量用了行内 style（尺寸/进度条 width），必须放开 inline style
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: http: https:",
            "media-src 'self' blob: http: https:",
            "connect-src 'self' http: https: ws: wss:",
            "font-src 'self' data:",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'self'",
            "form-action 'none'"
          ].join('; ')
        ]
      }
    })
  })
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function broadcastMediaCommand(command: MediaCommand): void {
  sendToRenderer(IPC.onMediaCommand, command)
}

function toggleWindowVisibility(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

// ────────────────────────────────── IPC ──────────────────────────────────
function registerIpcHandlers(): void {
  // 设置
  ipcMain.handle(IPC.settingsGet, () => store.getSettings())
  ipcMain.handle(IPC.settingsPatch, (_event, patch: Partial<AppSettings>) => {
    const next = store.patchSettings(patch)
    if (Object.prototype.hasOwnProperty.call(patch, 'allowInsecureTls')) {
      applyTlsPolicy(next.allowInsecureTls)
    }
    return next
  })
  ipcMain.handle(IPC.settingsReset, () => {
    const next = store.resetSettings()
    applyTlsPolicy(next.allowInsecureTls)
    return next
  })

  // 凭据
  ipcMain.handle(IPC.credentialsGet, (_event, url: string) => store.getCredentials(url))
  ipcMain.handle(
    IPC.credentialsSet,
    (_event, url: string, creds: { accessToken: string; refreshToken: string; expiresIn: number }) => {
      store.setCredentials(url, creds)
    }
  )
  ipcMain.handle(IPC.credentialsClear, (_event, url: string) => {
    store.clearCredentials(url)
  })

  // 服务器
  ipcMain.handle(IPC.serversList, () => store.listServers())
  ipcMain.handle(IPC.serversUpsert, (_event, entry: ServerEntry) => store.upsertServer(entry))
  ipcMain.handle(IPC.serversRemove, (_event, url: string) => store.removeServer(url))
  ipcMain.handle(IPC.serversProbe, (_event, url: string) => probeServer(url))

  // 窗口
  ipcMain.handle(IPC.windowMinimize, () => mainWindow?.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, () => mainWindow?.close())
  ipcMain.handle(IPC.windowGetState, () => ({
    maximized: mainWindow?.isMaximized() ?? false,
    fullscreen: mainWindow?.isFullScreen() ?? false,
    focused: mainWindow?.isFocused() ?? false
  }))

  // 托盘 / 系统
  ipcMain.handle(IPC.trayUpdate, (_event, snapshot: TraySnapshot) => {
    renderTray(trayDeps, snapshot)
  })
  ipcMain.handle(IPC.openExternal, (_event, url: string) => {
    // 只放行 http(s)，别让渲染层用 file:// 或自定义协议拉起本机程序
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })
  ipcMain.handle(IPC.colorExtract, (_event, url: string) => fetchCoverBytes(url))
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    appImage: Boolean(process.env.APPIMAGE),
    packaged: app.isPackaged
  }))
}

// ───────────────────────────── 托盘依赖（提前声明）─────────────────────────────
const trayDeps = {
  onCommand: (command: MediaCommand) => broadcastMediaCommand(command),
  onToggleWindow: () => toggleWindowVisibility(),
  onQuit: () => {
    isQuitting = true
    app.quit()
  },
  isWindowVisible: () => Boolean(mainWindow?.isVisible())
}

// ─────────────────────────────── 生命周期 ───────────────────────────────
if (gotTheLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    applyTlsPolicy(store.getSettings().allowInsecureTls)
    applyCsp()
    registerIpcHandlers()
    installAppMenu(() => mainWindow)

    mainWindow = createMainWindow(store)
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    // 关闭即最小化到托盘（默认关）：拦下 close，改成 hide
    mainWindow.on('close', (event) => {
      if (isQuitting) return
      if (!store.getSettings().closeToTray) return
      event.preventDefault()
      mainWindow?.hide()
    })

    createTray(trayDeps)
    disposeMediaKeys = registerMediaKeys(broadcastMediaCommand)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(store)
      } else {
        mainWindow?.show()
      }
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    disposeMediaKeys?.()
    disposeMediaKeys = null
    destroyTray()
  })

  app.on('window-all-closed', () => {
    // Linux 上托盘常驻是常见用法，但这个应用默认「关掉窗口就退出」，
    // 只有用户显式开了 closeToTray 才留在后台（那条路径下窗口不会真的 close）。
    if (process.platform !== 'darwin') app.quit()
  })
}
