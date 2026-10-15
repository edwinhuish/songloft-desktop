/**
 * 本地文件换算的单测。
 *
 * 为什么这些纯函数值得单独测：它们决定的不是「显示成什么样」，而是
 *   * 双击关联进来的那个参数**认不认得出来**（认不出来 = 用户双击了却没反应）；
 *   * `<audio>` 请求的那个地址能不能还原回同一个路径（回不来 = 播不出声）；
 *   * 同一首歌反复打开时 id 是否一致（不一致 = 队列里去重失效、歌词缓存各自一份）。
 * 出错的表现全是间接的，排查成本远高于写用例。
 */

import { describe, expect, it } from 'vitest'

import {
  AUDIO_EXTENSIONS,
  audioMimeFor,
  baseName,
  extensionOf,
  isAudioFile,
  isLocalFileSong,
  isLocalFileUrl,
  localFileUrl,
  localSongId,
  parseByteRange,
  pathFromLocalFileUrl,
  pickAudioPaths,
  songFromLocalFile,
  titleOf
} from './local-file'

describe('扩展名与标题', () => {
  it('POSIX 与 Windows 路径都能取到文件名', () => {
    expect(baseName('/home/edwin/Music/夜曲.flac')).toBe('夜曲.flac')
    expect(baseName('C:\\Users\\edwin\\Music\\夜曲.flac')).toBe('夜曲.flac')
    // 结尾的斜杠不该把最后一段变成空串
    expect(baseName('/home/edwin/Music/')).toBe('Music')
  })

  it('扩展名统一转小写', () => {
    expect(extensionOf('/x/Song.MP3')).toBe('mp3')
    expect(extensionOf('/x/Song.FLAC')).toBe('flac')
  })

  it('没有扩展名 / 只有点开头的隐藏文件时不猜', () => {
    expect(extensionOf('/x/README')).toBe('')
    expect(extensionOf('/x/.gitignore')).toBe('')
    expect(extensionOf('/x/trailing.')).toBe('')
  })

  it('标题是去掉扩展名的文件名', () => {
    expect(titleOf('/m/01 - 夜曲.flac')).toBe('01 - 夜曲')
    expect(titleOf('C:\\m\\song.mp3')).toBe('song')
    expect(titleOf('/m/noext')).toBe('noext')
  })
})

describe('音频判定', () => {
  it('认得的格式（含大小写）判为音频', () => {
    expect(isAudioFile('/m/a.mp3')).toBe(true)
    expect(isAudioFile('/m/a.FLAC')).toBe(true)
    expect(isAudioFile('C:\\m\\a.M4a')).toBe(true)
  })

  it('放不出来的格式不算音频（认领了却放不出比不认领更糟）', () => {
    expect(isAudioFile('/m/a.wma')).toBe(false)
    expect(isAudioFile('/m/a.ape')).toBe(false)
    expect(isAudioFile('/m/a.dsf')).toBe(false)
  })

  it('非音频文件不算音频', () => {
    expect(isAudioFile('/m/cover.jpg')).toBe(false)
    expect(isAudioFile('/m/notes.txt')).toBe(false)
    expect(isAudioFile('/m/播放列表.m3u')).toBe(false)
  })

  it('MIME 按扩展名给，认不出来返回 null', () => {
    expect(audioMimeFor('/m/a.mp3')).toBe('audio/mpeg')
    expect(audioMimeFor('/m/a.flac')).toBe('audio/flac')
    expect(audioMimeFor('/m/a.ogg')).toBe('audio/ogg')
    expect(audioMimeFor('/m/a.ape')).toBeNull()
  })

  it('清单里的每个扩展名都认得出 MIME（清单与判定同源）', () => {
    expect(AUDIO_EXTENSIONS.length).toBeGreaterThan(0)
    for (const ext of AUDIO_EXTENSIONS) {
      expect(isAudioFile(`/m/a.${ext}`)).toBe(true)
      expect(audioMimeFor(`/m/a.${ext}`)).toBeTruthy()
    }
  })
})

describe('命令行参数里挑音频文件', () => {
  it('挑出音频路径，滤掉开关与可执行文件自身', () => {
    expect(
      pickAudioPaths([
        '/opt/songloft/songloft-desktop',
        '--inspect=9229',
        '/home/edwin/Music/夜曲.flac',
        '/home/edwin/Music/a.MP3'
      ])
    ).toEqual(['/home/edwin/Music/夜曲.flac', '/home/edwin/Music/a.MP3'])
  })

  it('带等号的开关即使是音频扩展名也不认', () => {
    expect(pickAudioPaths(['--play=a.mp3'])).toEqual([])
  })

  it('空参数返回空', () => {
    expect(pickAudioPaths([])).toEqual([])
  })
})

describe('地址 ↔ 路径', () => {
  it('来回一趟还是同一个路径（空格 / 中文 / Windows 盘符都得活下来）', () => {
    for (const path of [
      '/home/edwin/Music/夜曲.flac',
      '/home/edwin/Music/with space & #.mp3',
      'C:\\Users\\edwin\\Music\\song.mp3'
    ]) {
      expect(pathFromLocalFileUrl(localFileUrl(path))).toBe(path)
    }
  })

  it('地址里不会有裸的斜杠与空格（交给 <audio> 之前必须已经编码好）', () => {
    const url = localFileUrl('/home/edwin/Music/with space/夜曲.flac')
    expect(url.startsWith('songloft-media://local/')).toBe(true)
    expect(url.slice('songloft-media://local/'.length)).not.toContain('/')
    expect(url).not.toContain(' ')
  })

  it('别人的地址一律不认', () => {
    expect(isLocalFileUrl('http://localhost:58091/api/v1/songs/1/audio')).toBe(false)
    expect(isLocalFileUrl('file:///home/edwin/a.mp3')).toBe(false)
    expect(isLocalFileUrl(null)).toBe(false)
    expect(isLocalFileUrl(undefined)).toBe(false)
    expect(pathFromLocalFileUrl('http://localhost:58091/a.mp3')).toBeNull()
  })

  it('是不是本地文件按地址判，不看 type', () => {
    expect(isLocalFileSong({ url: localFileUrl('/m/a.mp3'), source_url: null })).toBe(true)
    expect(isLocalFileSong({ url: null, source_url: localFileUrl('/m/a.mp3') })).toBe(true)
    expect(isLocalFileSong({ url: '/api/v1/songs/1/audio', source_url: null })).toBe(false)
  })
})

describe('歌曲 id', () => {
  it('同一个路径永远同一个 id，且是负数（与服务端 id 永不冲突）', () => {
    expect(localSongId('/m/a.mp3')).toBe(localSongId('/m/a.mp3'))
    expect(localSongId('/m/a.mp3')).toBeLessThan(0)
    expect(localSongId('/m/b.mp3')).toBeLessThan(0)
  })

  it('不同路径的 id 不同', () => {
    const ids = new Set(
      ['/m/a.mp3', '/m/b.mp3', '/m/c.flac', '/m/d.flac', '/m/夜曲.flac'].map(localSongId)
    )
    expect(ids.size).toBe(5)
  })
})

describe('parseByteRange', () => {
  const SIZE = 1000

  it('没有 Range 就整份给', () => {
    expect(parseByteRange(null, SIZE)).toBeNull()
    expect(parseByteRange('', SIZE)).toBeNull()
    // 认不出来的写法（单位不是 bytes、区间是字母）同样退回整份
    expect(parseByteRange('items=0-9', SIZE)).toBeNull()
    expect(parseByteRange('bytes=a-b', SIZE)).toBeNull()
  })

  it('三种写法都认', () => {
    expect(parseByteRange('bytes=100-199', SIZE)).toEqual({ start: 100, end: 199 })
    expect(parseByteRange('bytes=100-', SIZE)).toEqual({ start: 100, end: 999 })
    expect(parseByteRange('bytes=-200', SIZE)).toEqual({ start: 800, end: 999 })
  })

  it('越界的 end 夹到文件末尾（Chromium 经常要一大段）', () => {
    expect(parseByteRange('bytes=0-99999999', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('起点在文件之外 → 416（不是整份重发）', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=5000-9999', SIZE)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=200-100', SIZE)).toBe('unsatisfiable')
  })

  it('空文件上任何区间都不成立', () => {
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable')
  })

  it('多区间只取第一段', () => {
    expect(parseByteRange('bytes=0-9,20-29', SIZE)).toEqual({ start: 0, end: 9 })
  })

  it('后缀比文件还长时给整份', () => {
    expect(parseByteRange('bytes=-99999', SIZE)).toEqual({ start: 0, end: 999 })
  })
})

describe('songFromLocalFile', () => {
  it('只填能从路径得到的东西，其余留空', () => {
    const song = songFromLocalFile('/home/edwin/Music/01 - 夜曲.FLAC')
    expect(song.id).toBe(localSongId('/home/edwin/Music/01 - 夜曲.FLAC'))
    expect(song.type).toBe('local')
    expect(song.title).toBe('01 - 夜曲')
    expect(song.format).toBe('flac')
    expect(song.file_path).toBe('/home/edwin/Music/01 - 夜曲.FLAC')
    expect(song.url).toBe(localFileUrl('/home/edwin/Music/01 - 夜曲.FLAC'))
    expect(song.artist).toBeNull()
    expect(song.cover_url).toBeNull()
    expect(song.lyric_url).toBeNull()
    expect(song.source_url).toBeNull()
    expect(song.duration).toBe(0)
  })
})
