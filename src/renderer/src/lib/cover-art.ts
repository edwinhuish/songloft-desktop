/**
 * 默认封面的「配色与图案种子」。
 *
 * 音乐库里大量条目没有封面（本地文件没嵌图、网络歌单只给了名字），给它们一张
 * **有辨识度**的默认图比一片灰白有用得多：列表里扫一眼就能靠颜色/形状认出是哪一条。
 * 这里只解决「同一个名字永远得到同一张图」这件事 —— 具体画什么是 components/CoverArt.tsx。
 *
 * 三条设计约束：
 *   * **确定性**：同一 (类型, 名字) 必须永远得到同一套颜色与形状，否则列表每次重渲染
 *     都在换脸。为此用「字符串哈希 → mulberry32」而不是 Math.random()。
 *   * **色相是挑过的**：不是 0~359 均匀取 —— 黄绿一带在暗色下会发脏，与其事后补救
 *     不如不给。备选色相以冷色为主（靛/蓝/青/绿松），再配少量洋红与橙红。
 *   * **同类不同色**：哈希里混入类型名，于是同名的歌曲与歌单不会撞成一张图。
 *
 * 纯函数，无副作用，可直接单测（见 cover-art.test.ts）。
 */

export type CoverKind = 'song' | 'playlist' | 'artist'

export const COVER_KINDS: CoverKind[] = ['song', 'playlist', 'artist']

/**
 * 备选色相（度）。挑的原则：
 *   * 冷色占多数 —— 深色主题下是音乐类应用最常见的底色；
 *   * 洋红/玫红/橙红各留一档，免得整屏都是蓝；
 *   * 刻意跳过 60~140 的黄绿带（暗色下容易发脏、和「正在播放」的强调紫也容易打架）。
 */
const HUES = [262, 240, 220, 202, 186, 168, 150, 330, 312, 292, 275, 20] as const

/** 每个色相被选中的概率都相同，所以取模的基数就是长度 */
const HUE_COUNT = HUES.length

export interface CoverArt {
  /** 渐变起色相（度） */
  h: number
  /** 渐变终色相：与主色相邻（24~80 度），保证是邻近色而不是撞色 */
  h2: number
  /** 渐变角度（度） */
  angle: number
  /** 同类型下的形状变体，0 ~ 2 */
  variant: number
  /** 图案要用的确定性随机序列（每个都在 0~1），同一 seed 永远一样 */
  rand: number[]
}

/** FNV-1a（32 位）：短字符串上分布够均匀，且实现只有几行 */
function hash32(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** mulberry32：由哈希值生成一串稳定的伪随机数 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 图案最多用到 12 个随机数，多算几个备用 */
const RAND_LENGTH = 12

/**
 * 由名称/ID 推出这一张默认封面的配色与形状。
 *
 * 名字先 trim + 小写：`Abbey Road` 与 `abbey road` 是同一张脸，
 * 否则同一条目因为空格大小写不同就会换色。
 */
export function coverArt(seed: string, kind: CoverKind): CoverArt {
  const random = makeRandom(hash32(`${kind}\u0000${seed.trim().toLowerCase()}`))

  const h = HUES[Math.floor(random() * HUE_COUNT) % HUE_COUNT]
  // 邻近色：24~79 度偏转，既看得出渐变，又不会调出撞色
  const h2 = (h + 24 + Math.round(random() * 55)) % 360
  const angle = 100 + Math.round(random() * 80)
  const variant = Math.floor(random() * 3)
  const rand = Array.from({ length: RAND_LENGTH }, () => random())

  return { h, h2, angle, variant, rand }
}
