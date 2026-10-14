/**
 * 迷你播放器窗口：**独立的一个 BrowserWindow**，不是主窗口缩小出来的形态。
 *
 * ★ 为什么是独立窗口（这是与以前最大的不同）：
 *   迷你条要的是「挂在屏幕一角、主界面该干嘛干嘛」—— 而「把主窗口缩成 400×64」做不到这一点：
 *   主窗口一缩，里面的列表、扩展 webview、正在出声的页面全都被迫按 400px 重排一次，
 *   用户想同时看曲库与迷你条更是无从谈起。独立窗口之后，两边各是一棵独立的界面树。
 *
 * ★ 代价是**状态要过桥**：两个渲染层之间没有直接通道，而播放的唯一事实源在主窗口那边
 *   （音频元素、队列、歌词都在它手里，见 renderer/state/usePlayer）。所以：
 *     · 主窗口把「播放状态快照」推给主进程 → 主进程转给迷你窗；
 *     · 迷你窗把「遥控命令」发给主进程 → 主进程转给主窗口执行。
 *   本文件只做**转发与窗口几何**，一个播放状态都不持有（谁也别在这里缓存播放数据：
 *   两份状态迟早不一致，而「迷你条显示的与在放的不是同一首歌」是最难查的那种不一致）。
 *
 * ★ 几何（宽度固定、高度按布局算）为什么在主进程：面板高度是用户拖出来的（渲染层知道），
 *   但「真窗口有多高」只能在这里改；而且屏幕工作区的钳制也只有这里做得到。
 *   渲染层只报布局（MiniWindowLayout），算尺寸是这里的事。
 */

import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'

import {
  IPC,
  MINI_BAR_HEIGHT,
  MINI_MENU_HEIGHT,
  MINI_PANEL_MIN_HEIGHT,
  MINI_WIDTH,
  type MiniCommand,
  type MiniPlayerSnapshot,
  type MiniWindowLayout
} from '@shared/ipc'
import { loadAppIcon } from './app-icon'
import type { ConfigStore } from './store'
import { DEV_SERVER_URL } from './windows'

/** 迷你窗与屏幕边缘留的缝（默认摆在工作区右上角） */
const MARGIN = 16

export interface MiniWindowBridge {
  /** 迷你窗开 / 关了：告诉主窗口（按钮高亮、要不要继续推状态都看它） */
  onOpenChanged: (open: boolean) => void
  /** 迷你窗在要状态：转问主窗口 */
  onRequestSnapshot: () => void
  /** 迷你窗发来的遥控命令：转给主窗口执行 */
  onCommand: (command: MiniCommand) => void
}

let store: ConfigStore | null = null
let bridge: MiniWindowBridge | null = null
let miniWindow: BrowserWindow | null = null

/** 迷你窗口开着没有（主窗口那颗按钮的高亮、推送的开关都看它） */
export function isMiniWindowOpen(): boolean {
  return Boolean(miniWindow && !miniWindow.isDestroyed())
}

/**
 * 摆一次窗口尺寸。
 *
 * 面板展开时的高度 = 播放条 + 面板高度（下限 MINI_PANEL_MIN_HEIGHT 兜住），未展开时就是
 * 播放条那一档；窗口里开着右键菜单而面板没开时，临时加高到 MINI_MENU_HEIGHT —— 菜单是页面里
 * 的 DOM，64px 的窗口画不下它（见 shared/ipc.ts 的常量说明）。
 *
 * 不展开时也走同一条路（而不是「只在展开时才算」）：面板收起、菜单关掉都要缩回去。
 * 位置不动 —— 窗只会**向下**长，用户把它拖到哪儿就一直在那儿。
 */
function applyBounds(layout: MiniWindowLayout): void {
  const win = miniWindow
  if (!win || win.isDestroyed()) return

  const panel = Math.max(MINI_PANEL_MIN_HEIGHT, Math.round(layout.panelHeight))
  let height = layout.expanded ? MINI_BAR_HEIGHT + panel : MINI_BAR_HEIGHT
  if (layout.menu) height = Math.max(height, MINI_MENU_HEIGHT)

  const [x, y] = win.getPosition()
  const { workArea } = screen.getDisplayNearestPoint({ x, y })
  // 工作区兜底：面板拖到比屏幕还高时窗口不该比屏幕还高
  const maxHeight = Math.max(MINI_BAR_HEIGHT, workArea.height - MARGIN)
  win.setBounds({ x, y, width: MINI_WIDTH, height: Math.min(height, maxHeight) })
}

/**
 * 迷你窗那份「置顶」。
 *
 * 与主窗口那份（windows.ts）**各读各的设置、互不影响**：主窗口的置顶是为了不被别的窗口
 * 压住，迷你条的置顶是它存在的意义（浮在屏幕一角、停在别的东西旁边）。
 * macOS 上还多两条：跨所有空间 + 全屏之上 —— 用户切空间或别人进全屏时，这条都该还在。
 */
export function applyMiniWindowOnTop(): void {
  const win = miniWindow
  if (!win || win.isDestroyed()) return

  const on = store?.getSettings().miniAlwaysOnTop ?? true
  win.setAlwaysOnTop(on, 'floating')
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on })
  }
}

/**
 * 开一个迷你窗。
 *
 * ★ 位置默认落在**工作区右上角**：不是偏好问题，而是几何决定的 —— 播放条在上、面板在它
 *   下方，窗口只会**向下**长（见 applyBounds）。摆在下半屏的话，一开歌词就顶到屏幕外面去了。
 *   （Wayland 下合成器会自己决定位置，setBounds 可能被忽略，这一条也就落不了地。）
 * ★ show: false + 渲染层 ready() 之后再显示：迷你窗是新渲染进程，设置（主题/强调色）
 *   要读回来才知道长什么样，先显示就会闪一下深色底 —— 与主窗口那条 ready-to-show 同一个理由。
 * ★ skipTaskbar: 它是挂在屏幕角上的挂件，不该在任务栏里再占一格（主窗口那格管着整个应用）。
 *   从屏幕上看不见它时要靠托盘唤回主界面 —— 那条路本来就有。
 */
export function openMiniWindow(): void {
  if (isMiniWindowOpen()) {
    miniWindow?.show()
    return
  }
  if (!store) return

  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    x: workArea.x + workArea.width - MINI_WIDTH - MARGIN,
    y: workArea.y + MARGIN,
    width: MINI_WIDTH,
    height: MINI_BAR_HEIGHT,
    minWidth: MINI_WIDTH,
    minHeight: MINI_BAR_HEIGHT,
    icon: loadAppIcon() ?? undefined,
    frame: false,
    // 与主窗口同一套：透明窗口 + 自绘界面（条/面板的底色由渲染层画，桌面能透过来）
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    skipTaskbar: true,
    // 尺寸由 applyBounds 定（用户拖的只是面板高度，那是自定义的把手，不是系统边框）
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  miniWindow = win

  // 与主窗口同一条导航围栏：任何要离开自家界面的跳转都改用系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const isDev = DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)
    if (isDev || url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  // 渲染进程崩了就重载一次；卡死只记日志（与主窗口 attachWindowHandlers 同一个口径）
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[mini] 渲染进程退出：${details.reason}（exitCode=${details.exitCode}）`)
    if (details.reason === 'clean-exit') return
    if (!win.isDestroyed()) win.webContents.reload()
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return
    console.error(`[mini] 页面加载失败：${errorDescription}（${errorCode}）${validatedURL}`)
  })

  /*
   * 落定时的收尾：窗口真没了就把引用清掉（延迟到达的 closed 不该抹掉后来那一个），
   * 并告诉主窗口「迷你窗关了」。
   */
  win.on('closed', () => {
    if (miniWindow === win) miniWindow = null
    bridge?.onOpenChanged(false)
  })

  applyMiniWindowOnTop()

  /*
   * 界面靠 hash 分流（见 renderer/src/main.tsx）：同一个入口文件，迷你窗用 #mini。
   * 不另做一份 html 入口是因为两者共用全部样式与组件 —— 多一个入口就等于多一处要同步。
   */
  if (DEV_SERVER_URL) {
    void win.loadURL(`${DEV_SERVER_URL}#mini`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' })
  }

  bridge?.onOpenChanged(true)
}

/** 关掉迷你窗（点它的关闭钮、或主窗口那颗按钮再点一次） */
export function closeMiniWindow(): void {
  const win = miniWindow
  if (!win || win.isDestroyed()) return
  win.close()
}

/** 主窗口那颗按钮：开 / 关 */
export function setMiniWindowOpen(open: boolean): void {
  if (open) openMiniWindow()
  else closeMiniWindow()
}

/** 把主窗口推来的播放状态转给迷你窗 */
export function sendMiniSnapshot(snapshot: MiniPlayerSnapshot): void {
  const win = miniWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.onMiniState, snapshot)
}

/**
 * 迷你窗报来的布局 / 就绪信号 —— 从 index.ts 的 IPC 里转过来。
 *
 * 分成两件是因为它们的副作用完全不同：resize 只动窗口几何，ready 还要**显示窗口**并向主窗口
 * 要一份状态（那份状态是异步来的，不能在这里同步等）。
 */
export function handleMiniResize(layout: MiniWindowLayout): void {
  applyBounds(layout)
}

export function handleMiniReady(): void {
  const win = miniWindow
  if (!win || win.isDestroyed()) return
  win.show()
  bridge?.onRequestSnapshot()
}

/** mini-window 的接线。index.ts 在 ready 时调一次（与其他模块的接线同一条路）。 */
export function installMiniWindow(config: ConfigStore, handlers: MiniWindowBridge): void {
  store = config
  bridge = handlers
}

/** 应用退出前清引用（避免销毁过程中的事件再往一个死窗口上写） */
export function disposeMiniWindow(): void {
  bridge = null
  store = null
  miniWindow = null
}
