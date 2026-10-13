/**
 * 与后端 `/api/v1` 一一对应的数据模型。
 *
 * 命名与字段全部照抄 songloft 后端（Go 的 json tag 是 snake_case），
 * 所以这里保留 snake_case，不做 camelCase 转换 —— 转换层是最容易悄悄漂移的地方。
 *
 * 解析一律走 `num` 再 `Number()`：Go 的 encoding/json 把整数值的 float64 写成
 * `9643`（无小数点），JSON.parse 出来就是 number，但可能是整数；写成
 * `(x as number)` 之外的强转在别处会踩坑，统一用 num 兜底。
 */

/** 歌曲类型 */
export type SongType = 'local' | 'remote' | 'radio'

/** 分面维度（`GET /api/v1/songs/facets` 的 field 取值） */
export type FacetField = 'genre' | 'artist' | 'album' | 'language' | 'style' | 'year' | 'decade'

export const FACET_FIELDS: readonly FacetField[] = [
  'artist',
  'album',
  'genre',
  'language',
  'style',
  'year'
] as const

export const FACET_LABELS: Record<FacetField, string> = {
  artist: '歌手',
  album: '专辑',
  genre: '流派',
  language: '语种',
  style: '风格',
  year: '年份',
  decade: '年代'
}

export interface Song {
  id: number
  type: SongType
  title: string
  artist: string | null
  album: string | null
  year: number
  genre: string | null
  language: string | null
  style: string | null
  duration: number
  file_path: string | null
  url: string | null
  cover_url: string | null
  lyric_url: string | null
  lyric_remote_url: string | null
  file_size: number
  format: string | null
  bit_rate: number
  sample_rate: number
  source_url: string | null
  source_cover_url: string | null
  is_live: boolean
  is_video: boolean
  added_at: string
  updated_at: string
}

export interface SongListResponse {
  songs: Song[]
  total: number
}

export interface SongFacet {
  value: string
  count: number
  cover_url: string
}

export interface SongFacetResponse {
  facets: SongFacet[]
  total: number
}

export interface FolderInfo {
  name: string
  path: string
  song_count: number
}

export interface FolderListResponse {
  path: string
  parent_path: string
  music_path: string
  folders: FolderInfo[]
  total_folders: number
  songs: Song[]
  total_songs: number
}

export interface LibraryStats {
  total_songs: number
  local_songs: number
  remote_songs: number
  radio_songs: number
  total_duration: number
  total_file_size: number
  artist_count: number
  album_count: number
  genre_count: number
}

export interface AudioTrackInfo {
  /** audio-relative index，直接作为播放 URL 的 `track=` 参数 */
  index: number
  title: string | null
  language: string | null
  codec: string | null
  is_default: boolean
}

/** 歌单类型 */
export type PlaylistType = 'normal' | 'radio'

export interface Playlist {
  id: number
  type: PlaylistType
  name: string
  description: string | null
  cover_url: string | null
  labels: string[]
  sort_by: string
  sort_order: 'asc' | 'desc'
  song_count: number
  /** 仅列表接口填充：歌单内 remote 歌曲数，>0 视为「网络歌单」 */
  remote_count: number
  pinned_at: string | null
  created_at: string
  updated_at: string
}

export interface PlaylistListResponse {
  playlists: Playlist[]
  total: number
}

/**
 * 把后端返回的歌单补成「可以直接用」的形状。
 *
 * ★ 为什么必须有这一步：Go 的 encoding/json 会把 **nil slice 序列化成 `null`**，
 *   所以 `labels` 在实际响应里可能是 `null`，而类型上写的是 `string[]` —— 类型在这里
 *   是撒谎的，于是没有任何调用方会去防御 `p.labels.includes(...)`，一读就抛
 *   TypeError 把整棵组件树干掉（Sidebar / HomePage / PlaylistDetail / AddToPlaylistDialog
 *   四处都在读它，任何一处被渲染到都会白屏）。
 *
 *   容错放在**数据进入应用的那一个入口**（`api/endpoints.ts` 里所有返回 Playlist 的函数），
 *   而不是散在四个调用点 —— 后者是「这次修好了，下次新加一个调用点又踩一遍」。
 */
export function normalizePlaylist(raw: Playlist): Playlist {
  return { ...raw, labels: Array.isArray(raw.labels) ? raw.labels : [] }
}

/** 歌词来源 */
export type LyricSource = 'manual' | 'cached' | 'url'

/** `GET /api/v1/songs/{id}/lyric` 的返回体 */
export interface LyricPayload {
  lyric: string
  tlyric: string
  rlyric: string
  lxlyric: string
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

export interface TokenInfo {
  id: number
  token_id: string
  token_type: string
  client_info: string | null
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export interface TokenListResponse {
  tokens: TokenInfo[]
  total: number
}

export type ScanStatus =
  | 'idle'
  | 'scanning'
  | 'importing'
  | 'splitting_cue'
  | 'creating_playlists'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'

export interface ScanProgress {
  status: ScanStatus
  current_file: string | null
  discovered_files: number
  total_files: number
  scanned_files: number
  imported_files: number
  skipped_files: number
  failed_files: number
  cue_split_sources: number
  local_song_count: number
}

export interface BackendVersion {
  /** 后端版本号；不同版本字段可能缺席，故全部可选 */
  version?: string
  git_commit?: string
  build_time?: string
  go_version?: string
  [key: string]: unknown
}

/** 播放模式：与 Flutter 端 AppConstants 同名同义 */
export type PlayMode = 'order' | 'loop' | 'single' | 'random'

/** 播放上下文：标识「当前队列是从哪儿播起来的」，用于 `/api/v1/play-history` */
export interface PlaybackContext {
  type: string
  key: string
}

export interface PlayHistoryEntry {
  id: number
  context_type: string
  context_key: string
  song_id: number
  song: Song | null
  played_at: string
  play_count: number
}

/** 排序字段（歌曲列表） */
export type SongSortField =
  | 'title'
  | 'artist'
  | 'album'
  | 'added_at'
  | 'updated_at'
  | 'duration'
  | 'year'
  | 'file_modified_at'

export interface SongQuery {
  type?: SongType | 'all'
  keyword?: string
  path_prefix?: string
  genre?: string
  artist?: string
  album?: string
  language?: string
  style?: string
  year?: number
  decade?: number
  /**
   * 排除属于这些 label 歌单的歌曲。
   *   * 不传（undefined）→ 后端默认排除隐藏（hidden）歌单里的歌
   *   * `'none'` → 显示全部，包含隐藏歌单里的
   * 曲库页的「显示隐藏歌单曲目」开关就是靠这个字段。
   */
  exclude_playlist_labels?: string
  /** 按标签 id 过滤（`/tags` 返回的 id） */
  tag_id?: number
  sort?: SongSortField
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/* ─────────────────────────── 目录浏览 ─────────────────────────── */

/** `/songs/folders` 之外的另一棵树：真实文件系统目录（扫描配置用） */
export interface DirEntry {
  name: string
  path: string
  has_children: boolean
}

export interface DirectoryListResponse {
  directories: DirEntry[]
  root: string
}

/** `/settings/music-path` 的返回体 */
export interface MusicPathSetting {
  path: string
  /**
   * 按「目录名」排除：路径里任何一层目录名精确命中即跳过整棵子树
   * （后端 `scanner.ShouldExcludeDir` 逐段比较，不是子串匹配）。
   */
  exclude_dirs: string[]
  /** 按「路径前缀」排除：等于该路径或位于其下 */
  exclude_paths: string[]
  /** 只在「自动创建歌单」时生效：这些目录名不出现在歌单里，不影响扫描 */
  auto_create_exclude_dirs: string[]
}

/* ─────────────────────── 扫描策略（服务端设置） ─────────────────────── */

/**
 * 自动创建歌单的方式，取值与后端 `models.PlaylistMode*` 一致：
 *   * `directory` 每个文件夹一个歌单
 *   * `top_level` 以所有歌曲目录的公共前缀为根，按第一级目录合并
 *   * `bubble_up` 歌曲同时进入自身目录与所有上级目录的歌单
 */
export type PlaylistMode = 'directory' | 'top_level' | 'bubble_up'

/** 扫描时标题的来源：`tag` 读内嵌元数据，`filename` 直接拿文件名 */
export type ScanTitleSource = 'tag' | 'filename'

/** `/settings/auto-scan`；间隔单位是秒，后端限 60 ~ 86400 */
export interface AutoScanSetting {
  enabled: boolean
  interval_seconds: number
}

export type MetadataRefreshStatus =
  'idle' | 'running' | 'cancelling' | 'done' | 'cancelled' | 'failed'

/** `/songs/refresh-metadata/progress` */
export interface MetadataRefreshProgress {
  status: MetadataRefreshStatus
  total: number
  processed: number
  failed: number
}

/* ─────────────────────────── 重复检测 ─────────────────────────── */

export interface DuplicateSong {
  id: number
  title: string
  artist: string
  album: string
  duration: number
  file_path: string
  format: string
  bit_rate: number
  file_size: number
  cover_url: string
  added_at: string
}

export interface DuplicateGroup {
  fingerprint: string
  songs: DuplicateSong[]
}

export interface DuplicatesResult {
  groups: DuplicateGroup[]
  total_groups: number
  total_duplicates: number
}

/* ─────────────────────────── 其他开关 ─────────────────────────── */

export interface VolumeNormalizeSetting {
  enabled: boolean
  loudness: number
}

export interface FingerprintStatus {
  chromaprint_available: boolean
  total: number
  computed: number
  missing: number
  failed: number
  auto_enabled: boolean
}

/** `/scan/fingerprints/progress`；后端的运行态只有 running，其余都是「已停」 */
export interface FingerprintProgress {
  status: 'idle' | 'running' | 'done' | 'cancelled'
  computed: number
  total: number
  failed: number
}

/** `/scan/fingerprints/failed` 里的一条：算不出指纹的歌，附带失败原因 */
export interface FailedFingerprint {
  id: number
  title: string
  artist: string
  file_path: string
  error: string
  attempted_at: number
}

/** 清理无效歌曲的返回体 */
export interface CleanResult {
  total: number
  file_not_found: number
  in_excluded_dir: number
}

/* ───────────────────────────── 缓存管理 ───────────────────────────── */

/** `/cache-manage/stats`：服务端音乐缓存占用 */
export interface CacheStats {
  /** 已占用字节 */
  total_size: number
  file_count: number
  /** 上限字节；0 = 不限 */
  max_size: number
}

/** `/cache-manage/config`：`cache_dir` 为空表示用默认目录，`max_size` 为 0 表示不限 */
export interface CacheConfig {
  max_size: number
  cache_dir: string
  /** 只读：后端认的默认目录，用于展示与「恢复默认」 */
  default_cache_dir: string
  /** '' = 不转码、按上游原格式落盘（默认） */
  transcode_format: string
  /** '' = 最高质量；只有损格式（mp3/m4a/ogg）有意义 */
  transcode_quality: string
}

/** 可写入的那一半（`default_cache_dir` 只读，不参与提交） */
export type CacheConfigInput = Omit<CacheConfig, 'default_cache_dir'>

/** `/cache-manage/validate-dir`：这个目录能不能用作缓存 */
export interface CacheDirCheck {
  valid: boolean
  /** 验证过程中把目录建出来了 */
  created: boolean
  total_size: number
  free_size: number
  error?: string
}

/* ───────────────────────── 更新检查（关于与更新）───────────────────────── */

/**
 * 一条可升级到的版本。
 *
 * 后端会给 stable 与 dev 两条通道各自的最新版；某一条查不到（GitHub 连不上、或该通道没有
 * 发布）时那一条就不在列表里 —— 所以列表是「能升的目标」，而不是「一定有两条」。
 */
export interface ServerUpdateTarget {
  /** 通道：'stable' | 'dev' */
  type: string
  version: string
  build_time?: string
  release_notes?: string
}

/** `/upgrade/check` */
export interface ServerUpgradeCheck {
  has_update: boolean
  current_version: string
  /** 当前通道：stable / dev */
  current_channel: string
  /** 当前构建类型：docker / full / lite…（后端原样给，界面只做展示） */
  current_build_type: string
  latest_version: string
  release_notes: string
  /** 服务器跑在容器里（升级方式与裸机不同） */
  is_docker: boolean
  /** 可升级到的版本；已是最新时为空 */
  updates: ServerUpdateTarget[]
}

/**
 * `/upgrade/progress`：升级任务的进度。
 *
 * 状态取值：idle / uploading / downloading / testing / replacing / resetting / restarting / failed。
 * 「跑完了」这件事在协议里是 **restarting**（100%）—— 后端换完二进制就 exit(0) 等容器重启，
 * 没有单独的 completed 态。所以别拿 completed 当完成判据，那会永远等不到。
 */
export interface ServerUpgradeProgress {
  status: string
  /** 0–100 */
  progress: number
  /** 当前这一步在做什么；失败时这里是原因 */
  current_step: string
}

/** `/upgrade/upload` 的返回：传上来的那份二进制自报家门 */
export interface UploadedServerBinary {
  version: string
  /** 上传文件的通道 */
  channel: string
  build_time: string
  build_type: string
  current_version: string
  current_channel: string
  /** 与当前通道不一致 —— 装上会把通道切过去，要额外确认一次 */
  channel_mismatch: boolean
}

/* ───────────────────────── 歌单备份（数据管理）───────────────────────── */

/** `/playlists/import` 的返回：逐项说明这批备份做了什么 */
export interface PlaylistImportResult {
  playlists_created: number
  playlists_merged: number
  songs_created: number
  songs_matched: number
  songs_skipped: number
}
