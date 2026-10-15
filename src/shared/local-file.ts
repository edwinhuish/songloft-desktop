/**
 * 本地文件播放：路径 ↔ 可播放地址 ↔ Song 的换算。
 *
 * 三处都要用同一份口径，所以放在 shared 里（纯函数，无副作用）：
 *   * 主进程：从启动参数 / macOS 的 open-file / 文件对话框里挑出音频文件（见 main/local-files.ts）；
 *   * 协议处理器：把地址还原回绝对路径去读字节（见 main/media-protocol.ts）；
 *   * 渲染层：把路径变成队列里的一首歌（见 renderer 的 state/useLocalFiles.ts）。
 *
 * ★ 为什么本地文件也要经一个**自定义协议**，而不是直接把 `file://` 交给 `<audio>`：
 *   页面运行在 http://localhost（开发态）或 file://（打包态），而 Chromium 不允许 http(s)
 *   页面加载 file:// 子资源（"Not allowed to load local resource"），于是这条路只在打包态
 *   成立、开发态静默哑掉。自定义协议两种运行方式下都成立，且响应头（Content-Type / Range）
 *   由我们自己给 —— 大文件拖动进度条要靠它。
 *
 * ★ 为什么只认这几类扩展名：它们都是 Chromium **真能解码**的格式。认领了却放不出来
 *   （wma / ape / wv / dsf 这类）比不认领更糟 —— 用户双击之后只得到一句「无法解码」，
 *   而系统里那份文件关联已经被我们抢走了。
 */

import type { Song } from './types'

/** 本地文件的播放协议（主进程在 ready 之前注册为特权协议，见 main/media-protocol.ts） */
export const LOCAL_FILE_SCHEME = 'songloft-media'
/** URL 里的固定 host。带 host 才是「标准 URL」，Chromium 才会给它与 http 同等的待遇 */
export const LOCAL_FILE_HOST = 'local'

/** 认得（且放得出）的音频扩展名 → MIME */
export const AUDIO_MIME_TYPES: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/x-wav'
}

/** 全部认得的音频扩展名（不带点，小写） */
export const AUDIO_EXTENSIONS: readonly string[] = Object.keys(AUDIO_MIME_TYPES)

/** 扩展名（小写，不带点）；没有扩展名时返回空串 */
export function extensionOf(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/**
 * 取路径最后一段。
 *
 * ★ 刻意不 import node:path：这个模块要能被渲染层（沙箱里没有 Node）直接用，
 *   而 Windows 的 `\` 与 POSIX 的 `/` 都得认 —— 两端各写一份才是真正会漂移的地方。
 */
export function baseName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const at = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return at < 0 ? normalized : normalized.slice(at + 1)
}

/** 文件名的「标题」形态：去掉扩展名（`05 - 夜曲.flac` → `05 - 夜曲`） */
export function titleOf(path: string): string {
  const name = baseName(path)
  const ext = extensionOf(path)
  return ext ? name.slice(0, name.length - ext.length - 1) : name
}

/** 这是不是一个我们放得出来的音频文件 */
export function isAudioFile(path: string): boolean {
  return extensionOf(path) in AUDIO_MIME_TYPES
}

/** 该文件的 MIME；认不出来返回 null */
export function audioMimeFor(path: string): string | null {
  return AUDIO_MIME_TYPES[extensionOf(path)] ?? null
}

/**
 * 从一串参数里挑出「像是音频文件路径」的那些。
 *
 * 启动参数里混着开关（`--inspect`）、应用自己的可执行文件路径（`/opt/.../songloft-desktop`）、
 * 以及 Electron 的其它参数，所以只按扩展名挑 —— 真实存在与否由主进程去 stat（这里没有 fs）。
 */
export function pickAudioPaths(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith('-') && isAudioFile(arg))
}

/** 绝对路径 → 可播放地址 */
export function localFileUrl(absolutePath: string): string {
  return `${LOCAL_FILE_SCHEME}://${LOCAL_FILE_HOST}/${encodeURIComponent(absolutePath)}`
}

/** 可播放地址 → 绝对路径（不是我们的地址就返回 null） */
export function pathFromLocalFileUrl(url: string): string | null {
  if (!isLocalFileUrl(url)) return null
  try {
    const { pathname } = new URL(url)
    const decoded = decodeURIComponent(pathname.replace(/^\/+/, ''))
    return decoded || null
  } catch {
    return null
  }
}

/** 这个地址是我们的本地文件协议吗 */
export function isLocalFileUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.toLowerCase().startsWith(`${LOCAL_FILE_SCHEME}://`)
}

/** 这首歌来自本地文件吗（看地址而不是看 type：type 是后端曲库的语义，本地文件不入库） */
export function isLocalFileSong(song: Pick<Song, 'url' | 'source_url'>): boolean {
  return isLocalFileUrl(song.url) || isLocalFileUrl(song.source_url)
}

/** FNV-1a（32 位）—— 只为把路径折成一个稳定的数字，不做任何安全用途 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * 本地文件的歌曲 id：路径的稳定散列**取负**。
 *
 * ★ 为什么取负：服务端曲库的 id 全是正整数，负数于是永远撞不上 —— 而「撞上」的后果是
 *   灾难性的（收藏 / 播放上报会落到曲库里另一首歌头上）。顺带还有一个好处：界面上
 *   `id < 0` 一眼就是「这不是曲库里的歌」（所有要走服务端的动作都据此让开）。
 * ★ 为什么按路径散列而不是用一个自增计数：同一首歌反复打开（双击、拖入、重启后再开）
 *   拿到的 id 必须一样，否则队列去重、歌词缓存、React key 都会各自认成两首。
 */
export function localSongId(absolutePath: string): number {
  return -(fnv1a(absolutePath) % 0x7fffffff) - 1
}

/* ─────────────────── 按区间读文件（协议处理器用）─────────────────── */

export interface ByteRange {
  /** 起始字节（含） */
  start: number
  /** 结束字节（含） */
  end: number
}

/**
 * 解析 `Range: bytes=…` 请求头（**单区间**）。
 *
 * 为什么本地文件也要撑住 Range：`<audio>` 拖动进度条时不会重拉整份文件，而是发一个
 * 「从第 N 字节开始」的请求（大 FLAC 动辄几十上百 MB，整份重发等于拖动条卡死）。
 *
 * 返回值三种，调用方各走各的：
 *   * `null` —— 没有 Range、或写法认不出来 → 按整份响应处理（200）；
 *   * `'unsatisfiable'` —— 区间落在文件之外 → 回 416（按 RFC 7233，此时 Content-Range
 *     里的区间写作「未知」+ 文件总长）；
 *   * `{start, end}` —— 回 206 与这一段字节。
 *
 * ★ 多区间（`bytes=0-9,20-29`）只取第一段：Chromium 的媒体栈从不发多区间，而完整实现
 *   multipart/byteranges 要多一层封装 —— 那种复杂度换不来任何实际收益。
 */
export function parseByteRange(
  header: string | null | undefined,
  size: number
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim().split(',')[0]?.trim() ?? '')
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (size <= 0) return 'unsatisfiable'

  // `bytes=-500`：最后 500 个字节
  if (rawStart === '') {
    if (rawEnd === '') return null
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return 'unsatisfiable'
  // `bytes=100-`：从 100 到文件末尾
  if (rawEnd === '') return { start, end: size - 1 }

  const end = Number(rawEnd)
  if (!Number.isFinite(end) || end < start) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

/**
 * 绝对路径 → 一首「够播放器用」的 Song。
 *
 * 除标题（文件名）与格式（扩展名）之外一律留空：本地文件没有后端解析出的标签，
 * 硬塞假值（比如把路径当歌手）只会让界面显示一些并不存在的信息。
 */
export function songFromLocalFile(absolutePath: string): Song {
  const format = extensionOf(absolutePath)
  return {
    id: localSongId(absolutePath),
    // 归到 'local'：播放器据此走「没有别的源可找」那条重试策略（见 localPlayer）
    type: 'local',
    title: titleOf(absolutePath),
    artist: null,
    album: null,
    year: 0,
    genre: null,
    language: null,
    style: null,
    duration: 0,
    file_path: absolutePath,
    url: localFileUrl(absolutePath),
    cover_url: null,
    lyric_url: null,
    lyric_remote_url: null,
    file_size: 0,
    format: format || null,
    bit_rate: 0,
    sample_rate: 0,
    source_url: null,
    source_cover_url: null,
    is_live: false,
    is_video: false,
    added_at: '',
    updated_at: ''
  }
}
