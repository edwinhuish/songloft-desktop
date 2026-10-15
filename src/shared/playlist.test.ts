/**
 * 歌单顺序的单测。
 *
 * 为什么值得单独测：这两条规则的错误症状都是「顺序偶尔不对」——刷新一次就变、或者某个
 * 歌单莫名跳位，在界面上既不明显也不可复现，而它们本身只是两条很朴素的规则：
 *   1. 置顶优先，但**不能**打乱其余项的顺序（靠 sort 的稳定性，很容易被「顺手加个比较键」写坏）；
 *   2. 重排只动列出来的那些，其余项保持原槽位（与服务端的部分重排口径一致）。
 */

import { describe, expect, it } from 'vitest'

import { applyPlaylistOrder, sortPinnedFirst } from './playlist'
import type { Playlist } from './types'

function playlist(id: number, extra: Partial<Playlist> = {}): Playlist {
  return {
    id,
    type: 'normal',
    name: `歌单 ${id}`,
    description: null,
    cover_url: null,
    labels: [],
    sort_by: 'position',
    sort_order: 'asc',
    song_count: 0,
    remote_count: 0,
    pinned_at: null,
    created_at: '',
    updated_at: '',
    ...extra
  }
}

const ids = (playlists: Playlist[]): number[] => playlists.map((p) => p.id)

describe('sortPinnedFirst', () => {
  it('置顶的排到最前，其余保持原顺序', () => {
    const list = [playlist(1), playlist(2), playlist(3, { pinned_at: '2026-01-01' })]
    expect(ids(sortPinnedFirst(list))).toEqual([3, 1, 2])
  })

  it('多个置顶项之间也不重排（稳定性）', () => {
    const list = [
      playlist(1, { pinned_at: '2026-02-02' }),
      playlist(2),
      playlist(3, { pinned_at: '2026-01-01' })
    ]
    expect(ids(sortPinnedFirst(list))).toEqual([1, 3, 2])
  })

  it('不改入参', () => {
    const list = [playlist(1), playlist(2, { pinned_at: '2026-01-01' })]
    sortPinnedFirst(list)
    expect(ids(list)).toEqual([1, 2])
  })
})

describe('applyPlaylistOrder', () => {
  it('按给定顺序重排', () => {
    const list = [playlist(1), playlist(2), playlist(3)]
    expect(ids(applyPlaylistOrder(list, [3, 1, 2]))).toEqual([3, 1, 2])
  })

  it('未列入的项保持原槽位（与服务端的部分重排一致）', () => {
    // 1、2 是内置收藏那种「不在侧栏里」的项：它们不动，被列的项填进剩下的槽位
    const list = [playlist(1), playlist(2), playlist(3), playlist(4), playlist(5)]
    expect(ids(applyPlaylistOrder(list, [5, 3, 4]))).toEqual([1, 2, 5, 3, 4])
  })

  it('id 已不存在时跳过，不占槽位', () => {
    const list = [playlist(1), playlist(2)]
    expect(ids(applyPlaylistOrder(list, [99, 2, 1]))).toEqual([2, 1])
  })
})
