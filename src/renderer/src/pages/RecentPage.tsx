/**
 * 最近播放。
 *
 * 数据源是本机偏好里的 `recentSongIds`（播放成功时写，最多 200 条），
 * 不是后端的播放历史 —— 理由：后端的 `/play-history` 是**按上下文**存的
 * （每个歌单/歌手各自一份），没有一个「全局最近播放」的入口，
 * 而桌面端用户想要的就是「我刚才听过什么」。
 *
 * 代价是这里要按 id 反查歌曲详情，所以做了两件事：
 *   * 只取最近 50 条，滚到底再追加（不是一次性拉 200 个请求）
 *   * 并发限 8（见 lib/concurrency.ts）
 */

import { useCallback, useMemo, useState } from 'react'

import type { Song } from '@shared/types'
import { IconClock, IconPlay, IconRefresh, IconTrash } from '@/components/Icons'
import { COMPACT_COLUMNS, SongTable } from '@/components/SongTable'
import { useAsync } from '@/hooks/useAsync'
import { mapLimit } from '@/lib/concurrency'
import { requireClient } from '@/state/useAuth'
import { usePlayer } from '@/state/usePlayer'
import { useSettings } from '@/state/useSettings'
import { useUi } from '@/state/useUi'
import { toast } from '@/state/useToasts'

const PAGE = 50

export function RecentPage(): React.JSX.Element {
  const navigate = useUi((s) => s.navigate)
  const playSongs = usePlayer((s) => s.playSongs)
  const recentIds = useSettings((s) => s.settings.recentSongIds)
  const patch = useSettings((s) => s.patch)
  const [limit, setLimit] = useState(PAGE)

  const visibleIds = useMemo(() => recentIds.slice(0, limit), [recentIds, limit])
  const idsKey = visibleIds.join(',')

  const result = useAsync(async () => {
    if (visibleIds.length === 0) return { songs: [] as Song[], missing: [] as number[] }
    const songs = await mapLimit(visibleIds, 8, (id) =>
      requireClient()
        .request<Song>(`/songs/${id}`)
        .catch(() => null)
    )
    // 后端可能已经删掉某些歌：把失效的 id 一起带回去，方便顺手清掉
    const missing = visibleIds.filter((_, index) => songs[index] === null)
    return { songs: songs.filter((s): s is Song => s !== null), missing }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const songs = result.data?.songs ?? []

  const removeEntries = useCallback(
    (ids: number[]) => {
      const remove = new Set(ids)
      void patch({ recentSongIds: recentIds.filter((id) => !remove.has(id)) })
    },
    [patch, recentIds]
  )

  const clearAll = useCallback(() => {
    void patch({ recentSongIds: [] })
    toast('已清空最近播放', 'success')
  }, [patch])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title row" style={{ gap: 10 }}>
            <IconClock size={24} />
            最近播放
          </h1>
          <p className="page-subtitle">
            {recentIds.length === 0 ? '还没有播放记录' : `共 ${recentIds.length} 条记录（显示最近 ${visibleIds.length} 条）`}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => result.reload()}>
            <IconRefresh size={15} />
            刷新
          </button>
          <button
            type="button"
            className="btn"
            disabled={recentIds.length === 0}
            onClick={() => void playSongs(songs, 0, { type: 'recent', key: 'local' })}
            data-variant={songs.length > 0 ? 'primary' : 'default'}
          >
            <IconPlay size={15} />
            播放全部
          </button>
          <button type="button" className="btn" data-variant="danger" disabled={recentIds.length === 0} onClick={clearAll}>
            <IconTrash size={15} />
            清空历史
          </button>
        </div>
      </div>

      {result.data && result.data.missing.length > 0 ? (
        <div className="probe-result" style={{ marginBottom: 14 }}>
          <span>有 {result.data.missing.length} 首歌已从曲库删除，可直接从记录里清掉</span>
          <button type="button" className="btn" data-size="sm" onClick={() => removeEntries(result.data!.missing)}>
            清理失效记录
          </button>
        </div>
      ) : null}

      <SongTable
        songs={songs}
        columns={COMPACT_COLUMNS}
        loading={result.loading}
        onPlayAt={(index) => void playSongs(songs, index, { type: 'recent', key: 'local' })}
        extraMenuItems={(song) => [
          {
            key: 'forget',
            label: '从最近播放里移除',
            icon: <IconTrash size={15} />,
            onClick: () => removeEntries([song.id])
          }
        ]}
        emptyTitle="还没有播放记录"
        emptyDescription="播放过的歌会自动出现在这里（最多保留 200 条）"
        emptyAction={
          <button type="button" className="btn" onClick={() => navigate({ name: 'library' })}>
            去曲库
          </button>
        }
      />

      {visibleIds.length < recentIds.length ? (
        <div className="load-more">
          <button type="button" className="btn" data-size="sm" onClick={() => setLimit((v) => v + PAGE)}>
            再显示 {Math.min(PAGE, recentIds.length - visibleIds.length)} 条
          </button>
        </div>
      ) : null}
    </div>
  )
}
