/**
 * LRC 解析（纯函数，不碰 DOM，便于单测）。
 *
 * 支持四种歌词串，与后端 `songloft` 的字段一一对应：
 *   lyric  主歌词
 *   tlyric 翻译
 *   rlyric 罗马音
 *   lxlyric 逐字歌词（`[mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字…`）
 *
 * 逐字优先取 lxlyric；lxmlric 为空但主歌词里自带 `<…>` 标记时，退回解析主歌词。
 */

export interface LyricWord {
  /** 该字/词的开始时间（秒） */
  time: number
  text: string
}

export interface LyricLine {
  /** 行开始时间（秒） */
  time: number
  text: string
  /** 翻译（与主歌词同时间戳对齐） */
  translation: string
  /** 罗马音（与主歌词同时间戳对齐） */
  roman: string
  /** 逐字时间轴；无则为空数组 */
  words: LyricWord[]
}

export interface ParsedLyric {
  lines: LyricLine[]
  /** 是否带时间轴。false = 纯文本歌词，静态展示、不做高亮与自动滚动 */
  synced: boolean
  /** LRC 头部的元信息（ti/ar/al/by） */
  meta: Record<string, string>
  /** 全局时间偏移（秒），来自 `[offset:]`，正值表示歌词整体提前 */
  offset: number
}

const TAG_RE = /\[([a-zA-Z#]+):([^\]]*)\]/g
const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const WORD_RE = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g

/** `mm:ss.xx` → 秒。毫秒位按位数决定权重（`.5` = 500ms，`.50` = 500ms，`.500` = 500ms）。 */
function toSeconds(mm: string, ss: string, frac?: string): number {
  const minutes = Number.parseInt(mm, 10)
  const seconds = Number.parseInt(ss, 10)
  let ms = 0
  if (frac) {
    ms = Number.parseInt(frac, 10) / 10 ** frac.length
  }
  return minutes * 60 + seconds + ms
}

interface RawLine {
  time: number
  text: string
  words: LyricWord[]
}

function parseRawLines(source: string, meta: Record<string, string>): { lines: RawLine[]; offset: number } {
  const lines: RawLine[] = []
  let offset = 0

  for (const raw of source.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line) continue

    // 纯元信息行（`[ti:xxx]` 这类字母 tag），不进正文
    let body = line
    let matchedMeta = false
    TAG_RE.lastIndex = 0
    for (const m of line.matchAll(TAG_RE)) {
      const key = m[1].toLowerCase()
      const value = m[2].trim()
      meta[key] = value
      matchedMeta = true
      body = body.replace(m[0], '')
    }
    if (matchedMeta && body.trim() === '') {
      const off = Number.parseInt(meta['offset'] ?? '', 10)
      if (!Number.isNaN(off)) offset = off / 1000
      continue
    }

    // 收集本行所有时间戳（一行多时间戳 = 同一句重复出现）
    TIME_RE.lastIndex = 0
    const stamps: number[] = []
    for (const m of body.matchAll(TIME_RE)) {
      stamps.push(toSeconds(m[1], m[2], m[3]))
    }
    const text = body.replace(TIME_RE, '').replace(WORD_RE, '').trim()

    // 逐字时间轴：`<mm:ss.xx>` 把行切成若干片段
    const words: LyricWord[] = []
    if (WORD_RE.test(body)) {
      WORD_RE.lastIndex = 0
      const marks: { time: number; index: number; length: number }[] = []
      for (const m of body.matchAll(WORD_RE)) {
        marks.push({ time: toSeconds(m[1], m[2], m[3]), index: m.index ?? 0, length: m[0].length })
      }
      for (let i = 0; i < marks.length; i += 1) {
        const mark = marks[i]
        const start = mark.index + mark.length
        const end = i + 1 < marks.length ? marks[i + 1].index : body.length
        const chunk = body.slice(start, end).replace(TIME_RE, '').trim()
        if (chunk) words.push({ time: mark.time, text: chunk })
      }
      WORD_RE.lastIndex = 0
    }

    if (stamps.length === 0) {
      // 既没有时间戳也没有 meta 的行 = 纯文本歌词，用递增时间兜底（会被标记为 unsynced）
      if (text) lines.push({ time: Number.NaN, text, words: [] })
      continue
    }
    for (const time of stamps) {
      if (text || words.length > 0) lines.push({ time, text: text || words.map((w) => w.text).join(''), words })
    }
  }

  return { lines, offset }
}

export function parseLrc(source: string): { lines: RawLine[]; offset: number; meta: Record<string, string> } {
  const meta: Record<string, string> = {}
  const { lines, offset } = parseRawLines(source ?? '', meta)
  return { lines, offset, meta }
}

/** 按时间戳把翻译/罗马音对齐到主歌词行 */
function alignByTime(timeline: RawLine[], extra: RawLine[]): Map<number, string> {
  const map = new Map<number, string>()
  if (extra.length === 0) return map
  // 时间戳可能有 ±10ms 的写法差异，按 20ms 粒度做键，避免「差 5ms 对不上」。
  const key = (t: number): number => Math.round(t * 50)
  const bucket = new Map<number, string>()
  for (const line of extra) {
    if (line.text) bucket.set(key(line.time), line.text)
  }
  for (const line of timeline) {
    const hit = bucket.get(key(line.time))
    if (hit) map.set(line.time, hit)
  }
  return map
}

/** 去掉翻译/罗马音里与主歌词完全相同的行（很多后端会原样回填） */
function isRedundant(main: string, extra: string): boolean {
  return !extra || extra.trim() === main.trim()
}

export interface ParseLyricOptions {
  lyric: string
  tlyric?: string
  rlyric?: string
  lxlyric?: string
}

/**
 * 把后端返回的四路歌词合成一个可直接渲染的时间轴。
 * 逐字源优先 lxlyric；为空且主歌词自带 `<…>` 时用主歌词。
 */
export function parseLyrics(payload: ParseLyricOptions): ParsedLyric {
  const meta: Record<string, string> = {}
  const main = parseRawLines(payload.lyric ?? '', meta)
  const lx = parseRawLines(payload.lxlyric ?? '', {})
  const tr = parseRawLines(payload.tlyric ?? '', {})
  const ro = parseRawLines(payload.rlyric ?? '', {})

  const hasWordMark = main.lines.some((l) => l.words.length > 0)
  const wordSource = lx.lines.some((l) => l.words.length > 0) ? lx : hasWordMark ? main : null
  const base = wordSource ?? main
  const offset = main.offset

  const translationMap = alignByTime(base.lines, tr.lines)
  const romanMap = alignByTime(base.lines, ro.lines)

  const unsynced = base.lines.length > 0 && base.lines.every((l) => Number.isNaN(l.time))
  const lines: LyricLine[] = base.lines
    // 丢掉空行，但保留至少一行的情况
    .filter((l) => l.text.length > 0 || l.words.length > 0)
    .map((l, index) => {
      const time = unsynced ? index : l.time - offset
      const translation = translationMap.get(l.time) ?? ''
      const roman = romanMap.get(l.time) ?? ''
      return {
        time,
        text: l.text,
        translation: isRedundant(l.text, translation) ? '' : translation,
        roman: isRedundant(l.text, roman) ? '' : roman,
        words: l.words.map((w) => ({ time: unsynced ? index : w.time - offset, text: w.text }))
      }
    })

  return {
    lines,
    synced: !unsynced,
    meta,
    offset
  }
}

/** 二分查出当前时间对应的行下标；没有匹配返回 -1（前奏阶段） */
export function findCurrentLine(lines: LyricLine[], position: number): number {
  if (lines.length === 0) return -1
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= position) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** 逐字高亮用：当前已经唱到第几个字/词 */
export function findCurrentWord(words: LyricWord[], position: number): number {
  if (words.length === 0) return -1
  let found = -1
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].time <= position) found = i
    else break
  }
  return found
}
