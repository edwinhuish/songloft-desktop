/**
 * 资源 URL 构造（封面 / 播放 / 歌词）。
 *
 * 与 songloft Flutter 端 core/utils/url_helper.dart 的行为对齐：
 *   * 相对路径（`/api/v1/...`）→ 拼上服务器地址 + `?access_token=...`
 *   * 绝对 http(s) 地址 → 原样返回（CDN 封面、外链音频）
 *
 * ★ 为什么要带 access_token 查询参数：封面与音频是交给 `img` / `audio` 元素直接请求的，
 *   走不了我们自己的 fetch 封装（也就拿不到 Authorization 头）。后端的媒体端点专门
 *   接受 `access_token` 查询参数就是为了这个场景。
 *
 * 这些都是纯函数 —— 传入 baseUrl 与 token，不读全局。这样音频 URL 的拼接逻辑可以
 * 直接单测，也避免了「token 刷新后旧 URL 还挂在 DOM 上」这类时序坑。
 */

import type { Song } from '@shared/types'

export interface ResourceContext {
  /** 服务器地址（不带 /api/v1），例如 http://localhost:58091 */
  baseUrl: string
  accessToken: string
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** 拼一个后端资源地址；外部绝对地址原样返回 */
export function buildResourceUrl(url: string | null | undefined, ctx: ResourceContext): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  const base = trimTrailingSlash(ctx.baseUrl)
  const separator = url.includes('?') ? '&' : '?'
  return `${base}${url}${separator}access_token=${encodeURIComponent(ctx.accessToken)}`
}

/** 该后端支持 `?w=` 缩略参数：给封面加一档宽度，弱网/大图时省下大量解码与传输 */
export function buildCoverUrl(
  coverUrl: string | null | undefined,
  ctx: ResourceContext,
  width?: number
): string {
  const full = buildResourceUrl(coverUrl, ctx)
  if (!full || width == null || width <= 0) return full
  // 只对本机后端加：外链 CDN 的 URL 可能带签名，改 query 会失效
  const isBackendUrl =
    !/^https?:\/\//i.test(coverUrl ?? '') || full.startsWith(trimTrailingSlash(ctx.baseUrl))
  if (!isBackendUrl) return full
  if (/[?&]w=\d+/.test(full)) return full
  // ★ 分隔符必须判断：同源的**绝对**地址（`http://host/c.jpg`）本身不带 query，
  //   直接拼 `&w=` 会得到 `http://host/c.jpg&w=96` —— 少了 `?`，这一串会被当成路径的一部分，
  //   后端只会回 404。相对路径走的是上面带 token 的分支，那里已经有 query 才没暴露出来。
  return `${full}${full.includes('?') ? '&' : '?'}w=${Math.round(width)}`
}

/** 歌词地址 */
export function buildLyricUrl(lyricUrl: string | null | undefined, ctx: ResourceContext): string {
  return buildResourceUrl(lyricUrl, ctx)
}

export type QualityPreference = 'original' | '128' | '192' | '320'

/** 当前平台是否需要后端把某些老格式转码（与 Flutter 端 AudioFormatHelper 同义） */
const NEEDS_TRANSCODE = new Set(['wma', 'ape', 'wv', 'tta', 'dsf', 'dff', 'rm', 'ra'])

export function transcodeFormatFor(format: string | null | undefined): string | null {
  if (!format) return null
  return NEEDS_TRANSCODE.has(format.toLowerCase()) ? 'mp3' : null
}

export interface SongUrlOptions {
  quality?: QualityPreference
  /** 音量归一化（后端 EBU R128） */
  normalize?: boolean
  /** 指定音轨（audio-relative index），用于原伴唱切换 */
  track?: number
}

/**
 * 歌曲播放地址。
 *
 * 与 Flutter 端一致：指定 track 时**不再附加 format** —— 容器由后端按该音轨编码决定
 * （AAC → m4a 无损 remux，否则 → mp3），两个参数一起给会互相冲突。
 */
export function buildSongUrl(
  song: Song,
  ctx: ResourceContext,
  options: SongUrlOptions = {}
): string {
  const source = song.url ?? song.source_url ?? ''
  let result = buildResourceUrl(source, ctx)
  if (!result) return ''

  const push = (param: string): void => {
    result += `${result.includes('?') ? '&' : '?'}${param}`
  }

  const { track, quality, normalize } = options
  if (track != null && track >= 0) {
    push(`track=${track}`)
  } else {
    const transcode = transcodeFormatFor(song.format)
    if (transcode) push(`format=${transcode}`)
  }
  if (quality && quality !== 'original') push(`quality=${quality}`)
  if (normalize) push('normalize=1')

  return result
}

/**
 * 一首歌最多试几个音源，试满还不出声就跳到下一首（见 localPlayer 的 error 处理）。
 *
 * ★ 口径：「连换 3 次都不行就跳下一首」在本应用里落在**尝试次数 = 3**（首选 1 次 + 换源 2 次）
 *   —— 候选链只有三级（用户偏好 / 原始音源 / 去掉音量归一化），第 4 次必然是在重复其中一级，
 *   再试只是让用户多等一轮加载失败。要改口径就改这一个数。
 * ★ 上限是**尝试次数**，不是候选个数：候选去重后可能只剩一个（比如用户本来就选了原始质量
 *   且没开音量归一化，三个候选完全等价），那时这 3 次就是「同一个地址再拉一遍」——
 *   对「首字节没到就断了」这类瞬时抖动同样有效，所以不因为候选少就少试几次。
 */
export const MAX_SOURCE_ATTEMPTS = 3

/**
 * 同一首歌的候选音源，按优先级排列（去重）。
 *
 * 后端的播放地址是**同一份音频的不同取法**，所以「换音源」在这里不是换平台，而是逐级退掉
 * 那些可能出问题的加工环节 —— 它们正是 code 4（解码 / 源不可用）最常见的原因：
 *   1. **用户偏好**：码率（后端转码降码率）+ 音量归一化（ffmpeg EBU R128）+ 老格式转码；
 *   2. **原始音源**：丢掉码率偏好，直接要原文件（转码链路整条绕开）；
 *   3. **最保守**：连音量归一化也不走 —— 那一步要 ffmpeg 读完整段音频，是失败率最高的一环。
 *
 * ★ 指定 `track`（原伴唱切换）时后端不再附加 format/quality（容器由该音轨决定），
 *   于是三个候选会塌成同一个地址 —— 去重之后只剩一个，播放器就按同一个地址重试，
 *   符合预期（切轨失败多半是文件本身的问题）。
 */
export function songUrlCandidates(
  song: Song,
  ctx: ResourceContext,
  options: SongUrlOptions = {}
): string[] {
  const attempts: SongUrlOptions[] = [
    { ...options },
    { ...options, quality: 'original' },
    { ...options, quality: 'original', normalize: false }
  ]

  const urls: string[] = []
  for (const attempt of attempts) {
    const url = buildSongUrl(song, ctx, attempt)
    if (url && !urls.includes(url)) urls.push(url)
  }
  return urls
}
