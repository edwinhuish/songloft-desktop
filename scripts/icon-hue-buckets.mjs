#!/usr/bin/env node
/**
 * 从 stdin 读入若干 `#RRGGBB`（一行一个，可重复），输出「出现过的色相族数量」。
 *
 * 存在的理由：ImageMagick 内置 SVG 解析器渲不出渐变时会输出一张黑白图，
 * 而黑白图的 `identify-%k` 照样有几十个「颜色」（抗锯齿灰阶）——
 * 用颜色数做断言抓不到这种静默失败。改成数色相族就没法糊弄：
 * 本项目的图标必须同时出现 青/蓝、紫、橙红 三族。
 *
 * 用法： magick x.png -colors 24 -format '%c' histogram:info:- | node scripts/icon-hue-buckets.mjs
 */
import { stdin } from 'node:process'

const BUCKETS = 12 // 每段 30°
const SATURATION_FLOOR = 0.12 // 低于此饱和度视为灰阶，不计入色相族
const MIN_COUNT = 3 // 单族至少要占到这么多像素计数，避免个别杂色凑数

let raw = ''
stdin.setEncoding('utf8')
stdin.on('data', (chunk) => {
  raw += chunk
})
stdin.on('end', () => {
  const counts = new Map()
  for (const match of raw.matchAll(/#([0-9A-Fa-f]{6})/g)) {
    const hex = match[1]
    const r = parseInt(hex.slice(0, 2), 16) / 255
    const g = parseInt(hex.slice(2, 4), 16) / 255
    const b = parseInt(hex.slice(4, 6), 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    if (delta < SATURATION_FLOOR) continue // 灰阶

    let hue
    if (max === r) hue = ((g - b) / delta) % 6
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
    if (hue < 0) hue += 6

    const bucket = Math.floor((hue * BUCKETS) / 6)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }

  const families = [...counts.values()].filter((n) => n >= MIN_COUNT).length
  process.stdout.write(String(families))
})
