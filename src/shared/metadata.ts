/**
 * 歌曲元数据的「缺口判定」与「补齐」（纯函数，可单测）。
 *
 * ★ 判据是**界面到底能不能用**，而不是「字段是不是空字符串」。后端给回来的 Song 是
 *   「音频文件内嵌标签 + 网络（音源插件 / 缓存回填）」两条路的合并结果，两边都可能只给一半 ——
 *   于是「标题空」「歌手空」「两个封面字段都空」「没有歌词地址」这几种形态必须在**同一条判据**
 *   上定义：补齐（要不要发网络查询）与降级显示（拿什么顶上去）各判各的，就会出现
 *   「界面已经显示『未知歌手』了，补齐逻辑却认为信息齐全、不去查」这种自相矛盾的组合。
 *
 * ★ 补齐只填空缺、绝不覆盖：手上这份数据里已经有的字段（含用户手动编辑过的标签）永远优先。
 *   这条不是为了省事 —— 「刷新元数据」是服务端的后台任务，它跑完时队列里那份副本可能还是旧的，
 *   拿「新查到的空值」去盖有值的那份，等于把用户刚编辑好的标签擦掉。
 */

import type { Song } from './types'

/** 一首歌在元数据上有哪些空缺 */
export interface MetadataGaps {
  title: boolean
  artist: boolean
  album: boolean
  /** 后端封面与原始音源封面**都**没有（只有其中一个不算缺，见 songCoverUrl） */
  cover: boolean
  /** 没有歌词来源（本地歌曲不判：它的歌词可能内嵌在文件里，后端按需现取） */
  lyric: boolean
  /** 技术元数据（时长 / 码率 / 采样率 / 格式）缺失 —— 只有网络歌曲会这样 */
  technical: boolean
  /** 有任何一项缺失，即「值得发一次网络查询」 */
  any: boolean
}

/** 字段「有内容」的判据：`null`、`undefined`、空白串一视同仁 */
export function filled(value: string | null | undefined): boolean {
  return (value ?? '').trim().length > 0
}

/**
 * 找出这首歌缺了哪些字段。
 *
 * 三个刻意的例外：
 *   * **歌词**：`local` 歌曲完全不判 —— 它的歌词正是内嵌在音频文件里的，没有 `lyric_url`
 *     不代表取不到（客户端照样会去问 `/songs/{id}/lyric`，见 localPlayer 的 loadLyrics）。
 *     网络歌曲没有 `lyric_url` / `lyric_remote_url` 才是真的没有来源。
 *   * **封面**：`cover_url`（后端出图）与 `source_cover_url`（原始音源地址）任一非空即算有，
 *     因为渲染时本来就会退到后者（songCoverUrl）。
 *   * **技术元数据**：只有 `remote` 会缺 —— 本地歌曲是扫描时 ffprobe 出来的，缺了说明文件本身
 *     没读出来，那也不是「再查一次网络」能解决的（后端那套补齐同样只看网络歌曲）。
 */
export function findMetadataGaps(song: Song): MetadataGaps {
  const title = !filled(song.title)
  const artist = !filled(song.artist)
  const album = !filled(song.album)
  const cover = !filled(song.cover_url) && !filled(song.source_cover_url)
  const lyric = song.type !== 'local' && !filled(song.lyric_url) && !filled(song.lyric_remote_url)
  const technical =
    song.type === 'remote' &&
    (song.duration <= 0 || song.bit_rate <= 0 || song.sample_rate <= 0 || !filled(song.format))

  return {
    title,
    artist,
    album,
    cover,
    lyric,
    technical,
    any: title || artist || album || cover || lyric || technical
  }
}

/** 可以用「补齐」填上的字段 —— 列表只有这一份，mergeMetadata 按它逐个判 */
const PATCHABLE_TEXT_FIELDS = [
  'title',
  'artist',
  'album',
  'genre',
  'language',
  'style',
  'format',
  'cover_url',
  'source_cover_url',
  'lyric_url',
  'lyric_remote_url'
] as const satisfies readonly (keyof Song)[]

const PATCHABLE_NUMBER_FIELDS = [
  'duration',
  'bit_rate',
  'sample_rate',
  'file_size',
  'year'
] as const satisfies readonly (keyof Song)[]

/**
 * 把 `fresh` 里**当前这份缺的**字段补进 `current`（原地不动，返回新对象）。
 *
 * ★ 什么都没补到时**返回原对象**（引用不变）。这件小事有两个作用：
 *   1. 队列里那份副本不会被无谓地换掉 —— 播放条、媒体控件、托盘都靠引用比较决定要不要动；
 *   2. 调用方据 `merged === current` 就能知道「服务端那边也没有」，进而去请服务端补齐
 *      （见 state/song-metadata.ts），不必再比一遍字段。
 *
 * ★ `updated_at` 只在真的有字段被补上时才采用 `fresh` 的值：它是各处缓存（歌词等）的键，
 *   没有变化就换掉它等于把已有的缓存全部作废。
 */
export function mergeMetadata(current: Song, fresh: Song): Song {
  if (current.id !== fresh.id) return current

  const next: Song = { ...current }
  let patched = false

  for (const field of PATCHABLE_TEXT_FIELDS) {
    const before = current[field]
    const after = fresh[field]
    if (filled(before) || !filled(after)) continue
    // 上面两道判断已经排除了空值，这里的断言只是让 TS 认下 after 的类型
    next[field] = after as string
    patched = true
  }

  for (const field of PATCHABLE_NUMBER_FIELDS) {
    const before = current[field]
    const after = fresh[field]
    // 0 就是「没有」：时长/码率这些字段后端缺席时给的是零值
    if (before > 0 || after <= 0) continue
    next[field] = after
    patched = true
  }

  if (!patched) return current
  next.updated_at = fresh.updated_at
  return next
}

/**
 * 封面地址：后端封面缺失时退到**原始音源封面**。
 *
 * 后端的两个字段是分开的：`cover_url` 是它自己出图（内嵌封面 / 缓存的本地图），
 * `source_cover_url` 是音源那边给的原始地址（`cover_url` 非空时也照样保留，供编辑用）。
 * 于是「内嵌封面没有、但音源给了图」是很常见的一种状态 —— 不接上的话播放条与满窗播放
 * 就是一块灰底，而图其实一直躺在数据里。返回空串表示两边都没有（调用方走占位封面）。
 */
export function songCoverUrl(song: Song | null | undefined): string {
  if (!song || filled(song.cover_url)) return (song?.cover_url ?? '').trim()
  return filled(song.source_cover_url) ? song.source_cover_url!.trim() : ''
}

/**
 * 标题兜底：元数据里没有标题时用**文件名**（去掉扩展名），再没有才给一句人话。
 *
 * 只用在展示上 —— 不写回数据，也不参与「有没有缺口」的判定：文件名是猜测，不是元数据。
 */
export function fallbackTitle(song: Song | null | undefined): string {
  if (!song) return '未在播放'
  if (filled(song.title)) return song.title
  const base = (song.file_path ?? '').split(/[\\/]/).pop() ?? ''
  const stem = base.replace(/\.[a-z0-9]{2,5}$/i, '').trim()
  return stem || '未知歌曲'
}

/**
 * 元数据缓存键：`id + updated_at`。
 *
 * 与歌词缓存同一套口径（见 localPlayer 的 lyricCacheKey）：同一首歌的数据被服务端改过之后
 * `updated_at` 会变，键也就变了 —— 于是「扫描 / 刷新元数据之后要重新问一次」是自动成立的，
 * 不必额外去作废缓存。
 */
export function metadataCacheKey(song: Song): string {
  return `${song.id}:${song.updated_at}`
}
