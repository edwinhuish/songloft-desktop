/**
 * 主窗口：无边框 + 自绘标题栏（媒体播放器的常见形态），位置尺寸记忆，
 * 以及「不许离开自家界面」的导航围栏。
 */

import { BrowserWindow, app, shell, type Rectangle } from 'electron'
import { join } from 'node:path'

import { IPC, type MiniModeState, type WindowState } from '@shared/ipc'
import { loadAppIcon } from './app-icon'
import type { ConfigStore } from './store'

const MIN_WIDTH = 1080
const MIN_HEIGHT = 660

/**
 * 迷你模式的三档窗口尺寸：只有播放条 / 播放条 + 下方面板 / 播放条 + 一张右键菜单。
 *
 * 与渲染层是对着定的：那条播放条在 CSS 里是 64px 高（`.shell[data-mini]` 的 --mini-bar-h），
 * 展开那档 480 减掉它，剩下的 416px 就是面板那一屏。改一边就要看一眼另一边。
 *
 * ★ 面板里装的是**歌词还是播放队列，主进程不管**（两者共用这一份高度，见 MiniModeState）：
 *   于是「换内容」不动窗口尺寸，切来切去不会跳。
 *
 * ★ 菜单那档（240）是为什么存在：右键菜单是页面里的 DOM，**画不出窗口** —— 而条自己只有
 *   64px 高，一份「置顶 + 不透明度滑块」的菜单实测 104px，压进去只会剩一条带滚动条的缝。
 *   所以菜单一开就把窗口临时加高到容得下它，关掉再缩回去。240 是 64 + 176：176px 给菜单
 *   留出富余（滑块的菜单约 104px，将来多一两项也还放得下；菜单自己还有 max-height: 60vh，
 *   这里 60% × 240 = 144px，不会反过来夹住它）。
 *   渲染层那边配一条 `.mini-player[data-menu]`：条仍然钉在 64px 上，多出来的地方是透明的。
 *   ★ 与面板那档的优先级：面板开着就用 480（那档本来就够高），不再另加。
 *
 * ★ 宽度取 400（约一屏正常窗口的三分之一）仍是**刻意的窄**：它就是个挂在屏幕角上的小挂件，
 *   左边那 64px 是贴左缘的全高封面（见 components.css 的 .mini-bar .cover），其余放**三行**
 *   （歌手 / 歌名 / 时间）与三颗传输键 + 歌词键 + 队列键，中间那栏剩下一百五十来 px ——
 *   哪一行放不下就**那一行自己滚动**（见 MiniPlayer.tsx 的 ScrollingLine），
 *   所以长标题不会只剩省略号。
 *   想让它们少滚几圈就得从别处让：封面、那几颗控件、或这条宽度本身 —— 都不能白来。
 */
const MINI_SIZE = { width: 400, height: 64 }
const MINI_PANEL_SIZE = { width: 400, height: 480 }
const MINI_MENU_SIZE = { width: 400, height: 240 }

export interface MiniModeController {
  setState: (state: MiniModeState) => void
  /**
   * 按「当前形态 + 对应那份置顶设置」重落一次置顶。
   *
   * 设置里那两份置顶（普通 / 迷你）改了就调它 —— 置顶是**窗口状态**不是界面状态，
   * 渲染层改完设置只能到这儿落地（见 createMainWindow 里的 applyWindowOnTop）。
   */
  applyOnTop: () => void
}

/**
 * 当前窗口的迷你模式控制器。
 *
 * 放模块级单例（而不是让 createMainWindow 多返回一个值）是为了跟 index.ts 那边
 * 拿 mainWindow 的方式保持一致：本应用只有一个主窗口。
 */
let miniController: MiniModeController | null = null

/**
 * 渲染层要求进出迷你模式 —— 窗口几何全在这里算。
 *
 * 做成**真窗口**缩小而不是「界面上装小」：缩完之后在任务栏、Alt-Tab、别的窗口眼里
 * 它就是个小播放器，这正是迷你模式的意义（大窗里画一条小东西不算）。
 */
export function setMiniMode(state: MiniModeState): void {
  miniController?.setState(state)
}

/**
 * 设置里那份置顶改了 —— 让真窗口跟上。
 *
 * 只处理置顶：尺寸/位置不归设置管（那是用户拖出来的），所以不复用完整的状态重落。
 */
export function applyWindowOnTop(): void {
  miniController?.applyOnTop()
}

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

  // ── 迷你模式（窗口几何由这里接管，见上面的 setMiniMode）─────────────────
  /**
   * 是否处于迷你模式。下面 scheduleSave 与关窗那两处都要看它 ——
   * 迷你期间窗口是 400×64，那份 bounds 一旦写进配置，**下次开机就是个小窗，
   * 而且再也长不回来**（配置里没有第二份「正常尺寸」可用）。
   */
  let miniActive = false
  /** 下方那块面板（歌词或队列）是否展开 —— 只影响高度，装什么由渲染层定 */
  let miniPanelOpen = false
  /** 窗口里正开着右键菜单 —— 同上，只是为了让那份菜单在 64px 的窗口里画得下（见 MINI_MENU_SIZE） */
  let miniMenuOpen = false
  /**
   * 进迷你之前的窗口形态。
   * 用 getNormalBounds() 取：最大化/全屏下 getBounds() 给的是屏幕那么大，照着还原等于没还原。
   */
  let restore: { bounds: Rectangle; maximized: boolean; fullscreen: boolean } | null = null

  /**
   * 按当前「面板有没有展开 / 菜单有没有开着」把窗口摆到迷你尺寸上
   * （位置不动：它就在用户刚才停下的地方，加高长的只是下半截）。
   *
   * ★ 面板那档优先：它本来就够高，菜单在那 416px 里放得下，不必再加（见 MINI_MENU_SIZE）。
   */
  const applyMiniSize = (): void => {
    const [x, y] = window.getPosition()
    const size = miniPanelOpen ? MINI_PANEL_SIZE : miniMenuOpen ? MINI_MENU_SIZE : MINI_SIZE
    window.setBounds({ x, y, ...size })
  }

  /**
   * 把「置顶」落到真窗口上。**分平台各做各的那一份**，因为三个平台的机制与坑都不一样：
   *
   * · Windows：`setAlwaysOnTop(true)` 就是 HWND_TOPMOST，一句够用（level 参数它不认，传了无害）。
   * · macOS：level 在这里才有意义 —— 'floating' 是「浮在普通窗口之上、但在菜单栏与系统通知
   *   之下」那一档，正是迷你播放器该待的位置。但只写这一句还不够：用户切到别的 Space、或
   *   别的应用进全屏时，这个窗会跟着被盖掉/收起，所以还要 setVisibleOnAllWorkspaces ——
   *   其中 visibleOnFullScreen 是它对「全屏之上」唯一的开关。
   * · Linux / X11：走 _NET_WM_STATE_ABOVE，由窗口管理器实现，一句够用。
   * · Linux / Wayland：**协议层就没有这个请求**（xdg-shell 里没有，GNOME 也没实现任何替代
   *   扩展），下面这一句会被合成器**无声忽略**。所以这条路上它不是「写漏了」，而是本来就
   *   没有可写的 API —— 想在这种会话下真的要到位顶，只能用 X11 后端启动
   *   （`SONGLOFT_OZONE=x11`，见 index.ts 顶部；默认不开，那份代价不小）。
   */
  const setWindowOnTop = (on: boolean, acrossSpaces: boolean): void => {
    if (on) {
      window.setAlwaysOnTop(true, 'floating')
      /*
       * macOS 上「跨所有空间 + 全屏之上」只有迷你条需要 —— 它是个挂在屏幕角上的浮窗，
       * 用户切空间、别人进全屏时它都该还在。大窗口的「置顶」就是老老实实浮在普通窗口之上，
       * 别顺手改掉它的工作区归属（那是另一件事，用户没要）。
       */
      if (process.platform === 'darwin') {
        window.setVisibleOnAllWorkspaces(acrossSpaces, { visibleOnFullScreen: acrossSpaces })
      }
      return
    }
    window.setAlwaysOnTop(false)
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(false)
  }

  /**
   * 当前形态该不该置顶：**迷你态看迷你那份设置，正常态看正常那份**，两份互不影响。
   *
   * 「该不该」每次现读设置而不是缓存一份在内存里：设置可能在任何一刻被改（右键菜单、
   * 设置向导、将来的托盘菜单），缓存就得再维护一处「什么时候刷新」—— 而这里读的是一次
   * 内存对象拷贝，比那套同步便宜得多，也不会漏。
   */
  const shouldWindowBeOnTop = (): boolean => {
    const settings = store.getSettings()
    return miniActive ? settings.miniAlwaysOnTop : settings.alwaysOnTop
  }

  /** 按「当前形态 + 对应那份设置」落一次置顶。设置改了、形态变了、平台把状态摆回去了，都走它 */
  const applyWindowOnTop = (): void => {
    if (window.isDestroyed()) return
    setWindowOnTop(shouldWindowBeOnTop(), miniActive)
  }

  /**
   * 重新落一遍当前形态的窗口状态 —— **置顶与（迷你态的）尺寸一起**。
   *
   * 两件都要，是因为平台在几个时机（退出全屏、取消最大化、从最小化回来、隐藏后再显示）
   * 会把「窗口状态」整份摆回去，而置顶是这份状态里的一项：只补尺寸的话，表现是「小窗还在，
   * 却不再浮在别的窗口上面了」—— 用户看到的是「置顶时灵时不灵」。
   * 幂等：重复设没有副作用（与 applyMiniSize 同一个口径）。
   */
  const reassertWindowState = (): void => {
    if (window.isDestroyed()) return
    applyWindowOnTop()
    // 尺寸只有迷你态才归我们管：正常态的尺寸/位置是用户与平台的
    if (miniActive) applyMiniSize()
  }

  /* 启动就落一次：两份设置里正常态那份现在就生效（迷你那份等进迷你时再说） */
  applyWindowOnTop()

  miniController = {
    applyOnTop: applyWindowOnTop,
    setState: (state) => {
      if (window.isDestroyed()) return

      if (state.mini === miniActive) {
        // 已经在迷你里：还可能变的就是那两件影响高度的事（面板开没开、菜单开没开）
        if (miniActive && (state.expanded !== miniPanelOpen || state.menu !== miniMenuOpen)) {
          miniPanelOpen = state.expanded
          miniMenuOpen = state.menu
          applyMiniSize()
        }
        return
      }

      miniActive = state.mini
      miniPanelOpen = state.expanded
      miniMenuOpen = state.menu

      if (miniActive) {
        const maximized = window.isMaximized()
        const fullscreen = window.isFullScreen()
        restore = { bounds: window.getNormalBounds(), maximized, fullscreen }
        // 先退出全屏/最大化：不退的话设不了这个尺寸，还原时也会叠在一起
        if (fullscreen) window.setFullScreen(false)
        if (maximized) window.unmaximize()
        // 正常态的最小尺寸（1080×660）比迷你窗还大，不放宽的话 setBounds 会被它顶回去
        window.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height)
        window.setResizable(false)
        // 尺寸 + 置顶（这里取的已经是迷你那份设置，与正常态那份无关）一并落一次
        reassertWindowState()
        return
      }

      if (!restore) return
      window.setResizable(true)
      // 退出迷你：置顶换成**正常态那份设置**（用户之前给大窗口设的是开就还是开）
      reassertWindowState()
      window.setMinimumSize(MIN_WIDTH, MIN_HEIGHT)
      window.setBounds(restore.bounds)
      if (restore.maximized) window.maximize()
      if (restore.fullscreen) window.setFullScreen(true)
      restore = null
    }
  }

  /*
   * 退出全屏 / 取消最大化是**异步**的（Linux 上尤其明显）：平台随后会把「退出这两个状态
   * 该还原到的窗口状态」摆上去，把刚设好的迷你尺寸（还有置顶）覆盖掉 —— 表现是大窗里画着
   * 一条小播放条，或者窗口不再浮在上面。所以这几件事落定之后再补一次。
   */
  window.on('leave-full-screen', reassertWindowState)
  window.on('unmaximize', reassertWindowState)
  /* 从最小化回来（迷你条右上角就有一颗最小化钮，托盘 / 任务栏也能唤回）同样是「状态被摆回」
     的时机之一，一并补。 */
  window.on('restore', reassertWindowState)
  /* 从托盘 / 任务栏重新显示（closeToTray 那条路是 hide→show，不经过 minimize）。
     macOS 上 setVisibleOnAllWorkspaces 也会在隐藏/显示之间被平台摆回，同样要补。 */
  window.on('show', reassertWindowState)

  // ── 位置尺寸记忆（防抖：拖动窗口期间不该狂写盘）────────────────────────
  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    // 迷你期间不记：这份 bounds 是「下次开机的正常窗口」（见 miniActive 的说明）
    if (miniActive) return
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
    // 迷你态下别把迷你尺寸当终值写进去：配置里留着的仍该是正常窗口那一份
    if (!window.isDestroyed() && !miniActive) {
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
