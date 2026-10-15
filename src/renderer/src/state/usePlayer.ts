/**
 * 播放器 store 的**分流器**：同一个名字，在不同窗口里指向不同的东西。
 *
 * 「谁是宿主」只有一个判据 —— 窗口角色（见 lib/window-role.ts、@shared/window-role）：
 *
 *   · 宿主窗口（**主窗口**、以及本地文件会话里的**迷你宿主窗**）
 *       → state/player-core.ts 里那个真的播放器（音频、队列、歌词都在它手里）；
 *   · 跟随者（普通的**迷你窗**）
 *       → state/remotePlayer.ts 里那份**镜像**（宿主推来什么就显示什么，界面上的动作
 *         变成遥控命令发过去）。
 *
 * ★ 为什么按「窗口角色」而不是按「是不是主窗口」分：播放的核心**与窗口形态无关** ——
 *   双击一个音频文件起的那一趟里根本没有主窗口，迷你窗就是播放器（见 AGENTS.md 的
 *   「本地文件会话」）。核心（player-core）因此不读任何窗口相关的东西，谁当宿主谁 import 它。
 *
 * ★ 为什么要分而不是各写一份界面：Queue / LyricsView 这些组件读的就是 `usePlayer`，
 *   两边共用同一份组件、同一份行为（拖拽排序、歌词跟随、点行跳转）才是我们想要的 ——
 *   分出去的那一份迟早只有一处还记得某个细节。分流放在 store 这一层，组件不必知道
 *   自己跑在哪个窗口里。
 *
 * ★ 分流是**模块加载时**定的，不是运行期可切的：一个渲染进程的角色由 URL 的 hash 定死
 *   （见 lib/window-role.ts），终身不换。
 *
 * ★ 在跟随者那一边，player-core 这个模块**仍会被求值**（静态 import）：它会建一个不用的
 *   <audio>、挂几个监听 —— 都不会出声（那个 store 在那一边没有任何人写它）。换来的是
 *   「所有 `import { usePlayer }` 的地方一个字都不用改」。
 */

import type { StoreApi, UseBoundStore } from 'zustand'

import { windowRole } from '@/lib/window-role'
import {
  audioElement,
  installMediaSessionHandlers,
  installNowPlayingSync,
  playerCore,
  primeAudio,
  type PlayerState
} from './player-core'
import { remotePlayer } from './remotePlayer'

export type { PlayerState }

/** 这个窗口是不是**播放器所在的那个窗口**（宿主）。迷你宿主窗用它决定要装哪一套接线 */
export const isPlayerHost = windowRole() !== 'mini'

/** 当前窗口的那一份（宿主 = 真播放器，跟随者 = 镜像） */
export const usePlayer: UseBoundStore<StoreApi<PlayerState>> = isPlayerHost
  ? playerCore
  : remotePlayer

/* 下面这几个只在宿主窗口里被调用（主窗口是 App 的启动编排，迷你宿主窗是 state/local-session）。
   在跟随者那边没人调它们，但仍然从这里转出去，好让「进口唯一」这件事在各窗口都成立。 */
export { audioElement, installMediaSessionHandlers, installNowPlayingSync, primeAudio }
