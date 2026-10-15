/**
 * 托盘菜单 / 全局媒体键发来的播放命令。
 *
 * ★ 为什么单独一个模块：**两个窗口都可能是宿主**（主窗口、或本地文件会话里的迷你宿主窗，
 *   见 state/usePlayer 的分流），而主进程那边只有一条推法（IPC.onMediaCommand）。命令由
 *   主进程送给**当宿主的那一个窗口**（见 main/index.ts 的 sendToHost），落到哪个 store 上
 *   则由 state/usePlayer 的分流决定 —— 于是「托盘里按一下暂停」在两个宿主里走的是同一份
 *   代码，不会出现「本地会话里托盘点了没反应」那种静默空洞。
 *
 * ★ 「显示 / 收起歌词」这一条落在哪儿各窗不同：主窗口是右侧那只抽屉，迷你宿主窗是它下方
 *   那块歌词面板（它没有抽屉）。所以这一条由调用方给一个钩子，而不是在这里 import 某一份
 *   界面状态 —— 那会让播放器的接线反过来依赖某个窗口的界面。
 *
 * ★ 收藏这一条不以窗口为转移：它的判断在 usePlaylists 里（本地文件 id 为负，那里直接让开，
 *   见 setFavorite），所以两个窗口共用同一句调用是安全的。
 */

import type { MediaCommand } from '@shared/ipc'
import { usePlayer } from './usePlayer'
import { usePlaylists } from './usePlaylists'

export interface MediaCommandHooks {
  /** 「显示 / 收起歌词」：主窗口切抽屉，迷你宿主窗切歌词面板 */
  toggleLyrics: () => void
}

/** 把一条命令落到当前窗口的播放器上。装订阅与直接调用都是它 */
export function applyMediaCommand(command: MediaCommand, hooks: MediaCommandHooks): void {
  const player = usePlayer.getState()

  switch (command.kind) {
    case 'play-pause':
      void player.toggle()
      break
    case 'next':
      void player.next(false)
      break
    case 'previous':
      void player.previous()
      break
    case 'seek':
      player.seekBy(command.delta)
      break
    case 'volume':
      player.setVolume(Math.max(0, Math.min(1, player.volume + command.delta)))
      break
    case 'toggle-mute':
      player.toggleMute()
      break
    case 'toggle-favorite': {
      const song = player.currentSong()
      if (song) void usePlaylists.getState().toggleFavorite(song)
      break
    }
    case 'toggle-lyrics':
      hooks.toggleLyrics()
      break
  }
}

/** 装上订阅。宿主窗口在启动编排里调一次，返回值是取消订阅 */
export function installMediaCommands(hooks: MediaCommandHooks): () => void {
  return window.songloft.on.mediaCommand((command) => applyMediaCommand(command, hooks))
}
