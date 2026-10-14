/**
 * 迷你窗自己那几个界面量（**只在迷你窗里用**）。
 *
 * 为什么不复用 useUi：那一份是主窗口的路由与抽屉（nativeRoute / panelOpen / fullPlayer…），
 * 两个窗口各有一份，混着用只会让「这一项到底是谁的状态」变得含糊。这里只放迷你窗独有的几件：
 *
 *   favorite    当前曲目收没收藏 —— 收藏表在主窗口那边（usePlaylists），这里是**镜像**，
 *               由播放状态快照喂进来（见 state/remotePlayer.ts）
 *   panel       下方那块面板装什么（null = 收起），与主窗口抽屉的 PanelTab 同一套语义
 *   panelHeight 面板高度，由底部那根把手拖着改；松手时落盘到 settings.miniPanelHeight
 *   menuHeight  不透明度菜单要占的高度（关着时 0）—— 由菜单自己量（MiniPlayer 那条 effect），
 *               窗口按它加高，菜单才画得进条下方那块透明容器里
 *
 * 这几样放在这里而不是 MiniPlayer 的 useState：窗口高度由主进程算，而它要读这几样
 * （见 MiniApp 里那条上报 effect）—— 状态留在组件里的话，主进程就得反过来问组件。
 */

import { create } from 'zustand'

import { MINI_PANEL_DEFAULT_HEIGHT, type MiniPanel } from '@shared/ipc'

interface MiniViewState {
  favorite: boolean
  panel: MiniPanel | null
  panelHeight: number
  menuHeight: number
  setFavorite: (favorite: boolean) => void
  /** 与底栏抽屉的 togglePanel 同一套语义：点同一颗就是收起，点另一颗是换内容 */
  togglePanel: (panel: MiniPanel) => void
  setPanelHeight: (height: number) => void
  setMenuHeight: (height: number) => void
}

export const useMiniView = create<MiniViewState>((set) => ({
  favorite: false,
  // 默认收起：进迷你窗的人多半只是要挂一条播放条，歌词/队列要了再点
  panel: null,
  panelHeight: MINI_PANEL_DEFAULT_HEIGHT,
  menuHeight: 0,

  setFavorite: (favorite) => set({ favorite }),
  togglePanel: (panel) => set((state) => ({ panel: state.panel === panel ? null : panel })),
  setPanelHeight: (panelHeight) => set({ panelHeight }),
  setMenuHeight: (menuHeight) => set({ menuHeight })
}))
