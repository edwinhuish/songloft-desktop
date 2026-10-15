/**
 * 「正在播放」那块界面上，歌手那一行此刻该说什么。
 *
 * 底栏（components/PlayerBar）与满窗播放（components/FullPlayer）都要说这句话 ——
 * 满窗时底栏被整个盖住，只在底栏说等于「开着满窗就什么都看不到」。两处共用一个 hook，
 * 而不是各写一遍三元表达式：**优先级就是这份行为**，分头写必然漂（一处改了另一处忘）。
 *
 * 优先级：
 *   1. `error` —— 放不出来 / 正在联网找源。最要紧的事，压过其他一切；
 *   2. 「正在获取歌曲信息…」—— 正在补齐元数据，且标题/歌手确实还空着。**必须带上后半个条件**：
 *      库里绝大多数歌的信息是齐的，补齐不会为它们发请求，若无条件显示这句话，
 *      每次起播都会白闪一下（见 state/song-metadata）。
 *   3. `null` —— 一切正常，调用方显示歌手名。
 */

import type { Song } from '@shared/types'
import { filled } from '@shared/metadata'
import { useSongMetadata } from '@/state/song-metadata'

export function useNowPlayingStatus(song: Song | null, error: string | null): string | null {
  const patching = useSongMetadata(
    (state) => state.patching && (song ? state.patchingSongId === song.id : false)
  )

  if (error) return error
  if (song && patching && (!filled(song.title) || !filled(song.artist))) {
    return '正在获取歌曲信息…'
  }
  return null
}
