/**
 * 从封面里取一个「能用」的主色，作为界面强调色。
 *
 * 为什么不直接取最高频的颜色：流行音乐封面大量是白底/黑底 + 人像，
 * 最高频的往往是灰白 —— 拿它当强调色会得到一片死气沉沉的界面。
 * 所以策略是：丢掉低饱和度与过亮/过暗的像素，再按「饱和度 × 频次」打分选色，
 * 最后把选中的颜色规范化到「够鲜艳、两种主题下都读得清」的区间。
 *
 * 纯函数（只吃 ImageData），便于单测。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Hsl {
  h: number
  s: number
  l: number
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  if (h < 0) h += 6

  return { h: (h * 60) % 360, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const m = l - c / 2
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255)
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl))
}

/**
 * 取封面主色。
 *
 * 返回 `#rrggbb`；图片过于单色 / 全黑全白时返回 null，交由调用方保留默认品牌色。
 */
export function extractDominantColor(data: ImageData): string | null {
  const { data: pixels, width, height } = data
  // 量化到 24 段色相 × 4 档明度，避免渐变封面把频次摊薄到每个桶都只有几票
  const bins = new Map<
    string,
    { hueSum: number; satSum: number; lightSum: number; score: number; count: number }
  >()

  const step = 2 // 隔像素采样：封面取色不需要逐像素精度，快 4 倍
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const alpha = pixels[i + 3]
      if (alpha < 128) continue

      const { h, s, l } = rgbToHsl({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] })
      // 丢掉灰阶、过暗、过亮的像素 —— 这些不构成「颜色」
      if (s < 0.22) continue
      if (l < 0.16 || l > 0.9) continue

      const hueBin = Math.floor(h / 15)
      const lightBin = Math.round((l - 0.3) / 0.2)
      const key = `${hueBin}:${lightBin}`
      // 打分偏好「鲜艳且不太暗」的像素
      const score = s * (1 - Math.abs(l - 0.55))
      const existing = bins.get(key)
      if (existing) {
        existing.hueSum += h
        existing.satSum += s
        existing.lightSum += l
        existing.score += score
        existing.count += 1
      } else {
        bins.set(key, { hueSum: h, satSum: s, lightSum: l, score, count: 1 })
      }
    }
  }

  if (bins.size === 0) return null

  let best: {
    hueSum: number
    satSum: number
    lightSum: number
    score: number
    count: number
  } | null = null
  for (const bin of bins.values()) {
    if (!best || bin.score > best.score) best = bin
  }
  if (!best) return null

  // 规范化：够鲜艳、且明度落在「深色与浅色主题下都能读清」的窄区间里
  const avg: Hsl = {
    h: best.hueSum / best.count,
    s: Math.min(1, Math.max(0.42, best.satSum / best.count)),
    l: Math.min(0.72, Math.max(0.5, best.lightSum / best.count))
  }
  return hslToHex(avg)
}

/** 相对亮度（WCAG），用来决定叠在主色上的文字该用黑还是白 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = match[1]
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  }
}

/** 叠在该色上的文字用黑还是白 */
export function readableTextOn(hex: string): '#000000' | '#ffffff' {
  const rgb = parseHex(hex)
  if (!rgb) return '#ffffff'
  return relativeLuminance(rgb) > 0.5 ? '#000000' : '#ffffff'
}

/** 判断两个颜色是否「几乎一样」，用于跳过无意义的主题刷新 */
export function isSimilarColor(a: string | null, b: string | null, tolerance = 12): boolean {
  if (!a || !b) return a === b
  const ra = parseHex(a)
  const rb = parseHex(b)
  if (!ra || !rb) return false
  return (
    Math.abs(ra.r - rb.r) <= tolerance &&
    Math.abs(ra.g - rb.g) <= tolerance &&
    Math.abs(ra.b - rb.b) <= tolerance
  )
}
