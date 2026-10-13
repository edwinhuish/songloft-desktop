/**
 * Songloft 后端的**最小 mock**，只用于本地跑通桌面端的已登录界面。
 *
 * 目的单一：让 Songloft Desktop 能真的走完
 *   登录 → 首页 → 曲库 / 艺人筛选 → 播放 → 歌词 → 歌单 / 收藏
 * 而不是只停在登录页（那样 969 kB 的渲染层等于零验证）。
 *
 * 注意：这不是后端的替代品，不落库、不校验密码（任何非空账号密码都放行）。
 * 数据形状严格按 src/shared/types.ts 抄，字段名保持 snake_case。
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 封面是固定 fixture：用真实 JPEG 而不是内联 SVG —— 取主色的链路要走
 *  createImageBitmap(blob)，SVG blob 在 Chromium 里需要显式尺寸，容易踩坑。 */
const COVER_DIR = join(HERE, 'fixtures', 'covers')
const PORT = Number(process.env.MOCK_PORT ?? 58091)

const ALBUMS = [
  {
    album: '夜航西飞',
    artist: '陈屿',
    genre: '独立',
    language: '国语',
    style: '民谣',
    year: 2023,
    cover: 'cover-01.jpg'
  },
  {
    album: 'Blue Hour',
    artist: 'Marla Quinn',
    genre: '爵士',
    language: '英语',
    style: 'Vocal Jazz',
    year: 2021,
    cover: 'cover-02.jpg'
  },
  {
    album: '山海之间',
    artist: '野岸乐队',
    genre: '摇滚',
    language: '国语',
    style: '后摇',
    year: 2019,
    cover: 'cover-03.jpg'
  },
  {
    album: 'Late Night Drive',
    artist: 'Kaito Mori',
    genre: '电子',
    language: '日语',
    style: 'City Pop',
    year: 2024,
    cover: 'cover-04.jpg'
  },
  {
    album: '旧唱片店',
    artist: '陈屿',
    genre: '独立',
    language: '国语',
    style: '民谣',
    year: 2020,
    cover: 'cover-05.jpg'
  },
  {
    album: 'Northern Lights',
    artist: 'Sofia Lind',
    genre: '古典',
    language: '纯音乐',
    style: 'Neo-Classical',
    year: 2018,
    cover: 'cover-06.jpg'
  },
  {
    album: '热带低气压',
    artist: '野岸乐队',
    genre: '摇滚',
    language: '国语',
    style: '车库',
    year: 2022,
    cover: 'cover-07.jpg'
  },
  {
    album: 'Echoes',
    artist: 'Marla Quinn',
    genre: '爵士',
    language: '英语',
    style: 'Bossa Nova',
    year: 2025,
    cover: 'cover-08.jpg'
  }
]

const TITLE_WORDS = [
  '午夜电台',
  '公路尽头',
  '无人认领的信',
  '旧站台',
  '风穿过走廊',
  '蓝色时刻',
  '第七个梦',
  '灯塔以北',
  '沉默的告解',
  '十二月手记',
  '南回归线',
  '潮汐表',
  '未寄出的明信片',
  '雾中列车',
  '夏季限定',
  '阁楼上的雨'
]

/** 用确定性伪随机造数据，保证每次启动的曲库一致（便于截图比对） */
let seed = 20261012
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

const SONGS = []
let id = 1
for (let a = 0; a < ALBUMS.length; a += 1) {
  const meta = ALBUMS[a]
  const tracks = 4 + Math.floor(rand() * 3)
  for (let t = 1; t <= tracks; t += 1) {
    const isRemote = a === 3 && t % 3 === 0
    SONGS.push({
      id,
      type: isRemote ? 'remote' : 'local',
      title: isRemote
        ? `${TITLE_WORDS[id % TITLE_WORDS.length]}（网络源）`
        : TITLE_WORDS[id % TITLE_WORDS.length],
      artist: meta.artist,
      album: meta.album,
      year: meta.year,
      genre: meta.genre,
      language: meta.language,
      style: meta.style,
      duration: 168 + Math.floor(rand() * 190),
      file_path: isRemote
        ? null
        : `/music/${meta.artist}/${meta.album}/${String(t).padStart(2, '0')} - track.flac`,
      url: `http://localhost:${PORT}/media/${id}.flac`,
      cover_url: `/covers/${meta.cover}`,
      lyric_url: null,
      lyric_remote_url: null,
      file_size: isRemote ? 0 : 18_000_000 + Math.floor(rand() * 26_000_000),
      format: isRemote ? null : 'flac',
      bit_rate: isRemote ? 0 : 1000 + Math.floor(rand() * 400),
      sample_rate: isRemote ? 0 : 44100,
      source_url: isRemote ? 'https://music.163.com/#/song?id=mock' : null,
      source_cover_url: null,
      is_live: false,
      is_video: false,
      added_at: new Date(Date.UTC(2026, 8, 1 + (id % 40), 10, 12, 0)).toISOString(),
      updated_at: new Date(Date.UTC(2026, 9, 1, 8, 0, 0)).toISOString()
    })
    id += 1
  }
}

const PLAYLISTS = [
  {
    id: 1,
    type: 'normal',
    name: '我喜欢的音乐',
    description: null,
    cover_url: null,
    labels: [],
    sort_by: 'added_at',
    sort_order: 'desc',
    song_count: 6,
    remote_count: 0,
    pinned_at: null,
    created_at: '2026-01-04T02:00:00Z',
    updated_at: '2026-09-30T09:00:00Z'
  },
  {
    id: 2,
    type: 'radio',
    name: '电台收藏',
    description: null,
    cover_url: null,
    labels: [],
    sort_by: 'added_at',
    sort_order: 'desc',
    song_count: 0,
    remote_count: 0,
    pinned_at: null,
    created_at: '2026-01-04T02:00:00Z',
    updated_at: '2026-06-01T09:00:00Z'
  },
  {
    id: 3,
    type: 'normal',
    name: '深夜写码',
    description: '不吵、不打断思路',
    cover_url: '/covers/cover-04.jpg',
    labels: [],
    sort_by: 'position',
    sort_order: 'asc',
    song_count: 5,
    remote_count: 0,
    pinned_at: '2026-09-01T00:00:00Z',
    created_at: '2026-03-11T02:00:00Z',
    updated_at: '2026-09-20T09:00:00Z'
  },
  {
    id: 4,
    type: 'normal',
    name: '通勤路上',
    description: null,
    cover_url: '/covers/cover-07.jpg',
    labels: [],
    sort_by: 'position',
    sort_order: 'asc',
    song_count: 4,
    remote_count: 0,
    pinned_at: null,
    created_at: '2026-05-02T02:00:00Z',
    updated_at: '2026-08-14T09:00:00Z'
  }
]

const FAVORITE_IDS = [1, 5, 9, 14, 22, 31]
const PLAYLIST_SONGS = {
  3: [4, 8, 15, 21, 29],
  4: [2, 11, 18, 26]
}

const LYRICS = {
  lyric: [
    '[00:00.00]午夜电台',
    '[00:04.20]词曲 / Mock',
    '[00:12.00]把车窗摇下来一点',
    '[00:17.50]让城市的风灌进来',
    '[00:23.10]信号灯在雨里散开',
    '[00:28.60]像谁没说完的对白',
    '[00:36.00]我在午夜的电波里',
    '[00:41.40]听见了另一个自己',
    '[00:47.00]他说别停下别回头',
    '[00:52.50]前面就是你要的出口'
  ].join('\n'),
  tlyric: '',
  rlyric: '',
  // lxlyric 带逐字时间戳，用来验证卡拉OK高亮
  lxlyric: [
    '[00:12.00]<00:12.00>把<00:12.42>车<00:12.80>窗<00:13.18>摇<00:13.56>下<00:13.94>来<00:14.32>一<00:14.70>点',
    '[00:17.50]<00:17.50>让<00:17.90>城<00:18.28>市<00:18.66>的<00:19.04>风<00:19.42>灌<00:19.80>进<00:20.18>来',
    '[00:23.10]<00:23.10>信<00:23.48>号<00:23.86>灯<00:24.24>在<00:24.62>雨<00:25.00>里<00:25.38>散<00:25.76>开',
    '[00:28.60]<00:28.60>像<00:28.98>谁<00:29.36>没<00:29.74>说<00:30.12>完<00:30.50>的<00:30.88>对<00:31.26>白'
  ].join('\n')
}

const FOLDERS = [
  { name: '陈屿', path: '陈屿', song_count: 8 },
  { name: 'Marla Quinn', path: 'Marla Quinn', song_count: 7 },
  { name: '野岸乐队', path: '野岸乐队', song_count: 7 },
  { name: 'Kaito Mori', path: 'Kaito Mori', song_count: 5 },
  { name: 'Sofia Lind', path: 'Sofia Lind', song_count: 4 }
]

/* ─────────────────────────── 工具 ─────────────────────────── */

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS'
  })
  res.end(body)
}

function noContent(res) {
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
  res.end()
}

/**
 * 读取 JSON 请求体：空体当 `{}`，非法 JSON 返回 null。
 *
 * 真实后端对解析不了的 body 也是 400，所以调用方拿到 null 就该回 400 —— 不能当空对象放行。
 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })
  })
}

function facetsOf(field) {
  const counts = new Map()
  for (const song of SONGS) {
    const raw = song[field]
    if (raw == null || raw === '') continue
    const key = String(raw)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, cover_url: '/covers/cover-01.jpg' }))
    .sort((a, b) => b.count - a.count)
}

function songsResponse(url) {
  const q = url.searchParams
  let list = [...SONGS]
  const type = q.get('type')
  if (type && type !== 'all') list = list.filter((s) => s.type === type)
  const keyword = q.get('keyword')
  if (keyword) {
    const k = keyword.toLowerCase()
    list = list.filter((s) =>
      [s.title, s.artist, s.album, s.genre].some((v) => (v ?? '').toLowerCase().includes(k))
    )
  }
  for (const field of ['artist', 'album', 'genre', 'language', 'style']) {
    const value = q.get(field)
    if (value) list = list.filter((s) => s[field] === value)
  }
  const year = q.get('year')
  if (year) list = list.filter((s) => s.year === Number(year))
  const pathPrefix = q.get('path_prefix')
  if (pathPrefix) list = list.filter((s) => (s.file_path ?? '').includes(pathPrefix))

  const sort = q.get('sort') ?? 'added_at'
  const desc = (q.get('order') ?? 'desc') === 'desc'
  list.sort((a, b) => {
    const av = a[sort] ?? ''
    const bv = b[sort] ?? ''
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
    return desc ? -cmp : cmp
  })

  const total = list.length
  const offset = Number(q.get('offset') ?? 0)
  const limit = Number(q.get('limit') ?? 50)
  return { songs: list.slice(offset, offset + limit), total }
}

/* ─────────────────────── 可变设置（需要回读的） ─────────────────────── */

/**
 * 音量均衡（EBU R128）：
 *
 * 形状对齐真实后端 `/api/v1/settings/volume-normalize` 的契约 —— `{ enabled: bool,
 * loudness: number }`（LUFS，范围 -40 ~ -5，默认 -16）。历史 mock 返回的 `target_lufs` / `mode`
 * 在后端并不存在，导致客户端的 `res.loudness ?? -16` 永远走兜底、字段名写错也发现不了。
 *
 * 取值刻意取非默认（enabled=true / loudness=-14）：与下面三个布尔开关同样的用意 ——
 * 客户端读错字段或初始状态渲染错时，非默认值才看得出来。
 */
const volumeNormalize = { enabled: true, loudness: -14 }

/**
 * PUT /api/v1/settings/volume-normalize
 *
 * 真实后端语义：`loudness` 可省略（省略=只切开关、不改响度），越界报 400 而不是夹紧；
 * 响应回显更新后的 `{ enabled, loudness }`，与随后的 GET 一致。
 */
function putVolumeNormalize(req, res) {
  void readJsonBody(req).then((body) => {
    if (body === null) return json(res, 400, { error: '请求格式错误' })
    const loudness = body.loudness ?? volumeNormalize.loudness
    if (typeof loudness !== 'number' || loudness < -40 || loudness > -5)
      return json(res, 400, { error: `音量均衡响度 ${loudness} 越界，需在 -40 ~ -5 LUFS` })
    volumeNormalize.enabled = body.enabled ?? volumeNormalize.enabled
    volumeNormalize.loudness = loudness
    return json(res, 200, { ...volumeNormalize })
  })
}

/* ─────────────────────────── 路由 ─────────────────────────── */

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS'
    })
    res.end()
    return
  }

  // 封面 / 音频等媒体：走真实文件
  if (path.startsWith('/covers/')) {
    const file = join(COVER_DIR, path.slice('/covers/'.length))
    if (!existsSync(file)) return json(res, 404, { error: 'no cover' })
    const buf = readFileSync(file)
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buf.length,
      'Access-Control-Allow-Origin': '*'
    })
    res.end(buf)
    return
  }

  // 音频：给一段极短的静音 WAV，让 <audio> 能真的 load/play 起来（只为验证链路）
  if (path.startsWith('/media/')) {
    const rate = 8000
    const secs = 30
    const samples = rate * secs
    const buf = Buffer.alloc(44 + samples)
    buf.write('RIFF', 0)
    buf.writeUInt32LE(36 + samples, 4)
    buf.write('WAVE', 8)
    buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(1, 22)
    buf.writeUInt32LE(rate, 24)
    buf.writeUInt32LE(rate, 28)
    buf.writeUInt16LE(1, 32)
    buf.writeUInt16LE(8, 34)
    buf.write('data', 36)
    buf.writeUInt32LE(samples, 40)
    buf.fill(128, 44)
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': buf.length,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(buf)
    return
  }

  if (path === '/health') return json(res, 200, { status: 'ok' })
  if (path === '/api/v1/version') {
    return json(res, 200, {
      version: 'mock-2026.10.12',
      git_commit: 'mockcafe',
      build_time: '2026-10-12T10:00:00Z'
    })
  }

  if (path === '/api/v1/auth/login' && req.method === 'POST') {
    return json(res, 200, {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 86400,
      token_type: 'Bearer'
    })
  }
  if (path === '/api/v1/auth/refresh' && req.method === 'POST') {
    return json(res, 200, {
      access_token: 'mock-access-token-2',
      refresh_token: 'mock-refresh-token-2',
      expires_in: 86400,
      token_type: 'Bearer'
    })
  }
  if (path === '/api/v1/auth/logout') return noContent(res)
  if (path === '/api/v1/auth/tokens') {
    return json(res, 200, {
      tokens: [
        {
          id: 1,
          token_id: 'mock-token-1',
          token_type: 'access',
          client_info: 'Songloft Desktop (Linux)',
          expires_at: '2026-10-13T10:00:00Z',
          revoked_at: null,
          created_at: '2026-10-12T10:00:00Z'
        }
      ],
      total: 1
    })
  }

  if (path === '/api/v1/songs') return json(res, 200, songsResponse(url))
  if (path === '/api/v1/songs/ids') {
    const r = songsResponse(url)
    return json(res, 200, { ids: r.songs.map((s) => s.id), total: r.total })
  }
  if (path === '/api/v1/songs/stats') {
    return json(res, 200, {
      total_songs: SONGS.length,
      local_songs: SONGS.filter((s) => s.type === 'local').length,
      remote_songs: SONGS.filter((s) => s.type === 'remote').length,
      radio_songs: 0,
      total_duration: SONGS.reduce((acc, s) => acc + s.duration, 0),
      total_file_size: SONGS.reduce((acc, s) => acc + s.file_size, 0),
      artist_count: new Set(SONGS.map((s) => s.artist)).size,
      album_count: new Set(SONGS.map((s) => s.album)).size,
      genre_count: new Set(SONGS.map((s) => s.genre)).size
    })
  }
  if (path === '/api/v1/songs/facets') {
    const field = url.searchParams.get('field') ?? 'artist'
    const facets = facetsOf(field)
    return json(res, 200, { facets, total: facets.length })
  }
  if (path === '/api/v1/songs/folders') {
    const cur = url.searchParams.get('path') ?? ''
    const songs = cur ? SONGS.filter((s) => (s.file_path ?? '').includes(cur)) : []
    return json(res, 200, {
      path: cur,
      parent_path: cur ? cur.split('/').slice(0, -1).join('/') : '',
      music_path: '/music',
      folders: cur ? [] : FOLDERS,
      total_folders: cur ? 0 : FOLDERS.length,
      songs,
      total_songs: songs.length
    })
  }
  if (path === '/api/v1/songs/clean' && req.method === 'POST') {
    return json(res, 200, { total: 0, file_not_found: 0, removed: 0 })
  }
  if (path === '/api/v1/songs/duplicates') {
    return json(res, 200, {
      groups: [
        {
          fingerprint: 'mockfp1',
          songs: [SONGS[0], SONGS[1]],
          reason: 'duration+title'
        }
      ],
      total: 1
    })
  }
  if (path === '/api/v1/songs/batch-delete' && req.method === 'POST')
    return json(res, 200, { deleted: 0 })

  let m = /^\/api\/v1\/songs\/(\d+)$/.exec(path)
  if (m) {
    const song = SONGS.find((s) => s.id === Number(m[1]))
    return song ? json(res, 200, song) : json(res, 404, { error: '歌曲不存在' })
  }
  m = /^\/api\/v1\/songs\/(\d+)\/lyric$/.exec(path)
  if (m) return json(res, 200, LYRICS)
  m = /^\/api\/v1\/songs\/(\d+)\/played$/.exec(path)
  if (m) return noContent(res)
  m = /^\/api\/v1\/songs\/(\d+)\/audio-tracks$/.exec(path)
  if (m) return json(res, 200, { tracks: [], total: 0 })
  m = /^\/api\/v1\/songs\/(\d+)$/.exec(path)
  if (m) return json(res, 200, SONGS.find((s) => s.id === Number(m[1])) ?? {})

  if (path === '/api/v1/playlists')
    return json(res, 200, { playlists: PLAYLISTS, total: PLAYLISTS.length })
  m = /^\/api\/v1\/playlists\/(\d+)\/song-ids$/.exec(path)
  if (m) {
    const pid = Number(m[1])
    if (pid === 1) return json(res, 200, { ids: FAVORITE_IDS })
    if (pid === 2) return json(res, 200, { ids: [] })
    return json(res, 200, { ids: PLAYLIST_SONGS[pid] ?? [] })
  }
  m = /^\/api\/v1\/playlists\/(\d+)\/songs$/.exec(path)
  if (m) {
    const pid = Number(m[1])
    const ids = pid === 1 ? FAVORITE_IDS : (PLAYLIST_SONGS[pid] ?? [])
    const songs = ids.map((sid) => SONGS.find((s) => s.id === sid)).filter(Boolean)
    return json(res, 200, { songs, total: songs.length })
  }
  m = /^\/api\/v1\/playlists\/(\d+)$/.exec(path)
  if (m) {
    const pl = PLAYLISTS.find((p) => p.id === Number(m[1]))
    return pl ? json(res, 200, pl) : json(res, 404, { error: '歌单不存在' })
  }
  if (/^\/api\/v1\/playlists\/\d+\/(songs|cover|pin|visibility|sort|touch|reorder)/.test(path)) {
    return path.endsWith('/songs') && req.method === 'POST'
      ? json(res, 200, { added: 1 })
      : json(res, 200, { ok: true })
  }
  if (path === '/api/v1/playlists' && req.method === 'POST') {
    return json(res, 201, { ...PLAYLISTS[3], id: 99, name: '新歌单' })
  }

  if (path === '/api/v1/scan') return noContent(res)
  if (path === '/api/v1/scan/progress') {
    return json(res, 200, {
      status: 'idle',
      current_file: null,
      discovered_files: 0,
      total_files: 0,
      scanned_files: 0,
      imported_files: 0,
      skipped_files: 0,
      failed_files: 0,
      cue_split_sources: 0,
      local_song_count: SONGS.filter((s) => s.type === 'local').length
    })
  }
  if (path === '/api/v1/scan/directories')
    return json(res, 200, { directories: ['/music'], music_path: '/music' })
  if (path === '/api/v1/scan/fingerprints/status') {
    return json(res, 200, {
      chromaprint_available: true,
      total: SONGS.length,
      computed: Math.floor(SONGS.length * 0.8),
      missing: Math.ceil(SONGS.length * 0.2),
      failed: 0,
      auto_enabled: false
    })
  }
  if (path === '/api/v1/settings/music-path') {
    return json(res, 200, { path: '/music', exists: true, song_count: SONGS.length })
  }
  if (path === '/api/v1/settings/volume-normalize') {
    if (req.method === 'PUT') return putVolumeNormalize(req, res)
    return json(res, 200, { ...volumeNormalize })
  }
  // 形状按 endpoints.ts 的读取函数来：三个布尔开关 + 一个枚举。
  // 刻意不都返回 false —— 全 false 时「开关初始状态渲染错了」这种缺陷看不出来。
  if (path === '/api/v1/settings/hls-proxy') return json(res, 200, { enabled: true })
  if (path === '/api/v1/settings/scan-auto-create-playlists')
    return json(res, 200, { enabled: true })
  if (path === '/api/v1/settings/tag-sync-to-file') return json(res, 200, { enabled: false })
  if (path === '/api/v1/settings/scan-title-source')
    return json(res, 200, { title_source: 'filename' })
  if (path.startsWith('/api/v1/configs/'))
    return json(res, 200, { key: path.split('/').pop(), value: '' })

  // 兜底：把未实现的写操作都当成功，避免界面卡在 loading
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? ''))
    return json(res, 200, { ok: true })

  console.warn('[mock] 未命中:', req.method, path)
  return json(res, 404, { error: `mock 未实现: ${req.method} ${path}` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] Songloft mock 后端已启动 http://127.0.0.1:${PORT}（曲库 ${SONGS.length} 首）`)
})
