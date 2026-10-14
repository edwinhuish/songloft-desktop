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
  type MiniCommand,
  type MiniPlayerSnapshot,
  type MiniWindowLayout,
  type ServerEntry,
  type TraySnapshot
} from '@shared/ipc'
import { installAppMenu } from './app-menu'
import { applyLocalCacheLimit, clearLocalCache, readLocalCache } from './cache'
import { checkClientUpdate } from './release'
import { openTextFile, saveTextFile } from './files'
import { registerMediaKeys } from './media-keys'
import {
  applyMiniWindowOnTop,
  closeMiniWindow,
  disposeMiniWindow,
  handleMiniReady,
  handleMiniResize,
  installMiniWindow,
  isMiniWindowOpen,
  sendMiniSnapshot,
  setMiniWindowOpen
} from './mini-window'
import { fetchCoverBytes, probeServer } from './probe'
import { PLUGIN_PARTITION } from '@shared/plugin'
import { ConfigStore } from './store'
import { createTray, destroyTray, render as renderTray } from './tray'
import { applyWindowOnTop, createMainWindow } from './windows'

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

/**
 * Linux 下改用 X11 后端（XWayland）—— **只在显式要求时**（`SONGLOFT_OZONE=x11`），默认不动。
 *
 * 这个口子是为了「置顶」：Wayland 的 xdg-shell 里没有这个请求，GNOME 也没实现替代扩展，
 * window.setAlwaysOnTop() 在那条路上会被合成器**无声忽略**（见 windows.ts 的
 * setWindowOnTop）；走 XWayland 之后它落到 _NET_WM_STATE_ABOVE 上，窗口图标
 * （_NET_WM_ICON）与 globalShortcut 的 X11 抓取也一并回到正常路径。
 *
 * ★ 但**不能默认切**：本机实测（GNOME 45 / Wayland + XWayland）一进 dev 就
 *   `GPU process exited unexpectedly: exit_code=139`（SIGSEGV）连发三发、窗口整个画不出来，
 *   紧跟一句 `XGetWindowAttributes failed for window 1`。默认切过去等于把「能用的应用」换成
 *   「要置顶但打不开的应用」—— 所以默认一切照平台走（本机 = 原生 Wayland），
 *   只有明确要置顶的人才吃这份代价。默认态下置顶在 GNOME 上就是不成立，这是平台的账。
 * ★ 连着 `--disable-gpu` 一起给：崩的是 XWayland 那条 GPU 路径，而这条路的唯一目的是置顶，
 *   用软件合成换它稳定（e2e 那条路也是这么跑的，见 scripts/e2e/run.sh）。
 *
 * ★ 必须赶在 app ready 之前设：Chromium 只在启动时读一次平台，运行中改不了 —— 所以它和
 *   SONGLOFT_USER_DATA 一样放在文件顶部这一段。
 */
if (process.platform === 'linux' && process.env.SONGLOFT_OZONE === 'x11') {
  app.commandLine.appendSwitch('ozone-platform', 'x11')
  app.commandLine.appendSwitch('disable-gpu')
}

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

/**
 * 这条 IPC 是哪个窗口发来的。
 *
 * ★ 几颗窗口钮（最小化 / 最大化 / 关闭）一律作用于**它自己**：迷你窗那颗关闭只该关掉迷你条，
 *   不该把主界面一起收掉（迷你条上那颗最小化已撤掉，但语义照旧）。原先一律打到 mainWindow 上，
 *   是因为当时只有一个窗。
 */
function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/**
 * 设置被改了：把新的一份推给**其余**窗口。
 *
 * 两个窗口各有一份 useSettings（迷你窗是另一个渲染进程），而主题 / 强调色 / 两份整窗浓度
 * 都是「一改就该两处同时变」的东西 —— 只靠调用方自己刷新的话，主窗口改主题、迷你条还停在
 * 旧主题上。不改调用的那个窗口是因为它拿到的返回值就是新的一份，再推一遍只是白跑。
 */
function broadcastSettings(settings: AppSettings, from: Electron.WebContents): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents === from) continue
    win.webContents.send(IPC.onSettingsChanged, settings)
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
    if (mainWindow !== window) return
    mainWindow = null
    /*
     * 主界面没了，迷你条也就失去了宿主：播放由它驱动、遥控命令要它执行、连它上那份状态
     * 也是它推的。留着一个既放不出声、点也点不动的条没有意义，一并关掉。
     */
    if (isMiniWindowOpen()) closeMiniWindow()
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

/**
 * patch 里**显式**给了这一项吗。
 *
 * 用 hasOwnProperty 而不是判值：`{ volume: 0 }` 与「没提 volume」是两回事，
 * 有些 patch 项带着副作用（改置顶要落窗口、改 TLS 要重装策略），只有显式给了才该触发。
 */
function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function registerIpcHandlers(): void {
  // 设置
  ipcMain.handle(IPC.settingsGet, () => store.getSettings())
  ipcMain.handle(IPC.settingsPatch, (event, patch: Partial<AppSettings>) => {
    const next = store.patchSettings(patch)
    if (has(patch, 'allowInsecureTls')) {
      applyTlsPolicy(next.allowInsecureTls)
    }
    /*
     * 置顶是**窗口状态**而不是界面状态：写入配置只是记住了偏好，还得当场落到真窗口上。
     * 两个窗口各有一份（主窗 / 迷你窗），所以两项都要看一眼 —— 只落其中一份的话，
     * 用户勾了「迷你窗置顶」要等下次开迷你窗才生效。
     */
    if (has(patch, 'alwaysOnTop')) applyWindowOnTop()
    if (has(patch, 'miniAlwaysOnTop')) applyMiniWindowOnTop()
    broadcastSettings(next, event.sender)
    return next
  })
  ipcMain.handle(IPC.settingsReset, (event) => {
    const next = store.resetSettings()
    applyTlsPolicy(next.allowInsecureTls)
    // 复位会把两份置顶设置一起打回默认（大窗口关、迷你开），两个窗口都得跟着回去
    applyWindowOnTop()
    applyMiniWindowOnTop()
    broadcastSettings(next, event.sender)
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

  // 窗口（一律作用于**发来这条 IPC 的那个窗口**，见 senderWindow 的说明）
  ipcMain.handle(IPC.windowMinimize, (event) => senderWindow(event)?.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const win = senderWindow(event)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, (event) => senderWindow(event)?.close())
  ipcMain.handle(IPC.windowGetState, (event) => {
    const win = senderWindow(event)
    return {
      maximized: win?.isMaximized() ?? false,
      fullscreen: win?.isFullScreen() ?? false,
      focused: win?.isFocused() ?? false
    }
  })

  // ── 迷你窗口（几何与转发都在 mini-window.ts 里，见那里的说明）───────────────
  ipcMain.handle(IPC.miniSetOpen, (event, open: boolean) => {
    // 只认主窗口这一个来源：本应用只有主界面能开迷你窗，迷你窗自己不该再开一个
    if (senderWindow(event) !== mainWindow) return
    setMiniWindowOpen(open)
  })
  /*
   * 「迷你窗此刻开着没有」：窗口是主进程开的，这个事实只有它知道（见 IPC.miniIsOpen 的说明）。
   * 不限定来源 —— 主窗口与迷你窗问到的都是同一个答案，为一个查询分来源没有意义。
   */
  ipcMain.handle(IPC.miniIsOpen, () => isMiniWindowOpen())
  ipcMain.handle(IPC.miniResize, (_event, layout: MiniWindowLayout) => handleMiniResize(layout))
  ipcMain.handle(IPC.miniReady, () => handleMiniReady())
  ipcMain.handle(IPC.miniPush, (_event, snapshot: MiniPlayerSnapshot) => sendMiniSnapshot(snapshot))
  ipcMain.handle(IPC.miniCommand, (_event, command: MiniCommand) => {
    sendToRenderer(IPC.onMiniCommand, command)
  })

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

    /*
     * 迷你窗的接线：它要的三样东西分别是「通知主窗口开/关」「问主窗口要一份状态」
     * 「把遥控命令交给主窗口执行」—— 全是转发，主进程自己一个播放状态都不持有。
     */
    installMiniWindow(store, {
      onOpenChanged: (open) => sendToRenderer(IPC.onMiniOpen, open),
      onRequestSnapshot: () => sendToRenderer(IPC.onMiniRequest, null),
      onCommand: (command) => sendToRenderer(IPC.onMiniCommand, command)
    })

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
    disposeMiniWindow()
  })

  app.on('window-all-closed', () => {
    // Linux 上托盘常驻是常见用法，但这个应用默认「关掉窗口就退出」，
    // 只有用户显式开了 closeToTray 才留在后台（那条路径下窗口不会真的 close）。
    if (process.platform !== 'darwin') app.quit()
  })
}
