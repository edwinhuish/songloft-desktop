/**
 * 歌单**顺序**的纯函数 —— 这份口径只留一处。
 *
 * 顺序其实有两层，容易混：
 *   * 服务端给的是 `position`（客户端类型里看不到这个字段，只能靠数组顺序隐式表达）；
 *   * 客户端在这之上再压一层「置顶优先」。
 *
 * 侧栏、标题栏折叠菜单、歌单页读的都是同一份 `usePlaylists.playlists`，所以排序与重排
 * 都收在这里 —— 各页面各写一遍的话，某一天「拖出来的顺序」与「刷新回来的顺序」就会
 * 对不上，而那种差异极难归因到一个排序函数上。
 */

import type { Playlist } from './types'

/**
 * 置顶项排到最前，其余保持原顺序。
 *
 * ★ 靠 `Array.prototype.sort` 的**稳定性**（ES2019 起所有实现都保证）：比较函数只在
 *   「一个置顶、一个不置顶」时给结论，同侧的一律返回 0 —— 于是服务端给的 position 顺序
 *   原样保留。换成「先按 pinned_at 再按 id 排」之类的写法就会把服务端的顺序抹掉。
 *
 * 返回新数组、不改入参：它要当 React 的派生值用（`load` 之后直接 set 进 store）。
 */
export function sortPinnedFirst(playlists: Playlist[]): Playlist[] {
  return [...playlists].sort((a, b) => {
    if (Boolean(a.pinned_at) === Boolean(b.pinned_at)) return 0
    return a.pinned_at ? -1 : 1
  })
}

/**
 * 按给定 id 序列重排：**未列入的项保持原来的槽位**。
 *
 * ★ 「保持槽位」不是随手定的，它和服务端 `PUT /playlists/reorder` 的语义一致
 *   （未纳入的歌单不动，见 songloft#266）：侧栏只列「我的歌单」，隐藏歌单与两个内置收藏
 *   不在里面。客户端按同一口径算，本地先渲染出来的那份才和服务端存下的一致；
 *   「没列入的统统挪到末尾」那种写法会让内置收藏的位置跟着跳。
 *
 * 传进来的 id 也可能已经不存在了（列表是启动时拉的），取不到就跳过，不占槽位。
 */
export function applyPlaylistOrder(playlists: Playlist[], ids: number[]): Playlist[] {
  const byId = new Map(playlists.map((playlist) => [playlist.id, playlist]))
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((playlist): playlist is Playlist => Boolean(playlist))
  const moving = new Set(ordered.map((playlist) => playlist.id))
  let cursor = 0
  return playlists.map((playlist) => (moving.has(playlist.id) ? ordered[cursor++] : playlist))
}
