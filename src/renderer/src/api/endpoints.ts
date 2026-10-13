/**
 * 后端 `/api/v1` 的全部调用点。
 *
 * 端点清单来自 songloft-player 的 Flutter 实现（lib/features 下各模块的 data/xxx_api.dart），
 * 只保留桌面端真正用得到的部分，逐个核对过路径与请求体字段名。
 */

import type {
  AudioTrackInfo,
  AutoScanSetting,
  BackendVersion,
  CleanResult,
  DirectoryListResponse,
  DuplicatesResult,
  FingerprintStatus,
  FolderListResponse,
  LibraryStats,
  LyricPayload,
  LyricSource,
  MetadataRefreshProgress,
  MusicPathSetting,
  Playlist,
  PlaylistListResponse,
  PlaylistMode,
  PlaylistType,
  ScanProgress,
  ScanTitleSource,
  Song,
  SongFacetResponse,
  SongListResponse,
  SongQuery,
  SongType,
  TokenListResponse,
  VolumeNormalizeSetting
} from '@shared/types'
import { normalizePlaylist, type FacetField } from '@shared/types'
import type { ApiClient } from './client'

/* ───────────────────────────── 认证 ───────────────────────────── */

export interface LoginResult {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

export function login(client: ApiClient, username: string, password: string): Promise<LoginResult> {
  return client.request<LoginResult>('/auth/login', {
    method: 'POST',
    body: { username, password },
    anonymous: true
  })
}

export function logout(client: ApiClient): Promise<void> {
  return client.request<void>('/auth/logout', { method: 'POST' })
}

export function getTokens(client: ApiClient, limit = 20, offset = 0): Promise<TokenListResponse> {
  return client.request<TokenListResponse>('/auth/tokens', { query: { limit, offset } })
}

export function revokeToken(client: ApiClient, tokenId: string): Promise<void> {
  return client.request<void>(`/auth/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' })
}

export function getVersion(client: ApiClient): Promise<BackendVersion> {
  return client.request<BackendVersion>('/version', { anonymous: true })
}

export function getHealth(client: ApiClient): Promise<unknown> {
  return client.request<unknown>('/health', { anonymous: true })
}

/* ───────────────────────────── 歌曲 ───────────────────────────── */

function songQuery(query: SongQuery): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {}
  if (query.type && query.type !== 'all') out.type = query.type
  if (query.keyword) out.keyword = query.keyword
  if (query.path_prefix) out.path_prefix = query.path_prefix
  if (query.genre) out.genre = query.genre
  if (query.artist) out.artist = query.artist
  if (query.album) out.album = query.album
  if (query.language) out.language = query.language
  if (query.style) out.style = query.style
  if (query.year) out.year = query.year
  if (query.decade) out.decade = query.decade
  // 'none' 有语义（显示全部），不能被 truthy 判断吞掉，所以单独处理
  if (query.exclude_playlist_labels) out.exclude_playlist_labels = query.exclude_playlist_labels
  if (query.tag_id) out.tag_id = query.tag_id
  if (query.sort) out.sort = query.sort
  if (query.order) out.order = query.order
  if (query.limit != null) out.limit = query.limit
  if (query.offset != null) out.offset = query.offset
  return out
}

export function getSongs(client: ApiClient, query: SongQuery): Promise<SongListResponse> {
  return client.request<SongListResponse>('/songs', { query: songQuery(query) })
}

export function getSongIds(client: ApiClient, query: SongQuery): Promise<number[]> {
  return client
    .request<{ ids: number[]; total: number }>('/songs/ids', { query: songQuery(query) })
    .then((res) => res.ids ?? [])
}

export function getSong(client: ApiClient, id: number): Promise<Song> {
  return client.request<Song>(`/songs/${id}`)
}

export function getFolders(
  client: ApiClient,
  path = '',
  keyword = ''
): Promise<FolderListResponse> {
  return client.request<FolderListResponse>('/songs/folders', {
    query: { path: path || undefined, keyword: keyword || undefined }
  })
}

export function getLibraryStats(client: ApiClient): Promise<LibraryStats> {
  return client.request<LibraryStats>('/songs/stats')
}

export function getFacets(
  client: ApiClient,
  field: FacetField,
  options: {
    keyword?: string
    limit?: number
    offset?: number
    sort?: 'count' | 'name'
    order?: 'asc' | 'desc'
  } = {}
): Promise<SongFacetResponse> {
  return client.request<SongFacetResponse>('/songs/facets', {
    query: {
      field,
      keyword: options.keyword || undefined,
      limit: options.limit,
      offset: options.offset,
      sort: options.sort,
      order: options.order
    }
  })
}

export function getAudioTracks(client: ApiClient, id: number): Promise<AudioTrackInfo[]> {
  return client
    .request<{ tracks: AudioTrackInfo[] }>(`/songs/${id}/audio-tracks`)
    .then((res) => res.tracks ?? [])
}

export function getLyric(client: ApiClient, songId: number): Promise<LyricPayload> {
  return client.request<LyricPayload>(`/songs/${songId}/lyric`)
}

export function updateSong(
  client: ApiClient,
  id: number,
  patch: Partial<
    Pick<
      Song,
      'title' | 'artist' | 'album' | 'url' | 'cover_url' | 'duration' | 'is_live' | 'is_video'
    >
  >
): Promise<Song> {
  return client.request<Song>(`/songs/${id}`, { method: 'PUT', body: patch })
}

export function updateSongLyrics(
  client: ApiClient,
  id: number,
  payload: {
    lyric_source: LyricSource
    lyric?: string
    tlyric?: string
    rlyric?: string
    lxlyric?: string
    lyric_remote_url?: string
  }
): Promise<{ file_write_status: string }> {
  return client.request<{ file_write_status: string }>(`/songs/${id}/lyrics`, {
    method: 'PUT',
    body: payload
  })
}

export function writeSongTags(
  client: ApiClient,
  id: number,
  tags: {
    title?: string
    artist?: string
    album?: string
    year?: number
    genre?: string
    language?: string
    style?: string
    rename_file?: boolean
  }
): Promise<{ file_write: string }> {
  return client.request<{ file_write: string }>(`/songs/${id}/tags`, { method: 'PUT', body: tags })
}

export function deleteSong(client: ApiClient, id: number, deleteFiles = false): Promise<void> {
  return client.request<void>(`/songs/${id}`, {
    method: 'DELETE',
    query: deleteFiles ? { delete_files: 'true' } : undefined
  })
}

export function batchDeleteSongs(
  client: ApiClient,
  ids: number[],
  deleteFiles = false
): Promise<void> {
  return client.request<void>('/songs/batch-delete', {
    method: 'POST',
    body: { ids, delete_files: deleteFiles }
  })
}

/**
 * 上报一次播放（触发后端播放历史与 JS 插件事件广播）。
 * `type` 取 play / finish / skip；只有 `play` 会带 context 写进播放历史。
 */
export function reportPlayed(
  client: ApiClient,
  id: number,
  options: {
    type?: 'play' | 'finish' | 'skip'
    context?: { type: string; key: string } | null
  } = {}
): Promise<void> {
  return client.request<void>(`/songs/${id}/played`, {
    method: 'POST',
    query: {
      source: 'songloft-desktop',
      type: options.type ?? 'play',
      context_type: options.context?.type,
      context_key: options.context?.key
    }
  })
}

export function createRemoteSongs(
  client: ApiClient,
  items: {
    title: string
    artist?: string
    album?: string
    url: string
    cover_url?: string
    duration?: number
  }[]
): Promise<{ songs: Song[]; count: number }> {
  return client.request<{ songs: Song[]; count: number }>('/songs/remote', {
    method: 'POST',
    body: items
  })
}

/* ───────────────────────────── 歌单 ───────────────────────────── */

export function getPlaylists(
  client: ApiClient,
  options: {
    type?: PlaylistType
    songSource?: 'local' | 'remote'
    /** 排除带这些 label 的歌单；'none' 表示全部（含隐藏） */
    excludeLabels?: string
    keyword?: string
    limit?: number
    offset?: number
  } = {}
): Promise<PlaylistListResponse> {
  return (
    client
      .request<PlaylistListResponse>('/playlists', {
        query: {
          type: options.type,
          song_source: options.songSource,
          exclude_labels: options.excludeLabels,
          keyword: options.keyword || undefined,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0
        }
      })
      // 列表本身也兜一层：nil slice 序列化成 null 是同一个后端、同一种行为，
      // 少了它 usePlaylists 里的 `[...res.playlists]` 会抛「null is not iterable」
      .then((res) => ({ ...res, playlists: (res.playlists ?? []).map(normalizePlaylist) }))
  )
}

export function getPlaylist(client: ApiClient, id: number): Promise<Playlist> {
  return client.request<Playlist>(`/playlists/${id}`).then(normalizePlaylist)
}

export function createPlaylist(
  client: ApiClient,
  payload: { type: PlaylistType; name: string; description?: string }
): Promise<Playlist> {
  return client
    .request<Playlist>('/playlists', { method: 'POST', body: payload })
    .then(normalizePlaylist)
}

export function updatePlaylist(
  client: ApiClient,
  id: number,
  payload: { name?: string; description?: string; cover_song_id?: number; cover_url?: string }
): Promise<Playlist> {
  return client
    .request<Playlist>(`/playlists/${id}`, { method: 'PUT', body: payload })
    .then(normalizePlaylist)
}

export function uploadPlaylistCover(client: ApiClient, id: number, file: File): Promise<Playlist> {
  const formData = new FormData()
  formData.append('file', file, file.name)
  return client
    .request<Playlist>(`/playlists/${id}/cover`, { method: 'POST', formData })
    .then(normalizePlaylist)
}

export function deletePlaylist(client: ApiClient, id: number, deleteSongs = false): Promise<void> {
  return client.request<void>(`/playlists/${id}`, {
    method: 'DELETE',
    query: deleteSongs ? { delete_songs: 'true' } : undefined
  })
}

export function getPlaylistSongs(
  client: ApiClient,
  id: number,
  options: {
    limit?: number
    offset?: number
    sort?: string
    order?: 'asc' | 'desc'
    keyword?: string
  } = {}
): Promise<SongListResponse> {
  return client.request<SongListResponse>(`/playlists/${id}/songs`, {
    query: {
      limit: options.limit ?? 200,
      offset: options.offset ?? 0,
      sort: options.sort,
      order: options.order,
      keyword: options.keyword || undefined
    }
  })
}

export function getPlaylistSongIds(
  client: ApiClient,
  id: number,
  options: { sort?: string; order?: 'asc' | 'desc' } = {}
): Promise<number[]> {
  return client
    .request<{ ids: number[] }>(`/playlists/${id}/song-ids`, {
      query: { sort: options.sort, order: options.order }
    })
    .then((res) => res.ids ?? [])
}

export function addSongsToPlaylist(
  client: ApiClient,
  id: number,
  songIds: number[]
): Promise<{ added: number; skipped: number }> {
  return client.request<{ added: number; skipped: number }>(`/playlists/${id}/songs`, {
    method: 'POST',
    body: { song_ids: songIds }
  })
}

export function removeSongFromPlaylist(
  client: ApiClient,
  playlistId: number,
  songId: number
): Promise<void> {
  return client.request<void>(`/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' })
}

export function reorderPlaylistSongs(
  client: ApiClient,
  id: number,
  songIds: number[]
): Promise<void> {
  return client.request<void>(`/playlists/${id}/songs/reorder`, {
    method: 'PUT',
    body: { song_ids: songIds }
  })
}

export function sortPlaylistSongs(client: ApiClient, id: number, action: string): Promise<void> {
  return client.request<void>(`/playlists/${id}/songs/sort`, { method: 'POST', body: { action } })
}

export function setPlaylistPinned(
  client: ApiClient,
  id: number,
  pinned: boolean
): Promise<Playlist> {
  return client
    .request<Playlist>(`/playlists/${id}/pin`, { method: 'PUT', body: { pinned } })
    .then(normalizePlaylist)
}

export function setPlaylistVisibility(
  client: ApiClient,
  id: number,
  hidden: boolean
): Promise<Playlist> {
  return client
    .request<Playlist>(`/playlists/${id}/visibility`, { method: 'PUT', body: { hidden } })
    .then(normalizePlaylist)
}

/** 拖动重排歌单顺序（侧栏/歌单页共用） */
export function reorderPlaylists(client: ApiClient, playlistIds: number[]): Promise<void> {
  return client.request<void>('/playlists/reorder', {
    method: 'PUT',
    body: { playlist_ids: playlistIds }
  })
}

/** 记住该歌单的排序偏好（后端持久化，下次进来自动沿用） */
export function updatePlaylistSort(
  client: ApiClient,
  id: number,
  sortBy: string,
  sortOrder: 'asc' | 'desc'
): Promise<void> {
  return client.request<void>(`/playlists/${id}/sort`, {
    method: 'PUT',
    body: { sort_by: sortBy, sort_order: sortOrder }
  })
}

export function batchDeletePlaylists(
  client: ApiClient,
  ids: number[],
  deleteSongs = false
): Promise<{ deleted?: number }> {
  return client.request<{ deleted?: number }>('/playlists/batch-delete', {
    method: 'POST',
    body: { ids, delete_songs: deleteSongs }
  })
}

export function touchPlaylist(client: ApiClient, id: number): Promise<void> {
  return client.request<void>(`/playlists/${id}/touch`, { method: 'POST' })
}

/* ───────────────────────────── 扫描 / 目录 ───────────────────────────── */

/**
 * 开始扫描。
 * `paths` 非空时只扫给定目录（须在音乐根目录下）；为空则扫整个根目录。
 */
export function startScan(client: ApiClient, reimport = false, paths?: string[]): Promise<void> {
  return client.request<void>('/scan', {
    method: 'POST',
    body: paths && paths.length > 0 ? { reimport, paths } : { reimport }
  })
}

export function getScanProgress(client: ApiClient): Promise<ScanProgress> {
  return client.request<ScanProgress>('/scan/progress')
}

export function cancelScan(client: ApiClient): Promise<void> {
  return client.request<void>('/scan/cancel', { method: 'POST' })
}

/** 懒加载音乐目录树的一层（目录选择器用） */
export function getDirectories(client: ApiClient, path = ''): Promise<DirectoryListResponse> {
  return client
    .request<DirectoryListResponse>('/scan/directories', {
      query: { path: path || undefined }
    })
    .then((res) => ({ directories: res.directories ?? [], root: res.root ?? '' }))
}

/** 全部目录名（输入自动补全） */
export function getDirNames(client: ApiClient): Promise<string[]> {
  return client.request<{ names?: string[] }>('/scan/dir-names').then((res) => res.names ?? [])
}

/* ───────────────────────────── 音乐库维护 ───────────────────────────── */

/** 清理数据库里文件已不存在的歌曲。返回清理统计。 */
export function cleanMissingSongs(client: ApiClient): Promise<CleanResult> {
  return client.request<Partial<CleanResult>>('/songs/clean', { method: 'POST' }).then((res) => ({
    total: res.total ?? 0,
    file_not_found: res.file_not_found ?? 0,
    in_excluded_dir: res.in_excluded_dir ?? 0
  }))
}

/** 基于音频指纹找重复歌曲（后端可能跑几十秒，客户端要放宽超时） */
export function findDuplicates(client: ApiClient): Promise<DuplicatesResult> {
  return client.request<Partial<DuplicatesResult>>('/songs/duplicates').then((res) => ({
    groups: res.groups ?? [],
    total_groups: res.total_groups ?? 0,
    total_duplicates: res.total_duplicates ?? 0
  }))
}

export function getFingerprintStatus(client: ApiClient): Promise<FingerprintStatus> {
  return client.request<FingerprintStatus>('/scan/fingerprints/status')
}

/** 触发指纹计算。`all=true` 时连失败过的也重算。 */
export function computeFingerprints(client: ApiClient, all = false): Promise<void> {
  return client.request<void>('/scan/fingerprints', { method: 'POST', body: { all } })
}

/* ───────────────────────── 服务端设置（/settings/*）───────────────────────── */

export function getMusicPath(client: ApiClient): Promise<MusicPathSetting> {
  return client.request<Partial<MusicPathSetting>>('/settings/music-path').then((res) => ({
    path: res.path ?? 'music',
    exclude_dirs: res.exclude_dirs ?? [],
    exclude_paths: res.exclude_paths ?? [],
    auto_create_exclude_dirs: res.auto_create_exclude_dirs ?? []
  }))
}

export function updateMusicPath(client: ApiClient, setting: MusicPathSetting): Promise<void> {
  return client.request<void>('/settings/music-path', { method: 'PUT', body: setting })
}

export function getVolumeNormalize(client: ApiClient): Promise<VolumeNormalizeSetting> {
  return client
    .request<Partial<VolumeNormalizeSetting>>('/settings/volume-normalize')
    .then((res) => ({ enabled: res.enabled ?? false, loudness: res.loudness ?? -16 }))
}

export function setVolumeNormalize(
  client: ApiClient,
  setting: VolumeNormalizeSetting
): Promise<void> {
  return client.request<void>('/settings/volume-normalize', { method: 'PUT', body: setting })
}

export function getHlsProxyEnabled(client: ApiClient): Promise<boolean> {
  return client
    .request<{ enabled?: boolean }>('/settings/hls-proxy')
    .then((res) => res.enabled ?? false)
}

export function setHlsProxyEnabled(client: ApiClient, enabled: boolean): Promise<void> {
  return client.request<void>('/settings/hls-proxy', { method: 'PUT', body: { enabled } })
}

export function getScanAutoCreatePlaylists(client: ApiClient): Promise<boolean> {
  return client
    .request<{ enabled?: boolean }>('/settings/scan-auto-create-playlists')
    .then((res) => res.enabled ?? false)
}

export function setScanAutoCreatePlaylists(client: ApiClient, enabled: boolean): Promise<void> {
  return client.request<void>('/settings/scan-auto-create-playlists', {
    method: 'PUT',
    body: { enabled }
  })
}

export function getTagSyncToFile(client: ApiClient): Promise<boolean> {
  return client
    .request<{ enabled?: boolean }>('/settings/tag-sync-to-file')
    .then((res) => res.enabled ?? false)
}

export function setTagSyncToFile(client: ApiClient, enabled: boolean): Promise<void> {
  return client.request<void>('/settings/tag-sync-to-file', { method: 'PUT', body: { enabled } })
}

/** 扫描时标题取文件名还是内嵌标签 */
export function getScanTitleSource(client: ApiClient): Promise<ScanTitleSource> {
  return client
    .request<{ title_source?: string }>('/settings/scan-title-source')
    .then((res) => (res.title_source === 'filename' ? 'filename' : 'tag'))
}

export function setScanTitleSource(client: ApiClient, titleSource: ScanTitleSource): Promise<void> {
  return client.request<void>('/settings/scan-title-source', {
    method: 'PUT',
    body: { title_source: titleSource }
  })
}

/** 自动创建歌单的「歌单创建方式」。后端对非法值报 400，这里也不猜，落回默认。 */
export function getScanPlaylistMode(client: ApiClient): Promise<PlaylistMode> {
  return client.request<{ mode?: string }>('/settings/scan-playlist-mode').then((res) => {
    const mode = res.mode
    return mode === 'top_level' || mode === 'bubble_up' || mode === 'directory' ? mode : 'directory'
  })
}

export function setScanPlaylistMode(client: ApiClient, mode: PlaylistMode): Promise<void> {
  return client.request<void>('/settings/scan-playlist-mode', { method: 'PUT', body: { mode } })
}

/** 扫描后是否自动算音频指纹（默认关：大曲库会长时间占 CPU） */
export function getScanAutoFingerprint(client: ApiClient): Promise<boolean> {
  return client
    .request<{ enabled?: boolean }>('/settings/scan-auto-fingerprint')
    .then((res) => res.enabled ?? false)
}

export function setScanAutoFingerprint(client: ApiClient, enabled: boolean): Promise<void> {
  return client.request<void>('/settings/scan-auto-fingerprint', {
    method: 'PUT',
    body: { enabled }
  })
}

export function getAutoScan(client: ApiClient): Promise<AutoScanSetting> {
  return client.request<Partial<AutoScanSetting>>('/settings/auto-scan').then((res) => ({
    enabled: res.enabled ?? false,
    // 后端默认 1 小时；越界的值它自己会夹到 [60, 86400]
    interval_seconds: res.interval_seconds ?? 3600
  }))
}

export function setAutoScan(client: ApiClient, setting: AutoScanSetting): Promise<void> {
  return client.request<void>('/settings/auto-scan', { method: 'PUT', body: setting })
}

/* ─────────────────────────── 刷新元数据 ─────────────────────────── */

/**
 * 重新探测「元数据缺失」的歌曲（本地文件 + 已缓存的网络歌曲）。
 * 后台异步跑，只补空缺、不改写音频文件里的标签，进度与取消走下面两个端点。
 */
export function startMetadataRefresh(client: ApiClient): Promise<void> {
  return client.request<void>('/songs/refresh-metadata', { method: 'POST' })
}

export function getMetadataRefreshProgress(client: ApiClient): Promise<MetadataRefreshProgress> {
  return client
    .request<Partial<MetadataRefreshProgress>>('/songs/refresh-metadata/progress')
    .then((res) => ({
      status: res.status ?? 'idle',
      total: res.total ?? 0,
      processed: res.processed ?? 0,
      failed: res.failed ?? 0
    }))
}

export function cancelMetadataRefresh(client: ApiClient): Promise<void> {
  return client.request<void>('/songs/refresh-metadata/cancel', { method: 'POST' })
}

/* ───────────────────────────── 通用 KV 配置 ───────────────────────────── */

export interface ConfigEntry {
  key: string
  value: string
}

export function getConfigs(client: ApiClient): Promise<ConfigEntry[]> {
  return client.request<ConfigEntry[]>('/configs')
}

export function getConfig(client: ApiClient, key: string): Promise<ConfigEntry> {
  return client.request<ConfigEntry>(`/configs/${encodeURIComponent(key)}`)
}

export function setConfig(client: ApiClient, key: string, value: string): Promise<void> {
  return client.request<void>(`/configs/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: { key, value }
  })
}

/* ───────────────────────────── 类型便利 ───────────────────────────── */

export const SONG_TYPE_LABELS: Record<SongType, string> = {
  local: '本地',
  remote: '网络',
  radio: '电台'
}
