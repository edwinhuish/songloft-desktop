/**
 * 界面路由。
 *
 * 只有十来条路由，用不着引 react-router：一个受 discriminated union 约束的
 * `Route` 比字符串路径更难写错（拼错的 path 在编译期就挂，而不是运行时白屏）。
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

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'favorites' }
  | { name: 'recent' }
  | { name: 'search'; keyword: string }
  | { name: 'playlists' }
  | { name: 'playlist'; id: number }
  | { name: 'folders'; path: string }
  | { name: 'settings'; section: SettingsSection }
  /** 扩展管理：左列已装、右列插件商店。它是独立页而不是设置里的一个分区 ——
   *  装插件是「逛」，与「改配置」不是同一种操作节奏 */
  | { name: 'extensions' }
  /**
   * 扩展页。它**不是**主内容区里的一个页签，而是把标题栏以下整块换成一个 webview ——
   * 见 App 里 `.shell[data-surface='plugin']` 的分支。所以它在 Route 里，但不在
   * renderRoute 的 switch 里。
   */
  | { name: 'plugin'; entryPath: string }

export type PanelTab = 'now-playing' | 'queue'

interface UiState {
  route: Route
  history: Route[]
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
  /** 「加入歌单」对话框的待加入歌曲 id；null = 对话框关闭 */
  addToPlaylistTarget: number[] | null
  /** 播放队列多选的下标集合 */
  selection: number[]
  /** 播放列表选中态锚点（Shift 连选用） */
  selectionAnchor: number | null
  /**
   * 最近一次停留过的**原生**页。
   *
   * 为什么单存一份：扩展之间互跳时，history 里夹着的是另一个插件，`back()` 会回到
   * 那个插件而不是播放页。「再点一次已激活的扩展按钮 = 收起扩展」要的正是回到原生页，
   * 所以必须记住它是哪一个。
   */
  lastNativeRoute: Route
  /**
   * 一条从溢出里**刚被激活**、需要因此提前的扩展（entryPath）。
   *
   * 入口条靠左对齐、装不下的从**右边**裁掉，所以「把被隐藏的那个移进可视范围」只能靠
   * 改变它在条上的位置 —— 把它提到最前。没有视窗可滚，这是唯一能兑现那句要求的做法。
   *
   * 刻意**不写设置**：这是标题栏这条工具栏的临时排布，用户在管理页拖出来的顺序是配置，
   * 两者不能互相污染（写回去的话，用户点一次扩展就会看到自己排的顺序被改了）。
   */
  extensionFront: string | null
  /**
   * 入口条一次完整露得出来几个（由入口条量出实际几何后回写）。
   *
   * 之所以要放进 store：折叠菜单的溢出列表也依赖它 —— 菜单得知道「哪些算被裁掉了」。
   * 两边各自量一遍必然会算出两个不同的答案，于是菜单里列出的和条上藏起来的对不上。
   */
  extensionCapacity: number

  navigate: (route: Route) => void
  setExtensionFront: (entryPath: string | null) => void
  setExtensionCapacity: (capacity: number) => void
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
  setAddToPlaylistTarget: (songIds: number[] | null) => void
  setSelection: (selection: number[], anchor?: number | null) => void
  clearSelection: () => void
}

const MAX_HISTORY = 40

export const useUi = create<UiState>((set, get) => ({
  route: { name: 'home' },
  history: [],
  panelOpen: false,
  panelTab: 'now-playing',
  sidebarCollapsed: false,
  sidebarAutoCollapsed: false,
  paletteOpen: false,
  addToPlaylistTarget: null,
  selection: [],
  selectionAnchor: null,
  lastNativeRoute: { name: 'home' },
  extensionFront: null,
  // 初值只是首帧的占位，真实值由入口条量出来。取 0 会让首帧的溢出菜单列得偏多
  extensionCapacity: 8,

  navigate: (route) => {
    const current = get().route
    // 同一条路由重复点（比如连点侧栏「曲库」）不该往历史里堆垃圾
    if (JSON.stringify(current) === JSON.stringify(route)) return
    set((state) => ({
      route,
      history: [current, ...state.history].slice(0, MAX_HISTORY),
      selection: [],
      selectionAnchor: null,
      // 只记原生页：插件路由记进来，「收起扩展」就会回到另一个插件
      lastNativeRoute: route.name === 'plugin' ? state.lastNativeRoute : route
    }))
  },

  setExtensionFront: (entryPath) => set({ extensionFront: entryPath }),
  // 0 是合法值（一个都放不下时整条都进溢出菜单），但要挡住负数
  setExtensionCapacity: (capacity) => set({ extensionCapacity: Math.max(0, capacity) }),

  back: () => {
    const [prev, ...rest] = get().history
    if (!prev) return
    set({ route: prev, history: rest, selection: [], selectionAnchor: null })
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
  setAddToPlaylistTarget: (songIds) => set({ addToPlaylistTarget: songIds }),
  setSelection: (selection, anchor) =>
    set({ selection, selectionAnchor: anchor === undefined ? null : anchor }),
  clearSelection: () => set({ selection: [], selectionAnchor: null })
}))

/** 把主进程菜单发来的路径字符串映射为 Route */
export function routeFromPath(path: string): Route | null {
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
