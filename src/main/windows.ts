/**
 * 主窗口：无边框 + 自绘标题栏（媒体播放器的常见形态），位置尺寸记忆，
 * 以及「不许离开自家界面」的导航围栏。
 *
 * ★ 迷你播放器**不在这个窗口里**：它是另一个 BrowserWindow（见 main/mini-window.ts）。
 *   点主播放器上那颗迷你按钮只是开 / 关那个小窗，主窗口自始至终不被缩小、也不重排 ——
 *   这也是「迷你条挂在屏幕一角」这件事真正的样子（在任务栏 / Alt-Tab / 别的窗口眼里，
 *   那个小窗本来就是独立的一个窗）。
 */

import { BrowserWindow, app, shell } from 'electron'
import { join } from 'node:path'

import { IPC, type WindowState } from '@shared/ipc'
import { loadAppIcon } from './app-icon'
import type { ConfigStore } from './store'

const MIN_WIDTH = 1080
const MIN_HEIGHT = 660

/**
 * 当前主窗口的「置顶」执行器。
 *
 * 放模块级单例（而不是让 createMainWindow 多返回一个值）是为了跟 index.ts 那边
 * 拿 mainWindow 的方式保持一致：本应用只有一个主窗口。
 */
let applyMainWindowOnTop: (() => void) | null = null

/**
 * 设置里那份置顶改了 —— 让真窗口跟上。
 *
 * 只处理置顶：尺寸/位置不归设置管（那是用户拖出来的），所以不复用完整的状态重落。
 * 迷你窗那份置顶在 mini-window.ts 里（两个窗口各管自己那一份设置）。
 */
export function applyWindowOnTop(): void {
  applyMainWindowOnTop?.()
}

/** 开发态由 electron-vite 注入；打包后为 undefined */
export const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL

export function createMainWindow(store: ConfigStore): BrowserWindow {
  const saved = store.getWindowBounds()

  const window = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // 任务栏 / Alt-Tab / Dock 里的图标由窗口自己声明：不显式给就会退回 Electron 自带
    // 那枚（开发态尤其明显）。拿不到图标也不拦启动，交给系统默认值。
    icon: loadAppIcon() ?? undefined,
    // ★ 无边框：标题栏由渲染层自绘，和播放器主题统一
    frame: false,
    /*
     * ★ 透明窗口。整个程序的「窗口不透明度」（AppSettings.windowOpacity）全靠它 ——
     *   不透明的窗口里，渲染层把界面调得再淡也只是与窗口底色混在一起（看着像「变暗」），
     *   桌面永远透不进来（见 shared/ipc.ts 里那条说明）。
     *
     * ★ 恒开，不按设置开关：transparent 是**创建窗口时**生效的属性，运行中改不了 ——
     *   若跟着设置走，用户拧一次滑块就得重启应用才看得到，或者还得再做一个「重启后生效」
     *   的提示。代价只是「窗口带 alpha 通道」这一件事本身（默认 windowOpacity=100 时
     *   界面照旧实心，观感与改动前一致）。
     *
     * 两句必须成对：transparent 要求窗口底色也是透明的，否则 Chromium 会把透明像素
     * 合成到下面那块底色上，等于没开。（原先这里是不透明的深色，用来挡加载期的白闪；
     * 现在首帧由渲染层的 .shell 铺底，一样没有白闪。）
     *
     * ⚠ 平台限制（都与「窗口透明度」相关，别在这里顺手改回去）：
     *   · Linux：要合成器（有 alpha 通道的 surface）。GNOME / KDE 默认都有；裸 WM 下
     *     表现为不透（退回实心），不会崩。另外 Chromium 的 backdrop-filter **只能模糊
     *     同一窗口里它下面的内容**，透明窗口不会让它去模糊桌面 —— 别指望毛玻璃看穿。
     *   · Windows：DWM 关了会失效；老版本还有「透明窗口最大化异常」的毛病。
     *   · macOS：与 vibrancy 互斥（本项目没用 vibrancy，无碍）。
     */
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // ★ 三道必须同时成立：隔离上下文 + 开沙箱 + 关 Node 集成。
      //   preload 因此在 CJS 下产出（sandbox 环境不支持 ESM preload）。
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // ★ 扩展页用 <webview> 装载。为什么不是 <iframe>：iframe 跨源，宿主没有任何 API
      //   能单独静音它、也不知道它在不在出声（那是「静音」右键项与「播放中」角标的
      //   全部依据）。webview 的 guest 有 setAudioMuted 与 media-started-playing。
      //   代价是必须配套加固 —— 见下面的 will-attach-webview 与 main/index.ts。
      webviewTag: true,
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

  /**
   * ★ 扩展页（webview guest）的附加加固。
   *
   * webviewTag 一开，guest 的 webPreferences 就可以由**页面自己**在元素上声明
   * （`webpreferences="nodeIntegration=yes"` 这类）—— 等于把「要不要 Node、
   * 要不要 preload」交给了渲染层。所以这里一律覆写成我们认可的那一套：
   * 不要 preload、不要 Node、开沙箱与上下文隔离。这是 Electron 官方对 webview 的
   * 硬性要求，少做一步就等于把系统能力交给第三方插件页。
   *
   * 顺带把非 http(s) 的挂载挡掉：插件页永远是后端上的 http(s) 资源。
   *
   * ⚠ `allowpopups` **不在这里覆写**（它是元素属性、不在 webPreferences 里）。渲染层会显式
   *   声明它 —— 少了它，插件页里的 `<a target="_blank">` 与 `window.open` 会在 guest 层被
   *   丢弃，主进程那个「deny + 系统浏览器」的 handler 连触发机会都没有（表现为链接点了没
   *   反应）。放开它不等于放任开窗：真正的处置在 main/index.ts 的 hardenPluginSession。
   */
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!/^https?:/i.test(params.src)) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
  })

  window.webContents.on('will-navigate', (event, url) => {
    const isDev = DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)
    if (isDev || url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  // 拒绝一切权限请求（麦克风/摄像头/通知/地理位置……播放器一个都不需要）
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )

  // ── 窗口状态同步给渲染层（自绘标题栏要知道什么时候显示「还原」图标）──────
  const emitState = (): void => {
    if (window.isDestroyed()) return
    const state: WindowState = {
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
      focused: window.isFocused()
    }
    window.webContents.send(IPC.onWindowState, state)
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

  // ── 置顶（这一份设置只归主窗口；迷你窗那份在 mini-window.ts）──────────────
  /**
   * 把「置顶」落到真窗口上。**分平台各做各的那一份**，因为三个平台的机制与坑都不一样：
   *
   * · Windows：`setAlwaysOnTop(true)` 就是 HWND_TOPMOST，一句够用（level 参数它不认，传了无害）。
   * · macOS：level 在这里才有意义 —— 'floating' 是「浮在普通窗口之上、但在菜单栏与系统通知
   *   之下」那一档。但只写这一句还不够：用户切到别的 Space、或别的应用进全屏时，这个窗会跟着
   *   被盖掉/收起，所以还要 setVisibleOnAllWorkspaces。大窗口只是「浮在普通窗口之上」，
   *   别顺手改掉它的工作区归属（跨空间 + 全屏之上是**迷你条**才要的那份，见 mini-window.ts）。
   * · Linux / X11：走 _NET_WM_STATE_ABOVE，由窗口管理器实现，一句够用。
   * · Linux / Wayland：**协议层就没有这个请求**（xdg-shell 里没有，GNOME 也没实现任何替代
   *   扩展），下面这一句会被合成器**无声忽略**。所以这条路上它不是「写漏了」，而是本来就
   *   没有可写的 API —— 想在这种会话下真的要到位顶，只能用 X11 后端启动
   *   （`SONGLOFT_OZONE=x11`，见 index.ts 顶部；默认不开，那份代价不小）。
   */
  const setWindowOnTop = (on: boolean): void => {
    window.setAlwaysOnTop(on, 'floating')
    /*
     * macOS 上顺手把「跨所有空间」关掉：那一条是**迷你条**才要的（见 mini-window.ts），
     * 大窗口的置顶只该是「浮在普通窗口之上」，不该跟着用户跑到别的 Space 去。
     * 两个窗口是各自独立的窗口，所以这里关它不会碰到迷你条那份。
     */
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(false)
  }

  /**
   * 该不该置顶：**每次现读设置**，不缓存一份在内存里。
   *
   * 设置可能在任何一刻被改（右键菜单、设置页、托盘），缓存就得再维护一处「什么时候刷新」
   * —— 而这里读的是一次内存对象拷贝，比那套同步便宜得多，也不会漏。
   */
  const applyWindowOnTop = (): void => {
    if (window.isDestroyed()) return
    setWindowOnTop(store.getSettings().alwaysOnTop)
  }

  /* 启动就落一次 */
  applyWindowOnTop()
  applyMainWindowOnTop = applyWindowOnTop

  /**
   * 重新落一遍置顶。平台在几个时机（退出全屏、取消最大化、从最小化回来、隐藏后再显示）
   * 会把「窗口状态」整份摆回去，而置顶是这份状态里的一项 —— 不补的话表现是「置顶时灵时不灵」。
   * 幂等：重复设没有副作用。
   */
  const reassertWindowState = (): void => {
    if (window.isDestroyed()) return
    applyWindowOnTop()
  }

  window.on('leave-full-screen', reassertWindowState)
  window.on('unmaximize', reassertWindowState)
  /* 从最小化回来（托盘 / 任务栏唤回）同样是「状态被摆回」的时机之一，一并补。 */
  window.on('restore', reassertWindowState)
  /* 从托盘重新显示。closeToTray 那条路在 X11 / Windows / macOS 上是 hide→show，在 Wayland 上
     是 minimize→restore（理由见 index.ts 的 collapseWindow），两个时机都会经过这里。
     macOS 上 setVisibleOnAllWorkspaces 也会在隐藏/显示之间被平台摆回，同样要补。 */
  window.on('show', reassertWindowState)

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
