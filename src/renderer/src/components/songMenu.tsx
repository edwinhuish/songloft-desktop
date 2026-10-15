/**
 * 歌曲操作菜单（右键 / 「更多」按钮共用）。
 *
 * 抽出来是因为同一批操作在四个地方出现：曲库行、歌单行、播放队列、命令面板。
 * 各写一份必然漂移（比如某一处忘了「加入队列」）。
 */

import { isLocalFileSong } from '@shared/local-file'
import type { Song } from '@shared/types'
import type { MenuItem } from './ContextMenu'
import {
  IconDisc,
  IconDownload,
  IconHeart,
  IconListMusic,
  IconPlus,
  IconQueue,
  IconTrash,
  IconUser
} from './Icons'
import { deleteSong, getSongIds } from '@/api/endpoints'
import { usePlayer } from '@/state/usePlayer'
import { usePlaylists } from '@/state/usePlaylists'
import { useUi } from '@/state/useUi'
import { toast } from '@/state/useToasts'
import { requireClient } from '@/state/useAuth'

export interface SongMenuOptions {
  /** 从歌单上下文打开时带上，用于显示「从歌单移除」 */
  playlistId?: number
  /** 移除后通知调用方刷新（歌单详情页用） */
  onRemoved?: (songIds: number[]) => void
  /** 曲库删除后通知调用方 */
  onDeleted?: (songIds: number[]) => void
}

export function buildSongMenuItems(songs: Song[], options: SongMenuOptions = {}): MenuItem[] {
  if (songs.length === 0) return []
  const multi = songs.length > 1
  const ids = songs.map((s) => s.id)
  const first = songs[0]

  const player = usePlayer.getState()
  const ui = useUi.getState()
  const playlistsStore = usePlaylists.getState()
  const allFavorited = songs.every((s) => playlistsStore.isFavorite(s.id))
  const itemLabel = multi ? `已选 ${songs.length} 首` : first.title

  /**
   * 全是「双击打开的那种本地文件」吗（id 为负，见 shared/local-file）。
   *
   * ★ 这批歌的菜单要短一截：加入歌单、收藏、从曲库删除**都要经后端**，而它们根本不在曲库里
   *   —— 点下去只会得到一条失败提示。菜单里少几项，好过摆一堆点不动的。
   */
  const localOnly = songs.every(isLocalFileSong)

  const items: MenuItem[] = [
    { key: 'header', label: itemLabel, header: true },
    {
      key: 'play',
      label: multi ? '播放选中歌曲' : '播放',
      icon: <IconPlus size={15} />,
      onClick: () => void player.playSongs(songs, 0)
    },
    {
      key: 'next',
      label: '下一首播放',
      icon: <IconQueue size={15} />,
      onClick: () => {
        player.addToQueue(songs, 'next')
        toast(`已插入 ${songs.length} 首到下一首播放`, 'success')
      }
    },
    {
      key: 'queue',
      label: '加入播放队列',
      icon: <IconListMusic size={15} />,
      onClick: () => {
        player.addToQueue(songs)
        toast(`已加入队列 ${songs.length} 首`, 'success')
      }
    }
  ]

  if (!localOnly) {
    items.push(
      { key: 'sep-1', label: '', separator: true },
      {
        key: 'playlist',
        label: '加入歌单…',
        icon: <IconListMusic size={15} />,
        onClick: () => ui.setAddToPlaylistTarget(ids)
      },
      {
        key: 'favorite',
        label: allFavorited ? '取消收藏' : '收藏',
        icon: <IconHeart size={15} filled={allFavorited} />,
        onClick: () => {
          // 语义是「整批切到相反状态」：全已收藏 → 全取消；否则 → 全收藏
          const target = !allFavorited
          for (const song of songs) void usePlaylists.getState().setFavorite(song.id, target)
        }
      }
    )
  }

  if (!multi && !localOnly) {
    if (first.artist) {
      items.push({
        key: 'artist',
        label: `查看歌手：${first.artist}`,
        icon: <IconUser size={15} />,
        onClick: () => ui.navigate({ name: 'search', keyword: first.artist ?? '' })
      })
    }
    if (first.album) {
      items.push({
        key: 'album',
        label: `查看专辑：${first.album}`,
        icon: <IconDisc size={15} />,
        onClick: () => ui.navigate({ name: 'search', keyword: first.album ?? '' })
      })
    }
    if (first.url && /^https?:\/\//i.test(first.url)) {
      items.push({
        key: 'source',
        label: '打开源地址',
        icon: <IconDownload size={15} />,
        onClick: () => void window.songloft.shell.openExternal(first.url ?? '')
      })
    }
  }

  if (localOnly) {
    // 本地文件既不进歌单也不进曲库，那两条尾巴都无处可落；菜单到此为止
    return items
  }

  if (options.playlistId != null) {
    items.push(
      { key: 'sep-2', label: '', separator: true },
      {
        key: 'remove',
        label: multi ? `从歌单移除 ${songs.length} 首` : '从歌单移除',
        icon: <IconTrash size={15} />,
        variant: 'danger',
        onClick: async () => {
          const label = options.playlistId === 1 ? '取消收藏' : '从歌单移除'
          for (const id of ids) {
            if (options.playlistId === 1) {
              await usePlaylists.getState().setFavorite(id, false)
            } else {
              await usePlaylists.getState().removeSong(options.playlistId!, id)
            }
          }
          toast(`${label}完成（${songs.length} 首）`, 'success')
          options.onRemoved?.(ids)
        }
      }
    )
  } else {
    items.push(
      { key: 'sep-2', label: '', separator: true },
      {
        key: 'delete',
        label: multi ? `从曲库删除 ${songs.length} 首` : '从曲库删除',
        icon: <IconTrash size={15} />,
        variant: 'danger',
        disabled: songs.some((s) => s.type === 'local'),
        onClick: async () => {
          try {
            await Promise.all(ids.map((id) => deleteSong(requireClient(), id, false)))
            toast(`已从曲库删除 ${ids.length} 首（本地文件保留）`, 'success')
            options.onDeleted?.(ids)
          } catch (error) {
            toast('删除失败', 'error', error instanceof Error ? error.message : undefined)
          }
        }
      }
    )
    if (songs.some((s) => s.type === 'local')) {
      items.push({
        key: 'delete-note',
        label: '本地歌曲受保护，不会被曲库删除',
        header: true
      })
    }
  }

  return items
}

/** 供命令面板 / 批量操作：取当前筛选下的全部 id */
export async function fetchAllSongIds(query: Parameters<typeof getSongIds>[1]): Promise<number[]> {
  return getSongIds(requireClient(), query)
}
