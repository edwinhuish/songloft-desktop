/**
 * 拖拽携带的数据类型（`dataTransfer` 的 MIME）。
 *
 * 侧栏那一窄条上同时活着两种拖动：把歌曲行**拖进**歌单（加歌）、拖动歌单**自己**（重排）。
 * 两者落在同一批 `.nav-item` 上，只能靠 dataTransfer 的类型分流 —— 字面量散在两个文件里
 * 的话，一处打错就是「拖过去什么都不发生」，而且不报错、不进日志。所以只留这一份。
 */

/** 歌曲行 → 歌单：载荷是歌曲 id 的 JSON 数组（`SongTable` 写、`Sidebar` 读） */
export const SONGS_DRAG_TYPE = 'application/x-songloft-songs'

/** 歌单 → 歌单：载荷是歌单 id（`Sidebar` 自产自销，拖动重排用） */
export const PLAYLIST_DRAG_TYPE = 'application/x-songloft-playlist'
