/**
 * 界面路由。
 *
 * 只有十来条路由，用不着引 react-router：一个受 discriminated union 约束的
 * `Route` 比字符串路径更难写错（拼错的 path 在编译期就挂，而不是运行时白屏）。
 *
 * ★ **两面各有各的路由**（`nativeRoute` / `extensionRoute`），不是共用一份。
 *   标题栏以下那一整块有两种形态（见 App 的 Shell）：原生面（侧栏 + 主区 + 抽屉 + 播放条）
 *   与扩展面（扩展主框架）。用户在两面之间来回切时，每一面都该还是他离开时的样子 ——
 *   原生面停在哪个页面、扩展面是在商店还是在某个扩展里。共用一份路由必然二选一：
 *   切过去就等于把另一份覆盖掉，「记住之前的状态」从根上做不到。
 */

import { create } from 'zustand'

export type SettingsSection =
  | 'appearance'
  | 'playback'
  | 'library'
  | 'cache'
  | 'network'
  | 'data'
  | 'account'
  | 'shortcuts'
  | 'about'

/** 标题栏以下那一整块显示哪一面 */
export type Surface = 'native' | 'extensions'

/** 扩展主框架里的两条固定入口 */
export type ExtensionPane = 'store' | 'manage'

/** 扩展那一面的路由：框架右侧内容面显示什么 */
export type ExtensionRoute =
  | { name: 'extensions'; pane: ExtensionPane }
  /**
   * 「某个扩展」那一页：框架不变，只是右侧内容面换成一个 webview。
   *
   * 与上面那条分开而不是合成一条 `{name:'extensions', view: …}`：两者的侧边栏高亮与
   * 语义都不一样，合成一条会让那一堆判断挤在同一个 switch 里。
   */
  | { name: 'plugin'; entryPath: string }

/** 原生那一面（侧栏 + 工具条 + 主区 + 抽屉 + 播放条）的路由 */
export type NativeRoute =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'favorites' }
  | { name: 'recent' }
  | { name: 'search'; keyword: string }
  | { name: 'playlists' }
  | { name: 'playlist'; id: number }
  | { name: 'folders'; path: string }
  | { name: 'settings'; section: SettingsSection }

/** 跳转目标的并集：写进哪一份由它的 `name` 决定（见 navigate） */
export type Route = NativeRoute | ExtensionRoute

/** 这个目标属于扩展那一面吗（navigate 靠它决定写哪份路由、切哪一面） */
export function isExtensionRoute(route: Route): route is ExtensionRoute {
  return route.name === 'extensions' || route.name === 'plugin'
}

export type PanelTab = 'now-playing' | 'queue'

/**
 * 迷你模式里下方那块可展开的面板装什么。
 *
 * ★ 两样**共用同一块地方、同一份高度**（见 main/windows.ts 的 MINI_PANEL_SIZE）：
 *   主进程只关心「开没开」，装的是歌词还是队列由渲染层自己决定（送回主进程的是
 *   MiniModeState.expanded 这个布尔量）—— 于是换内容不会动窗口尺寸，切过去切回来不会跳。
 */
export type MiniPanel = 'lyrics' | 'queue'

interface UiState {
  surface: Surface
  /** 原生那一面停在哪儿。切去扩展面时**不动它** —— 切回来就是离开时的样子 */
  nativeRoute: NativeRoute
  /** 扩展那一面停在哪儿（含「上次在看哪个扩展」）。同一份理由 */
  extensionRoute: ExtensionRoute
  /** 只记原生面的足迹：Alt+← 是「上一页」，不该退回扩展面里去 */
  history: NativeRoute[]
  /** 右侧抽屉是否展开 */
  panelOpen: boolean
  panelTab: PanelTab
  sidebarCollapsed: boolean
  /**
   * 侧栏是被「窗口太窄」自动收起的（见 hooks/useResponsiveSidebar.ts）。
   *
   * 刻意与用户偏好分开存：窗口重新变宽时只该回滚**自动收的那一次**，
   * 而不能把用户手动收起的选择也一起改掉。
   */
  sidebarAutoCollapsed: boolean
  paletteOpen: boolean
  /**
   * 迷你模式：整个界面换成一条小播放条（窗口也跟着缩，见 main/windows.ts）。
   *
   * ★ 界面状态在这儿，**窗口几何在主进程** —— 两边由 App 里一个 effect 对齐。
   *   不把尺寸也塞进这个 store：那是窗口的事，渲染层拍脑袋定一个尺寸只会和真正
   *   生效的那份（MINI_SIZE / MINI_PANEL_SIZE）漂开。
   */
  mini: boolean
  /** 迷你模式里下方那块面板：null = 收起，装歌词还是播放队列见 MiniPanel */
  miniPanel: MiniPanel | null
  /**
   * 进迷你之前记下的正常窗口尺寸。
   *
   * 藏起来的正常界面按这个尺寸钉住，而不是按迷你窗那 400px 重排一次 ——
   * 否则滚动位置会被重新夹一遍、扩展的 webview 也会被缩成一个针眼再弹回来。
   */
  miniRestore: { width: number; height: number } | null
  /** 「加入歌单」对话框的待加入歌曲 id；null = 对话框关闭 */
  addToPlaylistTarget: number[] | null
  /** 播放队列多选的下标集合 */
  selection: number[]
  /** 播放列表选中态锚点（Shift 连选用） */
  selectionAnchor: number | null

  navigate: (route: Route) => void
  /**
   * 只换面，两份路由都不动。
   *
   * 标题栏那两个入口的主点击用它（Songloft / 扩展）——「回到那一面」而不是「回到某一页」，
   * 所以那里必须是这一条而不是 `navigate`。
   */
  showSurface: (surface: Surface) => void
  back: () => void
  setPanelOpen: (open: boolean) => void
  togglePanel: (tab?: PanelTab) => void
  setPanelTab: (tab: PanelTab) => void
  /** 用户偏好（启动回填 / 手动切换），会一并清掉「自动收起」标记 */
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  /** 由布局自动收起 / 展开：只动界面状态，不写设置 */
  setSidebarAutoCollapsed: (collapsed: boolean) => void
  setPaletteOpen: (open: boolean) => void
  setMini: (mini: boolean) => void
  /** 与底栏的 togglePanel 同一套语义：点同一颗就是收起，点另一颗是换内容（不闪、不跳） */
  toggleMiniPanel: (panel: MiniPanel) => void
  setAddToPlaylistTarget: (songIds: number[] | null) => void
  setSelection: (selection: number[], anchor?: number | null) => void
  clearSelection: () => void
}

const MAX_HISTORY = 40

const sameRoute = (a: Route, b: Route): boolean => JSON.stringify(a) === JSON.stringify(b)

export const useUi = create<UiState>((set, get) => ({
  surface: 'native',
  nativeRoute: { name: 'home' },
  extensionRoute: { name: 'extensions', pane: 'store' },
  history: [],
  panelOpen: false,
  panelTab: 'now-playing',
  sidebarCollapsed: false,
  sidebarAutoCollapsed: false,
  paletteOpen: false,
  mini: false,
  miniPanel: null,
  miniRestore: null,
  addToPlaylistTarget: null,
  selection: [],
  selectionAnchor: null,

  navigate: (route) => {
    const state = get()

    if (isExtensionRoute(route)) {
      // 同一条路由重复点（比如连点侧栏的「插件商店」）不该白跑一趟
      if (state.surface === 'extensions' && sameRoute(state.extensionRoute, route)) return
      set({ surface: 'extensions', extensionRoute: route, selection: [], selectionAnchor: null })
      return
    }

    const unchanged = sameRoute(state.nativeRoute, route)
    if (state.surface === 'native' && unchanged) return
    set({
      surface: 'native',
      nativeRoute: route,
      /**
       * 从扩展面点回原生页**不算新的一步**：Alt+← 该退回「原生面自己的上一页」，
       * 而不是被来回切换的两面塞满历史。
       */
      history:
        state.surface === 'native' && !unchanged
          ? [state.nativeRoute, ...state.history].slice(0, MAX_HISTORY)
          : state.history,
      selection: [],
      selectionAnchor: null
    })
  },

  // 只换脸。这就是「切回来还是离开时的样子」的全部实现 —— 没有别的机关
  showSurface: (surface) => {
    if (get().surface === surface) return
    set({ surface })
  },

  back: () => {
    const [prev, ...rest] = get().history
    if (!prev) return
    // 后退只发生在原生面内部，所以顺带切回原生面
    set({
      surface: 'native',
      nativeRoute: prev,
      history: rest,
      selection: [],
      selectionAnchor: null
    })
  },

  setPanelOpen: (open) => set({ panelOpen: open }),

  togglePanel: (tab) =>
    set((state) => {
      if (tab && state.panelOpen && state.panelTab === tab) return { panelOpen: false }
      return { panelOpen: true, panelTab: tab ?? state.panelTab }
    }),

  setPanelTab: (tab) => set({ panelTab: tab, panelOpen: true }),
  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed, sidebarAutoCollapsed: false }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed, sidebarAutoCollapsed: false })),
  setSidebarAutoCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed, sidebarAutoCollapsed: collapsed }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setMini: (mini) =>
    set((state) => ({
      mini,
      /**
       * 进的时候把当前窗口尺寸记下来。此刻主进程还没收到通知（那边是 effect 里发的），
       * 所以读到的就是正常尺寸 —— 迟一步的话读到的就是迷你窗那 400×64 了。
       */
      miniRestore: mini
        ? { width: window.innerWidth, height: window.innerHeight }
        : state.miniRestore
    })),
  toggleMiniPanel: (panel) =>
    set((state) => ({ miniPanel: state.miniPanel === panel ? null : panel })),
  setAddToPlaylistTarget: (songIds) => set({ addToPlaylistTarget: songIds }),
  setSelection: (selection, anchor) =>
    set({ selection, selectionAnchor: anchor === undefined ? null : anchor }),
  clearSelection: () => set({ selection: [], selectionAnchor: null })
}))

/** 把主进程菜单发来的路径字符串映射为 Route（只会是原生面那几条） */
export function routeFromPath(path: string): NativeRoute | null {
  if (path === '/settings' || path.startsWith('/settings/')) {
    const section = path.split('/')[2]
    return {
      name: 'settings',
      section: (
        [
          'appearance',
          'playback',
          'library',
          'cache',
          'network',
          'data',
          'account',
          'shortcuts',
          'about'
        ] as const
      ).includes(section as never)
        ? (section as SettingsSection)
        : 'appearance'
    }
  }
  if (path === '/home') return { name: 'home' }
  if (path === '/library') return { name: 'library' }
  return null
}
