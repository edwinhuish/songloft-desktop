/**
 * 封面主色提取。
 *
 * 为什么要绕主进程取字节：`canvas.getImageData()` 对跨域图片会因画布污染直接抛异常，
 * 而自建后端通常不发 CORS 头。主进程取字节 → base64 → 渲染层用 `createImageBitmap`
 * 从本地 Blob 解码，就没有同源问题，也不需要关掉 webSecurity。
 *
 * 结果按封面 URL 缓存（含失败），避免同一首歌切来切去反复解码。
 */

import { extractDominantColor } from './color'

const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

async function decodeAndExtract(base64: string, mime: string): Promise<string | null> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

  const blob = new Blob([bytes], { type: mime })
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    // 采样到 64×64 足够选出主色，且解码后立刻可回收
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, 64, 64)
    return extractDominantColor(ctx.getImageData(0, 0, 64, 64))
  } finally {
    bitmap.close()
  }
}

/** 传入**已拼好的绝对**封面地址（含 access_token）；返回 `#rrggbb` 或 null */
export async function fetchCoverAccent(absoluteUrl: string): Promise<string | null> {
  if (!absoluteUrl) return null
  if (cache.has(absoluteUrl)) return cache.get(absoluteUrl) ?? null

  const existing = inflight.get(absoluteUrl)
  if (existing) return existing

  const task = (async () => {
    try {
      const bytes = await window.songloft.cover.bytes(absoluteUrl)
      if (!bytes) return null
      const color = await decodeAndExtract(bytes.base64, bytes.mime)
      cache.set(absoluteUrl, color)
      return color
    } catch (error) {
      console.warn('[accent] 取色失败', error)
      cache.set(absoluteUrl, null)
      return null
    } finally {
      inflight.delete(absoluteUrl)
    }
  })()

  inflight.set(absoluteUrl, task)
  return task
}

/**
 * 从 cover_url（可能是相对路径）取主色。
 *
 * 依赖调用方传进来的已拼地址：这里不 import url/useAuth，避免循环依赖
 * （usePlayer → accent → useAuth → ... ）。
 */
export async function fetchCoverAccentFor(
  absoluteUrl: string | null | undefined
): Promise<string | null> {
  if (!absoluteUrl) return null
  if (!/^https?:\/\//i.test(absoluteUrl)) return null
  return fetchCoverAccent(absoluteUrl)
}

export function clearAccentCache(): void {
  cache.clear()
}
