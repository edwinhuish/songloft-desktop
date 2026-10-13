/**
 * 主进程入口。
 *
 * 职责边界（结构性的，不靠代码自觉）：
 *   * 只有主进程能碰文件系统与系统调用；
 *   * 渲染层没有任何 Node 能力，它要的一切都经 preload 白名单（见 src/preload）；
 *   * 承载界面的窗口 contextIsolation + sandbox 全开。
 */

import { BrowserWindow, app, ipcMain, session, shell } from 'electron'

import type { StoredCredentials } from '@shared/bridge-types'
import {
  IPC,
  type AppInfo,
  type AppSettings,
  type MediaCommand,
  type MiniModeState,
  type ServerEntry,
  type TraySnapshot
} from '@shared/ipc'
import { installAppMenu } from './app-menu'
import { applyLocalCacheLimit, clearLocalCache, readLocalCache } from './cache'
import { checkClientUpdate } from './release'
import { openTextFile, saveTextFile } from './files'
import { registerMediaKeys } from './media-keys'
import { fetchCoverBytes, probeServer } from './probe'
import { PLUGIN_PARTITION } from '@shared/plugin'
import { ConfigStore } from './store'
import { createTray, destroyTray, render as renderTray } from './tray'
import { createMainWindow, setMiniMode } from './windows'

/**
 * ★ Linux 桌面集成身份（Wayland 的 app_id / X11 的 WM_CLASS）。
 *
 *   权威口径：app.setDesktopName(name) 的 name 是 **.desktop 的文件名**；而 name **去掉结尾
 *   那层 .desktop** 才是应用身份 —— GNOME / Dock 就是拿这个身份去找同名条目，并把窗口与
 *   已固定的启动器图标合并。
 *
 *   身份取反域名形态 io.github.edwinhuish.songloft-desktop，**刻意不以 `.desktop` 结尾**。
 *   若身份本身以 `.desktop` 结尾（例如 com.songloft.desktop），"去掉一层后缀"就会把它削成
 *   另一个名字，必须靠多写一层后缀来抵消，极易看错且错法完全静默 —— 详见 electron-builder.yml。
 *
 *   于是三处取值是（身份不以 `.desktop` 结尾，所以不必"多写一层后缀"）：
 *     package.json → desktopName             = 身份
 *     本行入参（setDesktopName）              = 身份
 *     electron-builder.yml → StartupWMClass   = 身份
 *     产物 .desktop 文件名                     = 身份 + ".desktop"
 *
 *   对不上的症状是静默的：图标回落成占位齿轮；GNOME 50 起 xdg-desktop-portal 还会拒绝用该
 *   身份申请的 globalShortcut 授权，而错误不会冒到应用层。
 *   scripts/verify-package.sh 会断言这一组关系。
 */
app.setDesktopName('io.github.edwinhuish.songloft-desktop')

/**
 * 允许把配置目录挪走。两个用途：
 *   1. 自动化冒烟测试给一份预置凭据的配置，不去碰用户真实的 ~/.config/songloft-desktop；
 *   2. 用户想同时挂两套服务器配置时，可以自己指定。
 * 必须在任何 app.getPath('userData') 被读取之前调用，所以放在 ConfigStore 实例化之前。
 */
const userDataOverride = process.env.SONGLOFT_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)

// 只允许一个实例：第二次启动就把已有窗口顶到前面，而不是再开一个播放器。
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

const store = new ConfigStore()

// 本机缓存上限得赶在 ready 之前交给 Chromium（它只在解析启动参数时读一次，运行中改不了），
// 所以放在这里、而不是等界面来要。设置页会照这个事实提示「重启后生效」。
applyLocalCacheLimit(store.getSettings().localCacheMaxSize)

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

/**
 * ★ 扩展页（webview guest）的 session 隔离与围栏。
 *
 * 两条与主窗口不同的地方：
 *   1. **独立 session**（见 shared/plugin.ts 的 PLUGIN_PARTITION）。上面那个 applyCsp()
 *      是 `session.defaultSession.webRequest.onHeadersReceived`，它改写的是整个会话的
 *      响应头 —— 插件页那份 HTML 也在同一个来源上，不隔离就会被套上宿主的 CSP，
 *      表现为插件莫名其妙地坏掉、且没有任何报错。代价是权限、证书校验这些要给
 *      这份 session 单独配一遍。
 *   2. guest 是**第三方代码**：开新窗口一律拒绝并改用系统浏览器，非 http(s) 的导航
 *      直接拦掉。与主窗口同一条围栏，只是对象不同。
 */
function hardenPluginSession(): void {
  const pluginSession = session.fromPartition(PLUGIN_PARTITION)

  // 麦克风/摄像头/通知/地理位置：候选页要的一个都不给，与主窗口一致
  pluginSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  // 「忽略自签证书」这项要跟着走，否则会出现「接口连得上、插件页打不开」的怪状态。
  // 读的是当前设置而不是启动时那份：这一项在设置页随时可改。
  pluginSession.setCertificateVerifyProc((_request, callback) => {
    callback(store.getSettings().allowInsecureTls ? 0 : -3)
  })

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return

    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      // 插件页内部跳路由是正常的，只挡非 http(s)
      if (/^https?:/i.test(url)) return
      event.preventDefault()
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

/**
 * 装配一个主窗口的监听。
 *
 * ★ 必须可重复调用：macOS 在「窗口都关掉但应用还活着」时会走 `activate` 重建窗口。
 *   原先只在启动路径上挂这两个监听，重建出来的窗口于是既不会在关闭时把 mainWindow
 *   置空（留下野引用），也不受 `closeToTray` 约束 —— 一次重建就静默丢掉两个行为。
 */
function attachWindowHandlers(window: BrowserWindow): void {
  window.on('closed', () => {
    // 只清理「当前这一个」：旧窗口延迟到达的 closed 不该抹掉新窗口的引用
    if (mainWindow === window) mainWindow = null
  })

  // 关闭即最小化到托盘（默认关）：拦下 close，改成 hide
  window.on('close', (event) => {
    if (isQuitting) return
    if (!store.getSettings().closeToTray) return
    event.preventDefault()
    window.hide()
  })

  // ── 进程级异常：不能让用户对着一个白窗口，也不能陷入重载死循环 ──────────
  // 渲染进程崩掉（OOM / GPU 驱动）后 Chromium 不会自行恢复，重新加载是最直白的兜底；
  // 但连续崩溃必须有闸门 —— 反复 reload 比白窗口更糟，这里退化成「只记日志」。
  let lastCrashReloadAt = 0
  const CRASH_RELOAD_COOLDOWN_MS = 30_000

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[main] 渲染进程退出：${details.reason}（exitCode=${details.exitCode}）`)
    if (details.reason === 'clean-exit') return
    if (Date.now() - lastCrashReloadAt < CRASH_RELOAD_COOLDOWN_MS) {
      console.error('[main] 短时间内重复退出，放弃自动重载，请看上方日志')
      return
    }
    lastCrashReloadAt = Date.now()
    console.warn('[main] 正在重新加载界面')
    window.webContents.reload()
  })

  // 卡死**不**自动重载：那会把用户正在做的事直接丢掉，只留日志等它自己缓过来
  window.on('unresponsive', () => {
    console.warn('[main] 界面无响应，等待其自行恢复')
  })
  window.on('responsive', () => {
    console.warn('[main] 界面已恢复响应')
  })

  // file:// 加载失败（产物损坏、路径不对）时只剩白屏，至少要留下可查的日志。
  // -3 是 ABORTED（正常的导航取消），不算错误。
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return
    console.error(`[main] 页面加载失败：${errorDescription}（${errorCode}）${validatedURL}`)
  })
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
    (_event, url: string, creds: Omit<StoredCredentials, 'savedAt'>) => {
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
  ipcMain.handle(IPC.serversAccounts, () => store.listAccounts())

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
  // 迷你模式的窗口几何在 windows.ts 里（它拿着那个窗口，也知道什么时候不该写 bounds）
  ipcMain.handle(IPC.windowSetMini, (_event, state: MiniModeState) => setMiniMode(state))

  // 托盘 / 系统
  ipcMain.handle(IPC.trayUpdate, (_event, snapshot: TraySnapshot) => {
    renderTray(trayDeps, snapshot)
  })
  ipcMain.handle(IPC.openExternal, (_event, url: string) => {
    // 只放行 http(s)，别让渲染层用 file:// 或自定义协议拉起本机程序
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })
  ipcMain.handle(IPC.fileSave, (_event, suggestedName: string, contents: string) =>
    saveTextFile(mainWindow, suggestedName, contents)
  )
  ipcMain.handle(IPC.fileOpen, () => openTextFile(mainWindow))
  ipcMain.handle(IPC.localCacheStats, () => readLocalCache())
  ipcMain.handle(IPC.localCacheClear, () => clearLocalCache())
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
  ipcMain.handle(IPC.clientUpdateCheck, (_event, proxyPrefix?: string) =>
    checkClientUpdate(proxyPrefix)
  )
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
    // 必须早于任何 webview 挂载：它注册的 web-contents-created 只在创建时生效一次
    hardenPluginSession()
    registerIpcHandlers()
    installAppMenu(() => mainWindow)

    mainWindow = createMainWindow(store)
    attachWindowHandlers(mainWindow)

    createTray(trayDeps)
    disposeMediaKeys = registerMediaKeys(broadcastMediaCommand)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(store)
        // ★ 重建的窗口也要挂上监听，否则 closeToTray 与 mainWindow 置空就只对首个窗口有效
        attachWindowHandlers(mainWindow)
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
