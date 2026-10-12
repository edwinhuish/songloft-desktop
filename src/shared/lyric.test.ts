import { describe, expect, it } from 'vitest'

import { parseLrc, parseLyrics } from './lyric'

/**
 * 这批用例锁住一个**静默丢行**缺陷。
 *
 * 原实现是 `base = wordSource ?? main`：一旦后端返回了 lxlyric（逐字），
 * 行集合就**整份换成逐字源**。而真实数据里逐字歌词常只覆盖副歌，
 * 于是主歌词里其余的行会被丢掉，界面上表现为「歌词莫名其妙少几句」，
 * 且没有任何报错 —— 只有把 playwright 截图和 mock 数据对着数才看出来。
 *
 * 修复后的契约：**行集合永远以主歌词为准**，逐字源只负责两件事：
 *   ① 给时间戳相同的行挂上 words；② 把主歌词缺失的行按时间补进来。
 */

const MAIN_10 = [
  '[00:00.00]午夜电台',
  '[00:04.20]词曲 / Mock',
  '[00:12.00]把车窗摇下来一点',
  '[00:17.50]让城市的风灌进来',
  '[00:23.10]信号灯在雨里散开',
  '[00:28.60]像谁没说完的对白',
  '[00:36.00]我在午夜的电波里',
  '[00:41.40]听见了另一个自己',
  '[00:47.00]他说别停下别回头',
  '[00:52.50]前面就是你要的出口'
].join('\n')

/** 只覆盖第 3–6 句（12.00 / 17.50 / 23.10 / 28.60）的逐字源 */
const LX_PARTIAL = [
  '[00:12.00]<00:12.00>把<00:12.42>车<00:12.80>窗<00:13.18>摇<00:13.56>下<00:13.94>来<00:14.32>一<00:14.70>点',
  '[00:17.50]<00:17.50>让<00:17.90>城<00:18.28>市<00:18.66>的<00:19.04>风<00:19.42>灌<00:19.80>进<00:20.18>来',
  '[00:23.10]<00:23.10>信<00:23.48>号<00:23.86>灯<00:24.24>在<00:24.62>雨<00:25.00>里<00:25.38>散<00:25.76>开',
  '[00:28.60]<00:28.60>像<00:28.98>谁<00:29.36>没<00:29.74>说<00:30.12>完<00:30.50>的<00:30.88>对<00:31.26>白'
].join('\n')

describe('parseLyrics：逐字歌词与主歌词的合并', () => {
  it('逐字源只覆盖部分行时，主歌词的其余行必须保留（回归）', () => {
    const parsed = parseLyrics({ lyric: MAIN_10, lxlyric: LX_PARTIAL })
    expect(parsed.lines).toHaveLength(10)
    expect(parsed.lines.map((l) => l.text)).toEqual([
      '午夜电台',
      '词曲 / Mock',
      '把车窗摇下来一点',
      '让城市的风灌进来',
      '信号灯在雨里散开',
      '像谁没说完的对白',
      '我在午夜的电波里',
      '听见了另一个自己',
      '他说别停下别回头',
      '前面就是你要的出口'
    ])
  })

  it('只有时间戳命中的行才挂 words，未覆盖的行 words 为空', () => {
    const parsed = parseLyrics({ lyric: MAIN_10, lxlyric: LX_PARTIAL })
    const worded = parsed.lines.filter((l) => l.words.length > 0)
    // 4 行有逐字、6 行没有；不能「全有」也不能「全无」
    expect(worded).toHaveLength(4)
    expect(parsed.lines.find((l) => l.text === '午夜电台')?.words).toEqual([])
  })

  it('逐字时间轴挂到正确的那一行上（不是按顺序硬贴）', () => {
    const parsed = parseLyrics({ lyric: MAIN_10, lxlyric: LX_PARTIAL })
    const target = parsed.lines.find((l) => l.text === '把车窗摇下来一点')
    expect(target?.words.map((w) => w.text).join('')).toBe('把车窗摇下来一点')
    expect(target?.words[0]?.time).toBeCloseTo(12.0, 3)
  })

  it('逐字源里多出来的行按时间补进来并保持有序', () => {
    const lxWithExtra = [
      LX_PARTIAL,
      '[00:33.00]<00:33.00>多<00:33.4>出<00:33.8>来<00:34.2>的<00:34.6>一<00:35.0>句'
    ].join('\n')
    const parsed = parseLyrics({ lyric: MAIN_10, lxlyric: lxWithExtra })
    expect(parsed.lines).toHaveLength(11)
    const times = parsed.lines.map((l) => l.time)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(parsed.lines.some((l) => l.text === '多出来的一句')).toBe(true)
  })

  it('没有逐字源时，主歌词原样返回', () => {
    const parsed = parseLyrics({ lyric: MAIN_10 })
    expect(parsed.lines).toHaveLength(10)
    expect(parsed.lines.every((l) => l.words.length === 0)).toBe(true)
    expect(parsed.synced).toBe(true)
  })

  it('主歌词为空、只有逐字源时，结果等于逐字源', () => {
    const parsed = parseLyrics({ lyric: '', lxlyric: LX_PARTIAL })
    expect(parsed.lines).toHaveLength(4)
    expect(parsed.lines.every((l) => l.words.length > 0)).toBe(true)
  })

  it('主歌词自带 `<…>` 标记时，不必依赖 lxlyric 也能拿到逐字', () => {
    const inline = '[00:12.00]<00:12.00>把<00:12.50>车<00:13.00>窗'
    // 注意：行集合以「主歌词」为准这个约定在只传 lyric 时退化为它自己
    const parsed = parseLyrics({ lyric: inline })
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]?.words.map((w) => w.text).join('')).toBe('把车窗')
  })
})

describe('parseLyrics：翻译 / 罗马音对齐', () => {
  it('翻译按时间戳对齐，且与主歌词完全相同的翻译被判为冗余丢弃', () => {
    const parsed = parseLyrics({
      lyric: MAIN_10,
      tlyric: ['[00:12.00]Roll the window down a bit', '[00:17.50]让城市的风灌进来'].join('\n')
    })
    const hit = parsed.lines.find((l) => l.text === '把车窗摇下来一点')
    expect(hit?.translation).toBe('Roll the window down a bit')
    // tlyric 与主歌词逐字相同的行不应重复显示
    const same = parsed.lines.find((l) => l.text === '让城市的风灌进来')
    expect(same?.translation).toBe('')
  })

  it('翻译时间戳有 ±ms 写法差异时仍能对上', () => {
    const parsed = parseLyrics({ lyric: '[00:12.00]原句', tlyric: '[00:12.010]译文' })
    expect(parsed.lines[0]?.translation).toBe('译文')
  })
})

describe('parseLrc：基础解析', () => {
  it('解析头部元信息与 offset', () => {
    const { meta, offset } = parseLrc('[ti:测试][ar:某人][offset:-500]\n[00:01.00]正文')
    expect(meta.ti).toBe('测试')
    expect(meta.ar).toBe('某人')
    expect(offset).toBeCloseTo(-0.5, 3)
  })

  it('毫秒位按位数决定权重（.5 / .50 / .500 都是 500ms）', () => {
    for (const frac of ['5', '50', '500']) {
      const { lines } = parseLrc(`[00:01.${frac}]任意`)
      expect(lines[0]?.time).toBeCloseTo(1.5, 3)
    }
  })

  it('一行多时间戳展开成多行（同一句重复出现）', () => {
    const { lines } = parseLrc('[00:01.00][00:03.00]副歌')
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.time)).toEqual([1, 3])
  })

  it('纯文本歌词（无时间戳）标记为 unsynced 并按序编号', () => {
    const parsed = parseLyrics({ lyric: '第一行\n第二行\n第三行' })
    expect(parsed.synced).toBe(false)
    expect(parsed.lines.map((l) => l.time)).toEqual([0, 1, 2])
  })
})
