/**
 * 元数据缺口判定 / 补齐的单测。
 *
 * 这里钉的是三件在真机上很难「看一眼就发现」的事：
 *   1. 「有值」与「空值」的判据必须一致 —— 判错了就会一边显示「未知歌手」、
 *      一边认为信息齐全而不去补齐（或反过来，每次都白问一遍服务端）；
 *   2. 补齐**只填空缺、不覆盖**已有字段；
 *   3. 封面 / 标题的降级顺序（后端封面 → 原始音源封面 → 占位；标题 → 文件名 → 人话）。
 */

import { describe, expect, it } from 'vitest'

import type { Song } from './types'
import { fallbackTitle, findMetadataGaps, mergeMetadata, songCoverUrl } from './metadata'

/** 造一个「信息齐全」的远程歌曲；用例只改自己关心的那几项 */
function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    type: 'remote',
    title: '标题',
    artist: '歌手',
    album: '专辑',
    year: 2020,
    genre: '流行',
    language: 'zh',
    style: null,
    duration: 200,
    file_path: '/music/a.flac',
    url: '/api/v1/songs/1/play',
    cover_url: '/api/v1/songs/1/cover',
    lyric_url: '/api/v1/songs/1/lyric-file',
    lyric_remote_url: null,
    file_size: 1024,
    format: 'flac',
    bit_rate: 900,
    sample_rate: 44100,
    source_url: null,
    source_cover_url: null,
    is_live: false,
    is_video: false,
    added_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

describe('findMetadataGaps', () => {
  it('信息齐全时不报缺口（不该为此发网络查询）', () => {
    expect(findMetadataGaps(song()).any).toBe(false)
  })

  it('空白串与 null 一视同仁', () => {
    const gaps = findMetadataGaps(song({ title: '   ', artist: null, album: '' }))
    expect(gaps).toMatchObject({ title: true, artist: true, album: true, any: true })
  })

  it('两个封面字段都空才算缺封面', () => {
    // 只有后端封面时不算缺
    expect(findMetadataGaps(song({ source_cover_url: null })).cover).toBe(false)
    // 只有原始音源封面时也不算缺（渲染会退到它，见 songCoverUrl）
    expect(
      findMetadataGaps(song({ cover_url: null, source_cover_url: 'http://x/c.jpg' })).cover
    ).toBe(false)
    expect(findMetadataGaps(song({ cover_url: null, source_cover_url: null })).cover).toBe(true)
  })

  it('本地歌曲不判歌词缺口（歌词就在音频文件里，后端按需现取）', () => {
    const local = song({ type: 'local', lyric_url: null, lyric_remote_url: null })
    expect(findMetadataGaps(local).lyric).toBe(false)
    expect(findMetadataGaps(local).any).toBe(false)
  })

  it('网络歌曲没有歌词来源才算缺', () => {
    expect(findMetadataGaps(song({ lyric_url: null })).lyric).toBe(true)
    // 只有 lyric_remote_url 也算有来源
    expect(
      findMetadataGaps(song({ lyric_url: null, lyric_remote_url: 'http://x/l.lrc' })).lyric
    ).toBe(false)
  })

  it('技术元数据只对网络歌曲判缺（本地歌曲是扫描时探测出来的）', () => {
    expect(findMetadataGaps(song({ duration: 0, bit_rate: 0 })).technical).toBe(true)
    expect(
      findMetadataGaps(
        song({ type: 'local', duration: 0, bit_rate: 0, sample_rate: 0, format: null })
      ).technical
    ).toBe(false)
  })
})

describe('mergeMetadata', () => {
  it('只补空缺，不覆盖已有字段', () => {
    const current = song({ id: 7, title: '手动改过的标题', artist: null, duration: 0 })
    const fresh = song({ id: 7, title: '服务端标题', artist: '服务端歌手', duration: 240 })

    const merged = mergeMetadata(current, fresh)
    expect(merged.title).toBe('手动改过的标题')
    expect(merged.artist).toBe('服务端歌手')
    expect(merged.duration).toBe(240)
  })

  it('什么都没补到时返回原对象（引用不变）', () => {
    const current = song({ id: 7 })
    const merged = mergeMetadata(current, song({ id: 7, title: '另一个标题' }))
    expect(merged).toBe(current)
  })

  it('服务端给的空值不会把有值的那份擦掉', () => {
    const current = song({ id: 7, cover_url: '/api/v1/songs/7/cover' })
    const merged = mergeMetadata(
      current,
      song({ id: 7, cover_url: null, updated_at: '2026-02-02' })
    )
    expect(merged).toBe(current)
  })

  it('真的补到了字段才采用新的 updated_at（它是各处缓存的键）', () => {
    const current = song({ id: 7, artist: null, updated_at: '2026-01-01T00:00:00Z' })
    const merged = mergeMetadata(
      current,
      song({ id: 7, artist: '甲', updated_at: '2026-02-02T00:00:00Z' })
    )
    expect(merged.updated_at).toBe('2026-02-02T00:00:00Z')

    // 没补到 → 连 updated_at 都不动
    const untouched = mergeMetadata(
      current,
      song({ id: 7, artist: null, updated_at: '2026-03-03' })
    )
    expect(untouched.updated_at).toBe('2026-01-01T00:00:00Z')
  })

  it('id 不一致时原样返回（防串歌）', () => {
    const current = song({ id: 7 })
    expect(mergeMetadata(current, song({ id: 8 }))).toBe(current)
  })
})

describe('songCoverUrl', () => {
  it('后端封面优先，缺失时退到原始音源封面', () => {
    expect(songCoverUrl(song({ cover_url: '/c1', source_cover_url: 'http://x/c2' }))).toBe('/c1')
    expect(songCoverUrl(song({ cover_url: null, source_cover_url: 'http://x/c2' }))).toBe(
      'http://x/c2'
    )
    expect(songCoverUrl(song({ cover_url: '', source_cover_url: '  ' }))).toBe('')
    expect(songCoverUrl(null)).toBe('')
  })
})

describe('fallbackTitle', () => {
  it('有标题就用标题', () => {
    expect(fallbackTitle(song({ title: '标题' }))).toBe('标题')
  })

  it('没有标题时用文件名（去掉扩展名与目录）', () => {
    expect(fallbackTitle(song({ title: '', file_path: '/music/01. 某首歌.flac' }))).toBe(
      '01. 某首歌'
    )
    expect(fallbackTitle(song({ title: '  ', file_path: 'C:\\music\\track.mp3' }))).toBe('track')
  })

  it('连文件名都没有时给一句人话', () => {
    expect(fallbackTitle(song({ title: '', file_path: null }))).toBe('未知歌曲')
    expect(fallbackTitle(null)).toBe('未在播放')
  })
})
