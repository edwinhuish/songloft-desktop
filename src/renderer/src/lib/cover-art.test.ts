/**
 * 默认封面配色的单测。
 *
 * 这些性质出错的表现都很「软」：颜色每次重渲染都在变（列表像在闪），或者几十条
 * 全是同一个色（等于没做区分）—— 肉眼看得见但不一定说得清，不如用用例钉住。
 */

import { describe, expect, it } from 'vitest'

import { COVER_KINDS, coverArt, type CoverKind } from './cover-art'

describe('coverArt', () => {
  it('同一个名字 + 同一个类型 → 永远同一张脸', () => {
    const a = coverArt('Abbey Road', 'song')
    const b = coverArt('Abbey Road', 'song')
    expect(a).toEqual(b)
  })

  it('只差大小写/首尾空格的名字视为同一条', () => {
    expect(coverArt('ABBEY ROAD', 'song')).toEqual(coverArt('  abbey road ', 'song'))
  })

  it('同名但类型不同 → 不该撞成同一张', () => {
    const song = coverArt('新歌单', 'song')
    const playlist = coverArt('新歌单', 'playlist')
    const artist = coverArt('新歌单', 'artist')
    expect([song.h, playlist.h, artist.h]).not.toEqual([song.h, song.h, song.h])
  })

  it('颜色够散：60 个名字里至少出现 8 种不同色相', () => {
    const hues = new Set(Array.from({ length: 60 }, (_, i) => coverArt(`歌单 ${i}`, 'playlist').h))
    // 备选色相一共 12 档，取太严会在「哈希分布略偏」时假红，取 8 是留了余量的下限
    expect(hues.size).toBeGreaterThanOrEqual(8)
  })

  it('色相取的是挑过的那一批：不出现在黄绿带（60~140）之外的地方', () => {
    for (const kind of COVER_KINDS) {
      for (let i = 0; i < 50; i += 1) {
        const { h } = coverArt(`sample-${i}`, kind)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThan(360)
        expect(h >= 60 && h <= 140).toBe(false)
      }
    }
  })

  it('两个色相是邻近色：偏转落在 24~79 度之间', () => {
    for (let i = 0; i < 50; i += 1) {
      const { h, h2 } = coverArt(`x-${i}`, 'artist')
      const delta = (h2 - h + 360) % 360
      expect(delta).toBeGreaterThanOrEqual(24)
      expect(delta).toBeLessThanOrEqual(79)
    }
  })

  it('角度与形状变体都在设计好的区间里', () => {
    for (let i = 0; i < 50; i += 1) {
      const art = coverArt(`y-${i}`, 'song')
      expect(art.angle).toBeGreaterThanOrEqual(100)
      expect(art.angle).toBeLessThan(180)
      expect([0, 1, 2]).toContain(art.variant)
      expect(art.rand.length).toBeGreaterThanOrEqual(10)
      for (const value of art.rand) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
      }
    }
  })

  it('空名字也不报错（没标签的歌就该有一张图）', () => {
    const art = coverArt('', 'song')
    expect(Number.isFinite(art.h)).toBe(true)
    expect(art.rand.length).toBeGreaterThan(0)
  })

  it('三个类型都覆盖到了', () => {
    const kinds: CoverKind[] = COVER_KINDS
    expect(kinds).toEqual(['song', 'playlist', 'artist'])
  })
})
