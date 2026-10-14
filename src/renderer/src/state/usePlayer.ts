/**
 * 播放器 store 的**分流器**：同一个名字，在两个窗口里指向不同的东西。
 *
 *   · 主窗口 → state/localPlayer.ts 里那个真的播放器（音频、队列、歌词都在它手里）；
 *   · 迷你窗 → state/remotePlayer.ts 里那份**镜像**（主窗口推来什么就显示什么，
 *              界面上的动作变成遥控命令发过去）。
 *
 * ★ 为什么要分而不是各写一份界面：Queue / LyricsView 这些组件读的就是 `usePlayer`，
 *   两边共用同一份组件、同一份行为（拖拽排序、歌词跟随、点行跳转）才是我们想要的 ——
 *   分出去的那一份迟早只有一处还记得某个细节。分流放在 store 这一层，组件不必知道
 *   自己跑在哪个窗口里。
 *
 * ★ 分流是**模块加载时**定的，不是运行期可切的：一个渲染进程要么是主窗口、要么是迷你窗，
 *   判据是 URL 的 hash（见 lib/mini-window.ts）。
 *
 * ★ 在迷你窗里，localPlayer 这个模块**仍会被求值**（静态 import）：它会建一个不用的
 *   <audio>、挂几个监听 —— 都不会出声（那个 store 在迷你窗里没有任何人写它）。
 *   换来的是「所有 `import { usePlayer }` 的地方一个字都不用改」。
 */

import type { StoreApi, UseBoundStore } from 'zustand'

import { isMiniWindow } from '@/lib/mini-window'
import {
  audioElement,
  installMediaSessionHandlers,
  installNowPlayingSync,
  localPlayer,
  primeAudio,
  type PlayerState
} from './localPlayer'
import { remotePlayer } from './remotePlayer'

export type { PlayerState }

/** 当前窗口的那一份（主窗口 = 真播放器，迷你窗 = 镜像） */
export const usePlayer: UseBoundStore<StoreApi<PlayerState>> = isMiniWindow()
  ? remotePlayer
  : localPlayer

/* 下面这几个只在主窗口里被调用（见 App.tsx 的启动编排）；在迷你窗里没人调它们，
   但仍然从这里转出去，好让「进口唯一」这件事在两边都成立。 */
export { audioElement, installMediaSessionHandlers, installNowPlayingSync, primeAudio }
