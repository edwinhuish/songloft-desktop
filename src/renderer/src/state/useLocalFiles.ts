/**
 * 本地文件（双击打开 / 菜单挑的那些）的**收件箱**。
 *
 * 一份职责：把主进程交出来的**路径**变成播放器认得的歌，并且记住这次会话里打开过哪些。
 *
 * ★ 为什么要有这么一层，而不是各处自己 `playSongs([songFromLocalFile(path)])`：
 *   路径有三个来源（双击关联、二次启动、菜单/页面上的「打开文件」），而它们**到达的时刻**
 *   很随意 —— 可能早于界面就绪。统一收在这里，加上主进程那边的排队（见 main/local-files.ts），
 *   「早到晚到都只处理一次」这件事就只有一处实现。
 *
 * ★ 播放本地文件**不需要登录**：`guest` 那一位在这里只负责「把人放进主界面」，播放本身
 *   从头到尾不问登录状态（见 useAuth 的说明）。
 *
 * ★ 双入口：这条线在**两个窗口**里都装（主窗口的免登录模式，以及本地文件会话里的迷你宿主窗
 *   —— 双击关联文件起的那一趟里没有主窗口，见 main/index.ts）。两处装的是同一份实现，
 *   取走即清的语义也因此只有一处。
 */

import { create } from 'zustand'

import { songFromLocalFile } from '@shared/local-file'
import type { Song } from '@shared/types'
import { isMiniWindow } from '@/lib/window-role'
import { useAuth } from './useAuth'
import { usePlayer } from './usePlayer'
import { useUi } from './useUi'

/**
 * 播放上下文（面板上那个「来自本地文件」的徽标读它）。
 *
 * 不用英文标识符是因为它会**直接显示出来**（见 Panel 的 NowPlaying），而这里没有第二个
 * 消费方需要拿它做判断。
 */
const LOCAL_CONTEXT = { type: '本地文件', key: 'local' }

interface LocalFilesState {
  /** 这次会话里打开过的本地文件（按打开顺序，已去重） */
  songs: Song[]
  /** 收下一批路径；返回其中**新收下的**那些（已经在列表里的不算） */
  add: (paths: readonly string[]) => Song[]
  /** 从列表里去掉（不影响已经排进播放队列的那一份） */
  remove: (paths: readonly string[]) => void
  clear: () => void
}

export const useLocalFiles = create<LocalFilesState>((set, get) => ({
  songs: [],

  add: (paths) => {
    const known = new Set(get().songs.map((song) => song.file_path))
    const fresh = paths.filter((path) => !known.has(path)).map(songFromLocalFile)
    if (fresh.length > 0) set((state) => ({ songs: [...state.songs, ...fresh] }))
    return fresh
  },

  remove: (paths) => {
    const drop = new Set(paths)
    set((state) => ({ songs: state.songs.filter((song) => !drop.has(song.file_path ?? '')) }))
  },

  clear: () => set({ songs: [] })
}))

/** 列表里第 index 首开始播（「本地文件」页的行双击与「播放全部」都走它） */
export function playLocalFileAt(index: number): void {
  const songs = useLocalFiles.getState().songs
  if (songs.length === 0) return
  const start = Math.min(Math.max(0, index), songs.length - 1)
  void usePlayer.getState().playSongs(songs, start, LOCAL_CONTEXT)
}

/**
 * 把一批路径交给播放器：收进列表，然后**从这批里的第一首开始**播。
 *
 * 队列取整个列表（而不是只有这次带来的这几首）：列表就是「我打开过的本地文件」，
 * 双击第 3 首时还能往下接着放 —— 这也是用户对一张播放列表的预期。
 */
export function playLocalFiles(paths: readonly string[]): void {
  if (paths.length === 0) return
  useLocalFiles.getState().add(paths)
  const songs = useLocalFiles.getState().songs
  const at = songs.findIndex((song) => song.file_path === paths[0])
  playLocalFileAt(at < 0 ? 0 : at)
}

/**
 * 还没登录就顺手把人放进来。
 *
 * 双击一个音频文件时，用户要的是「听这首歌」—— 拦在登录页上什么都做不了（曲库确实得有
 * 会话，本地文件不需要）。所以这里替他进免登录模式，并把界面切到「本地文件」那一页：
 * 双结果都摆在眼前，「我刚打开的那首歌」和「还能放别的什么」。
 *
 * ★ 已经登录（或已经在免登录模式里）就什么都不做：此刻用户多半正看着别的页面，
 *   为一个后台到达的文件把他拽走是打扰。
 *
 * ★ 迷你宿主窗（本地文件会话）里这两件事都无处可做：它没有页面（那是主窗口的路由），也没有
 *   会话与登录页 —— 那一趟要的只是「打开就出声」，所以直接让开（见 @shared/window-role）。
 */
function enterGuestIfNeeded(): void {
  if (isMiniWindow()) return
  const auth = useAuth.getState()
  if (auth.status === 'authenticated' || auth.guest) return
  auth.enterGuest()
  useUi.getState().navigate({ name: 'local' })
}

/** 收件箱的入口：一切「要放这些本地文件」都从这里进 */
export function openLocalFiles(paths: readonly string[]): void {
  if (paths.length === 0) return
  enterGuestIfNeeded()
  playLocalFiles(paths)
}

/** 「打开文件」：弹系统文件框，挑中的直接开播（取消就什么也不发生） */
export async function pickLocalFiles(): Promise<void> {
  const paths = await window.songloft.localFiles.open()
  openLocalFiles(paths)
}

/**
 * 装上收件线。App 启动时调一次（与 installMiniHost 那几条同一个位置）。
 *
 * 两件事：**开机取一次**（双击关联启动 / 命令行带文件进来的那批，主进程已经替我们排好队），
 * 以及**每次收到摇铃再取一次**。摇铃本身不带路径 —— 它是「来取一下」的信号，而不是那批
 * 文件本身；这样「早到晚到都只处理一次」不必依赖「渲染层是否已经装好监听」（见 IPC 里的说明）。
 */
export function installLocalFileIntake(): () => void {
  const dispose = window.songloft.localFiles.onPending(() => void drain())
  void drain()
  return dispose
}

async function drain(): Promise<void> {
  try {
    openLocalFiles(await window.songloft.localFiles.takePending())
  } catch {
    // 主进程这条路没接上（不该发生）：不弹错 —— 用户手点「打开文件」照样能用，
    // 而开机时冒一条红字只会让人以为应用坏了
  }
}
