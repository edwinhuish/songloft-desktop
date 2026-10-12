/**
 * 后端响应的「补齐」逻辑的单测。
 *
 * 起因是一个真实崩溃：`Sidebar.tsx` 里 `p.labels.includes('built_in')` 抛
 * `Cannot read properties of null (reading 'includes')`。根因不在 Sidebar ——
 * Go 的 encoding/json 会把 **nil slice 序列化成 `null`**，而类型上写的是
 * `string[]`，类型在撒谎，所以没有任何调用方会去防御。
 */

import { describe, expect, it } from 'vitest'

import { normalizePlaylist, type Playlist } from './types'

/** 只填被测字段：这里要故意造出「类型说是 string[]、运行时是 null」的非法输入 */
function raw(labels: unknown): Playlist {
  return { id: 1, name: '测试歌单', labels } as Playlist
}

describe('normalizePlaylist', () => {
  it('labels 为 null 时补成空数组', () => {
    expect(normalizePlaylist(raw(null)).labels).toEqual([])
  })

  it('labels 缺失时同样补成空数组', () => {
    expect(normalizePlaylist(raw(undefined)).labels).toEqual([])
  })

  it('已有的 labels 原样保留', () => {
    expect(normalizePlaylist(raw(['built_in'])).labels).toEqual(['built_in'])
  })

  it('不改动其它字段', () => {
    expect(normalizePlaylist(raw(null)).id).toBe(1)
    expect(normalizePlaylist(raw(null)).name).toBe('测试歌单')
  })
})
