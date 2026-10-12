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
  exclude_dirs: string[]
  exclude_paths: string[]
  auto_create_exclude_dirs: string[]
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

/** 清理无效歌曲的返回体 */
export interface CleanResult {
  total: number
  file_not_found: number
  in_excluded_dir: number
}
