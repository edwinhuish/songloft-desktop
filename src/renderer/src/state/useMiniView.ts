/**
 * 迷你窗自己那几个界面量（**只在迷你窗里用**）。
 *
 * 为什么不复用 useUi：那一份是主窗口的路由与抽屉（nativeRoute / panelOpen / fullPlayer…），
 * 两个窗口各有一份，混着用只会让「这一项到底是谁的状态」变得含糊。这里只放迷你窗独有的几件：
 *
 *   favorite    当前曲目收没收藏 —— 收藏表在主窗口那边（usePlaylists），这里是**镜像**，
 *               由播放状态快照喂进来（见 state/remotePlayer.ts）
 *   panel       下方那块面板装什么（null = 收起），与主窗口抽屉的 PanelTab 同一套语义
 *   heights     两块面板**各自**的高度（歌词一份、队列一份），由底部那根把手拖着改；
 *               松手时落盘到 settings.miniLyricsPanelHeight / miniQueuePanelHeight
 *
 * ★ 高度为什么要按面板存两份：这两块是「同一个位置上的两种内容」，用户对它们的期待本来就不同
 *   （歌词看几句就够、队列常要多看几首）。共用一份的话，拖高歌词再切去队列，队列也跟着变——
 *   那就等于「拖着玩玩」，不成立。两块各记一份之后，切来切去各自还是离开时的样子。
 *
 * 这几样放在这里而不是 MiniPlayer 的 useState：窗口高度由主进程算，而它要读这几样
 * （见 MiniApp 里那条上报 effect）—— 状态留在组件里的话，主进程就得反过来问组件。
 *
 * ★ 菜单开合**不在这里**：那一份是共享的 ContextMenu（useContextMenu.open），主进程要的
 *   「有没有菜单开着」直接读它，不必在迷你窗这份状态里再存一遍。
 */

import { create } from 'zustand'

import { MINI_PANEL_DEFAULT_HEIGHT, type MiniPanel } from '@shared/ipc'

export interface MiniViewState {
  favorite: boolean
  panel: MiniPanel | null
  /** 两块面板各自的高度（px）：拖谁改谁，切来切去各自记住自己那一份 */
  heights: Record<MiniPanel, number>
  setFavorite: (favorite: boolean) => void
  /** 与底栏抽屉的 togglePanel 同一套语义：点同一颗就是收起，点另一颗是换内容 */
  togglePanel: (panel: MiniPanel) => void
  /** 拖把手：改的是**当前那一块**的高度（见 MiniPlayer 底部那根把手） */
  setPanelHeight: (height: number) => void
  /** 读设置时把两份高度一次铺进来（MiniApp 在 ready 之前调一次） */
  applyHeights: (heights: Record<MiniPanel, number>) => void
}

/** 两块面板的默认高度（与 shared/ipc.ts 那一条同一个数：没拖过时两块一样高） */
const DEFAULT_HEIGHTS: Record<MiniPanel, number> = {
  lyrics: MINI_PANEL_DEFAULT_HEIGHT,
  queue: MINI_PANEL_DEFAULT_HEIGHT
}

export const useMiniView = create<MiniViewState>((set) => ({
  favorite: false,
  // 默认收起：进迷你窗的人多半只是要挂一条播放条，歌词/队列要了再点
  panel: null,
  heights: DEFAULT_HEIGHTS,

  setFavorite: (favorite) => set({ favorite }),
  togglePanel: (panel) => set((state) => ({ panel: state.panel === panel ? null : panel })),
  /*
   * 面板收起时（panel 为 null）落到歌词那一份上：那根把手只在面板展开时才渲染，所以这条
   * 兜底正常走不到 —— 兜的是「将来谁在收起状态下调它」这种情况，别让它写出 undefined。
   */
  setPanelHeight: (height) =>
    set((state) => ({
      heights: { ...state.heights, [state.panel ?? 'lyrics']: height }
    })),
  applyHeights: (heights) => set({ heights: { ...heights } })
}))

/**
 * 此刻生效的那一份高度（面板收起时给歌词那一份 —— 没有面板用它，取哪一份都无所谓）。
 *
 * ★ 高度分成两份存之后，组件不再直接读「一个数」：一律走这里取「**眼下这一块**多高」。
 *   只有这样，切面板时窗口高度、行内高度、拖拽基准三处才会同时跟着换 —— 各自读一份的话，
 *   迟早有一处忘了换（表现是「切到队列后窗口是队列的高度，拖拽却从歌词的高度算起」）。
 */
export const selectPanelHeight = (state: MiniViewState): number =>
  state.heights[state.panel ?? 'lyrics']
