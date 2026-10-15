/**
 * 主窗口这一侧：把迷你窗要的状态**推出去**，把它发来的遥控命令**落到真播放器上**。
 *
 * 这是「迷你窗只是另一个窗口，播放只有一个主人」这件事的落点：
 *   · 状态：订阅 usePlayer / usePlaylists / useSettings，变化就推一份快照；
 *   · 命令：收下 MiniCommand，逐条调真播放器上同名的方法。
 *
 * ★ 推送分轻 / 重两半（见 shared/ipc.ts）：
 *   轻的那半跟着播放进度走（timeupdate 每秒四次），所以只有一个几百字节的小包；
 *   重的那半带着队列与歌词（最多 500 首 + 上百行歌词），只在它们真的换了对象时才发。
 *   合在一起发的话，每 250ms 就要序列化一次整份队列 —— 那是纯烧电。
 * ★ 「换了对象」用引用比较就够：playerCore 每次改动都新建数组 / 对象（set({ queue: [...] })），
 *   所以引用没变 = 内容没变。
 * ★ 迷你窗没开时一律不推（只有 onRequest / onOpen 那两条路会强制推一次）。
 */

import type { MiniCommand, MiniPlayerLight, MiniPlayerHeavy, MiniPlayerSnapshot } from '@shared/ipc'
import { resourceContext } from './useAuth'
import { usePlayer } from './usePlayer'
import { usePlaylists } from './usePlaylists'
import { useSettings } from './useSettings'

/** 迷你窗开着没有。没开就什么都不推 —— 每 250ms 一次的结构化克隆不该白跑 */
let miniOpen = false
/** 上一次推出去的重的那半（用来做引用比较，见文件头） */
let lastHeavy: MiniPlayerHeavy | null = null
/** 上一次推出去的轻的那半里、**除 position 之外**那部分的指纹 */
let lastLightKey = ''
/** 上一次推送的时刻（限制「只因为进度变了」那种推送的频率） */
let lastPushAt = 0

/**
 * 只因为播放进度变化时，最快多久推一次（ms）。
 *
 * timeupdate 大约每秒四次，这里比它略快一点，两者基本等价 —— 这个值只是兜底：
 * 将来若有人把播放位置报到更细的节奏上，也别把 IPC 刷成每帧一次。
 */
const POSITION_INTERVAL_MS = 200

function lightOf(): MiniPlayerLight {
  const player = usePlayer.getState()
  const song = player.currentSong()
  return {
    cursor: player.cursor,
    playing: player.playing,
    position: player.currentTime,
    duration: player.duration,
    volume: player.volume,
    muted: player.muted,
    playMode: player.playMode,
    // 收藏表在主窗口这边（迷你窗看不到它），所以由这里查好了递过去
    favorite: song ? usePlaylists.getState().favoriteIds.has(song.id) : false,
    // 强调色同理：它是按封面取出来的（要 canvas + 主进程代取字节），迷你窗算不了
    accent: useSettings.getState().coverAccent
  }
}

function heavyOf(): MiniPlayerHeavy {
  const player = usePlayer.getState()
  return {
    queue: player.queue,
    order: player.order,
    lyrics: player.lyrics,
    lyricsLoading: player.lyricsLoading,
    lyricFailed: player.lyricFailed,
    media: resourceContext()
  }
}

function heavyChanged(next: MiniPlayerHeavy): boolean {
  const prev = lastHeavy
  return (
    !prev ||
    prev.queue !== next.queue ||
    prev.order !== next.order ||
    prev.lyrics !== next.lyrics ||
    prev.lyricsLoading !== next.lyricsLoading ||
    prev.lyricFailed !== next.lyricFailed ||
    prev.media.baseUrl !== next.media.baseUrl ||
    prev.media.accessToken !== next.media.accessToken
  )
}

/** 轻的那半的指纹 —— **不含 position**：它每秒都在变，带上就等于「每次都算变了」 */
function lightKey(light: MiniPlayerLight): string {
  return [
    light.cursor,
    light.playing,
    light.duration,
    light.volume,
    light.muted,
    light.playMode,
    light.favorite,
    light.accent ?? ''
  ].join('|')
}

/**
 * 推一份快照。
 *
 * ★ 重的那半有变化时，它与轻的那半**装在同一个包里**发出去 —— 顺序天然有保证。
 *   分成两条消息的话，迷你窗可能先拿到新游标、再拿到旧队列，中间那一帧取到的是别的歌。
 */
function push(force = false): void {
  if (!miniOpen && !force) return

  const heavy = heavyOf()
  const light = lightOf()
  const heavyDirty = heavyChanged(heavy)
  const key = lightKey(light)
  const now = Date.now()

  if (!force && !heavyDirty && key === lastLightKey && now - lastPushAt < POSITION_INTERVAL_MS) {
    return
  }

  lastHeavy = heavy
  lastLightKey = key
  lastPushAt = now

  const snapshot: MiniPlayerSnapshot = { light, heavy }
  void window.songloft.mini.push(snapshot)
}

/** 迷你窗发来的遥控命令 → 真播放器上同名的方法 */
function applyCommand(command: MiniCommand): void {
  const player = usePlayer.getState()

  switch (command.kind) {
    case 'toggle':
      void player.toggle()
      break
    case 'pause':
      player.pause()
      break
    case 'next':
      void player.next(command.auto)
      break
    case 'previous':
      void player.previous()
      break
    case 'seek':
      player.seek(command.seconds)
      break
    case 'seek-by':
      player.seekBy(command.delta)
      break
    case 'set-volume':
      player.setVolume(command.volume)
      break
    case 'flush-volume':
      player.flushVolume()
      break
    case 'toggle-mute':
      player.toggleMute()
      break
    case 'cycle-play-mode':
      player.cyclePlayMode()
      break
    case 'set-play-mode':
      player.setPlayMode(command.mode)
      break
    /*
     * 收藏不是播放器上的动作（收藏表在 usePlaylists 里），所以这里自己取当前曲目 ——
     * 与托盘 / 媒体键那条路（App.tsx 的 handleMediaCommand）同一套写法：
     * 命令只带「做什么」，带哪首歌由主窗口当场决定（迷你窗那份队列可能是几十毫秒前的）。
     */
    case 'toggle-favorite': {
      const song = player.currentSong()
      if (song) void usePlaylists.getState().toggleFavorite(song)
      break
    }
    case 'jump-to':
      void player.jumpTo(command.index)
      break
    case 'remove-from-queue':
      player.removeFromQueue(command.indexes)
      break
    case 'move-in-queue':
      player.moveInQueue(command.from, command.to)
      break
    case 'clear-queue':
      player.clearQueue()
      break
    case 'reload-lyrics':
      void player.reloadLyrics()
      break
  }
}

/**
 * 挂上这个窗口这一侧的接线。App 启动时调一次（与全局快捷键那几条同一个地方）。
 *
 * 三个订阅都**不**经过 React：推送的次数由播放进度决定（每秒数次），走组件重渲染的话
 * 整棵界面树都要跟着算一遍 —— 与 ContextMenu 那条 dataset 的说明是同一个理由。
 */
export function installMiniHost(): () => void {
  let disposed = false

  /*
   * ★ 装的时候先**主动问一句**「迷你窗此刻开着没有」（IPC.miniIsOpen）。
   *
   * onOpen 只在开合的那一刻响一次，而这段接线可能比那个窗口晚到：dev 里的 HMR 重新挂载、
   * 渲染层刷新（Ctrl+R）或崩溃重载都会把它整份重装一遍 —— 那时迷你窗还开着，却再没有任何
   * 事件会告诉新装上的这一份。不问的话它会一直以为「没开」，而那个布尔量正是推送的闸门，
   * 于是迷你窗冻在重载前的那一帧上（还显示着，就是不动了）。
   * ★ disposed 那道判断是必要的：问回来的路上这份接线可能已经被拆掉了，那时不该再写模块状态。
   */
  void window.songloft.mini.isOpen().then((open) => {
    if (disposed) return
    miniOpen = open
    if (open) push(true)
  })

  const disposers = [
    window.songloft.mini.onOpen((open) => {
      miniOpen = open
      // 刚开：立刻推一份（迷你窗挂好之后还会主动要一次，见 onRequest；这一条只是兜底）
      if (open) push(true)
    }),
    window.songloft.mini.onRequest(() => push(true)),
    window.songloft.mini.onCommand(applyCommand),
    usePlayer.subscribe(() => push()),
    /* 收藏与强调色都不在播放器里：改它们的人不必动播放器状态，所以各订阅各的 */
    usePlaylists.subscribe((state, prev) => {
      if (state.favoriteIds !== prev.favoriteIds) push()
    }),
    useSettings.subscribe((state, prev) => {
      if (state.coverAccent !== prev.coverAccent) push()
    })
  ]

  return () => {
    disposed = true
    for (const dispose of disposers) dispose()
    miniOpen = false
    lastHeavy = null
    lastLightKey = ''
  }
}
