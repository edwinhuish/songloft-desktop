/**
 * 主窗口：无边框 + 自绘标题栏（媒体播放器的常见形态），位置尺寸记忆，
 * 以及「不许离开自家界面」的导航围栏。
 */

import { BrowserWindow, app, shell } from 'electron'
import { join } from 'node:path'

import type { WindowState } from '@shared/ipc'
import type { ConfigStore } from './store'

const MIN_WIDTH = 1080
const MIN_HEIGHT = 660

/** 开发态由 electron-vite 注入；打包后为 undefined */
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL

export function createMainWindow(store: ConfigStore): BrowserWindow {
  const saved = store.getWindowBounds()

  const window = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // ★ 无边框：标题栏由渲染层自绘，和播放器主题统一
    frame: false,
    // 深色打底，避免加载期白闪（与默认主题一致）
    backgroundColor: '#0f1016',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // ★ 三道必须同时成立：隔离上下文 + 开沙箱 + 关 Node 集成。
      //   preload 因此在 CJS 下产出（sandbox 环境不支持 ESM preload）。
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  if (saved.maximized) window.maximize()

  // 首帧画好再显示，避免看到「白底 → 深色」的闪一下
  window.once('ready-to-show', () => window.show())

  // ── 导航围栏 ───────────────────────────────────────────────────────────
  // 任何试图把自家窗口导航到外部地址的行为都被拦下，改用系统浏览器打开。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const isDev = DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)
    if (isDev || url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  // 拒绝一切权限请求（麦克风/摄像头/通知/地理位置……播放器一个都不需要）
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  // ── 窗口状态同步给渲染层（自绘标题栏要知道什么时候显示「还原」图标）──────
  const emitState = (): void => {
    if (window.isDestroyed()) return
    const state: WindowState = {
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
      focused: window.isFocused()
    }
    window.webContents.send('window:state', state)
  }
  // 逐个注册而不用「遍历事件名数组」：BrowserWindow.on 是每个事件一个重载，
  // 传联合类型的事件名会匹配不上任何单个重载（TS2769）。
  window.on('maximize', emitState)
  window.on('unmaximize', emitState)
  window.on('enter-full-screen', emitState)
  window.on('leave-full-screen', emitState)
  window.on('focus', emitState)
  window.on('blur', emitState)
  window.webContents.on('did-finish-load', emitState)

  // ── 位置尺寸记忆（防抖：拖动窗口期间不该狂写盘）────────────────────────
  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (window.isDestroyed()) return
      const maximized = window.isMaximized()
      if (!maximized && !window.isFullScreen()) {
        const [width, height] = window.getSize()
        const [x, y] = window.getPosition()
        store.saveWindowBounds({ width, height, x, y, maximized })
      } else {
        store.saveWindowBounds({ maximized })
      }
    }, 400)
  }
  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    scheduleSave()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (!window.isDestroyed()) {
      const maximized = window.isMaximized()
      const [width, height] = window.getSize()
      const [x, y] = window.getPosition()
      store.saveWindowBounds(maximized ? { maximized } : { width, height, x, y, maximized })
    }
  })

  // ── 加载页面 ───────────────────────────────────────────────────────────
  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 开发态下把 DevTools 的快捷键留给用户，但不要自动打开
  if (!app.isPackaged && process.env.SONGLOFT_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' })
  }

  return window
}
