/**
 * 曲库页 = 外壳（标题 +「曲库 / 文件夹」标签条）+ 两种模式各自的内容。
 *
 * 「曲库」与「文件夹」本来就是同一批歌的两种切法（按标签筛 / 按目录钻），所以并成一页。
 *
 * ★ 底下仍然是**两条路由**（library / folders），而不是一个组件内的 state：
 *   文件夹要能带着当前目录深链、面包屑要能一段段跳回去，局部 state 表达不了这些
 *   （刷新窗口或后退就丢）；主进程菜单、命令面板也都是按路由打的。
 *   所以这一页只负责标签条与标题，模式内容各自成块（LibraryView / FoldersView）。
 *
 * 曲库模式（LibraryView）做了三件原 Flutter 端没做好的事：
 *   1. **分面浏览就在同一页**：歌手/专辑/流派/语种/风格 五个维度用 chip 切换，
 *      点卡片直接落成筛选条件（真·服务端过滤），而不是跳去另一个页面再用关键词搜。
 *   2. **筛选条件可视化**：生效的筛选条件以 chip 形式挂在表头上，一眼看到"现在在看什么"，
 *      点 × 就地解除。
 *   3. **批量操作区分「行选中」与「全选当前筛选」**：前者能播能排队，后者只做 id 级动作。
 */

import { useCallback, useMemo, useState } from 'react'

import type { FacetField, Song, SongType } from '@shared/types'
import { FACET_LABELS } from '@shared/types'
import {
  IconClose,
  IconPlay,
  IconRefresh,
  IconSearch,
  IconSparkle,
  IconUpload
} from '@/components/Icons'
import { CardGridSkeleton, Cover, EmptyState } from '@/components/primitives'
import { SelectionBar } from '@/components/SelectionBar'
import { LIBRARY_COLUMNS, SongTable, type SongSort } from '@/components/SongTable'
import { getFacets } from '@/api/endpoints'
import { useAsync } from '@/hooks/useAsync'
import { useSongList } from '@/hooks/useSongList'
import { requireClient } from '@/state/useAuth'
import { usePlayer } from '@/state/usePlayer'
import { useUi, type NativeRoute } from '@/state/useUi'
import { FoldersView } from './FoldersView'

const TYPE_OPTIONS: { value: SongType | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'local', label: '本地' },
  { value: 'remote', label: '网络' },
  { value: 'radio', label: '电台' }
]

const BROWSE_FIELDS: FacetField[] = ['artist', 'album', 'genre', 'language', 'style']

/** 本页的两条路由（两个页面槽，各留一份实例：见 App 的 PAGE_SLOTS） */
type LibraryRoute = Extract<NativeRoute, { name: 'library' | 'folders' }>

/**
 * @param route 由页面槽传进来，**不是**自己从 useUi 里读「当前路由」：这一页在槽里常驻
 *   （library 与 folders 各一份实例），不活跃的那一份读到的「当前路由」已经属于别人了 ——
 *   拿它渲染会让留在 DOM 里的这一页跟着变脸（曲库槽里画出文件夹、反之亦然），
 *   而它本该停在用户离开时的样子；更要紧的是「曲库」那一半的筛选条件会跟着一起丢。
 */
export function LibraryPage({ route }: { route: LibraryRoute }): React.JSX.Element {
  const navigate = useUi((s) => s.navigate)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">曲库</h1>
        {/* 视图切换（不是筛选）：所以走 .segmented，而不是筛选区那种 chip */}
        <div className="segmented" role="group" aria-label="曲库视图">
          <button
            type="button"
            aria-pressed={route.name !== 'folders'}
            onClick={() => navigate({ name: 'library' })}
          >
            曲库
          </button>
          <button
            type="button"
            aria-pressed={route.name === 'folders'}
            onClick={() => navigate({ name: 'folders', path: '' })}
          >
            文件夹
          </button>
        </div>
      </div>

      {route.name === 'folders' ? <FoldersView path={route.path} /> : <LibraryView />}
    </div>
  )
}

/** 「曲库」模式：类型筛选 + 分面浏览 + 歌曲表 */
function LibraryView(): React.JSX.Element {
  const navigate = useUi((s) => s.navigate)
  const playSongs = usePlayer((s) => s.playSongs)

  const [type, setType] = useState<SongType | 'all'>('all')
  const [showHidden, setShowHidden] = useState(false)
  const [filters, setFilters] = useState<Partial<Record<FacetField, string>>>({})
  const [browseField, setBrowseField] = useState<FacetField>('artist')
  const [browsing, setBrowsing] = useState(false)
  const [sort, setSort] = useState<SongSort | null>({ field: 'added_at', order: 'desc' })
  const [selection, setSelection] = useState<number[]>([])
  const [selectAllIds, setSelectAllIds] = useState<number[] | null>(null)

  const query = useMemo(
    () => ({
      type,
      exclude_playlist_labels: showHidden ? 'none' : undefined,
      artist: filters.artist,
      album: filters.album,
      genre: filters.genre,
      language: filters.language,
      style: filters.style,
      sort: sort?.field,
      order: sort?.order
    }),
    [type, showHidden, filters, sort]
  )

  const list = useSongList(query, 200)
  const facets = useAsync(
    () => getFacets(requireClient(), browseField, { limit: 60, sort: 'count', order: 'desc' }),
    [browseField]
  )

  const activeFilters = Object.entries(filters).filter(([, v]) => Boolean(v)) as [
    FacetField,
    string
  ][]
  const selectedSongs = useMemo(
    () => selection.map((i) => list.songs[i]).filter((s): s is Song => Boolean(s)),
    [selection, list.songs]
  )

  const clearSelection = useCallback(() => {
    setSelection([])
    setSelectAllIds(null)
  }, [])

  const applyFilter = useCallback((field: FacetField, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }))
    setBrowsing(false)
    setSelection([])
    setSelectAllIds(null)
  }, [])

  const handleSelectAll = useCallback(async () => {
    try {
      const ids = await list.fetchAllIds()
      setSelectAllIds(ids)
      setSelection([])
    } catch {
      /* fetchAllIds 内部已经把错误暴露在 list.error 上，这里不需要额外提示 */
    }
  }, [list])

  const totalForBar = selectAllIds
    ? selectAllIds
    : selection.map((i) => list.songs[i]?.id).filter((x): x is number => x != null)

  return (
    <>
      <div className="row-between" style={{ gap: 14, marginBottom: 14 }}>
        <div className="page-subtitle truncate" style={{ margin: 0, minWidth: 0 }}>
          {list.loading && list.songs.length === 0
            ? '正在读取…'
            : `${list.total} 首${list.total > list.songs.length ? `（已加载 ${list.songs.length}）` : ''}`}
        </div>
        <div className="row" style={{ gap: 8, flex: 'none' }}>
          <button type="button" className="btn" onClick={() => list.refresh()}>
            <IconRefresh size={15} />
            刷新
          </button>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={list.songs.length === 0}
            onClick={() => void playSongs(list.songs, 0, { type: 'library', key: 'all' })}
          >
            <IconPlay size={15} />
            播放全部
          </button>
        </div>
      </div>

      {/* ── 筛选区 ── */}
      <div className="row-between" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="segmented" role="group" aria-label="歌曲类型">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={type === option.value}
              onClick={() => {
                setType(option.value)
                clearSelection()
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn"
            data-size="sm"
            data-variant={showHidden ? 'primary' : 'default'}
            data-tip="包含被隐藏歌单里的歌曲"
            onClick={() => {
              setShowHidden((v) => !v)
              clearSelection()
            }}
          >
            显示隐藏歌单曲目
          </button>
          <button
            type="button"
            className="btn"
            data-size="sm"
            data-variant={browsing ? 'primary' : 'default'}
            onClick={() => setBrowsing((v) => !v)}
          >
            <IconSparkle size={14} />
            分类浏览
          </button>
          <select
            className="input"
            style={{ width: 132, height: 29, fontSize: 12.5 }}
            value={sort ? `${sort.field}:${sort.order}` : 'added_at:desc'}
            onChange={(event) => {
              const [field, order] = event.target.value.split(':')
              setSort({ field: field as SongSort['field'], order: order as 'asc' | 'desc' })
            }}
            data-tip="排序方式"
          >
            <option value="added_at:desc">最近加入</option>
            <option value="added_at:asc">最早加入</option>
            <option value="title:asc">标题 A→Z</option>
            <option value="artist:asc">歌手 A→Z</option>
            <option value="album:asc">专辑 A→Z</option>
            <option value="duration:desc">时长 长→短</option>
            <option value="year:desc">年份 新→旧</option>
          </select>
        </div>
      </div>

      {activeFilters.length > 0 || showHidden || type !== 'all' ? (
        <div className="chip-row" style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>当前筛选</span>
          {type !== 'all' ? (
            <button
              type="button"
              className="chip"
              data-active="true"
              onClick={() => setType('all')}
            >
              {TYPE_OPTIONS.find((o) => o.value === type)?.label}
              <IconClose size={12} />
            </button>
          ) : null}
          {activeFilters.map(([field, value]) => (
            <button
              key={field}
              type="button"
              className="chip"
              data-active="true"
              onClick={() => setFilters((prev) => ({ ...prev, [field]: undefined }))}
            >
              {FACET_LABELS[field]}：{value}
              <IconClose size={12} />
            </button>
          ))}
          {showHidden ? (
            <button
              type="button"
              className="chip"
              data-active="true"
              onClick={() => setShowHidden(false)}
            >
              含隐藏歌单
              <IconClose size={12} />
            </button>
          ) : null}
          <button
            type="button"
            className="chip"
            onClick={() => {
              setFilters({})
              setShowHidden(false)
              setType('all')
            }}
          >
            清空全部
          </button>
        </div>
      ) : null}

      {/* ── 分面网格 ── */}
      {browsing ? (
        <>
          <div className="chip-row" style={{ marginBottom: 16 }}>
            {BROWSE_FIELDS.map((field) => (
              <button
                key={field}
                type="button"
                className="chip"
                data-active={browseField === field}
                onClick={() => setBrowseField(field)}
              >
                {FACET_LABELS[field]}
              </button>
            ))}
          </div>

          {facets.loading ? (
            <CardGridSkeleton cards={12} />
          ) : (facets.data?.facets.length ?? 0) === 0 ? (
            <EmptyState
              icon={<IconSearch size={26} />}
              title={`还没有${FACET_LABELS[browseField]}数据`}
              description="扫描曲库时把标签一并导入，这里才会有内容"
            />
          ) : (
            <div className="card-grid" style={{ marginBottom: 20 }}>
              {facets.data?.facets.map((facet) => (
                <button
                  key={facet.value}
                  type="button"
                  className="card"
                  data-tip={`只看${FACET_LABELS[browseField]}：${facet.value}`}
                  onClick={() => applyFilter(browseField, facet.value)}
                >
                  <div className="card-art">
                    <Cover
                      coverUrl={facet.cover_url}
                      size="100%"
                      radius={0}
                      round={browseField === 'artist'}
                      // 分面就是「一类东西」：歌手走人像，其余（专辑/流派/语种/风格）走歌单那套
                      kind={browseField === 'artist' ? 'artist' : 'playlist'}
                    />
                  </div>
                  <div className="card-title truncate" style={{ textAlign: 'left' }}>
                    {facet.value}
                  </div>
                  <div className="card-meta" style={{ textAlign: 'left' }}>
                    {facet.count} 首
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ── 歌曲表 ── */}
      {list.error ? (
        <div className="probe-result" data-state="error" style={{ marginBottom: 14 }}>
          <span>{list.error}</span>
          <button type="button" className="btn" data-size="sm" onClick={() => list.refresh()}>
            重试
          </button>
        </div>
      ) : null}

      <SongTable
        songs={list.songs}
        columns={LIBRARY_COLUMNS}
        loading={list.loading}
        sort={sort}
        onSortChange={setSort}
        onPlayAt={(index) =>
          void playSongs(list.songs, index, { type: 'library', key: JSON.stringify(filters) })
        }
        hasMore={list.hasMore}
        onLoadMore={list.loadMore}
        selection={selection}
        onSelectionChange={(indexes) => {
          setSelection(indexes)
          setSelectAllIds(null)
        }}
        menuOptions={{ onDeleted: (ids) => list.removeSongs(ids) }}
        emptyTitle="没有匹配的歌曲"
        emptyDescription="换个筛选条件，或去「设置 → 曲库」扫描音乐目录"
        emptyAction={
          <button
            type="button"
            className="btn"
            data-variant="primary"
            onClick={() => navigate({ name: 'settings', section: 'library' })}
          >
            <IconUpload size={15} />
            去扫描曲库
          </button>
        }
      />

      {list.songs.length > 0 && selection.length === 0 && !selectAllIds ? (
        <div className="load-more">
          <button
            type="button"
            className="btn"
            data-size="sm"
            data-variant="ghost"
            onClick={() => void handleSelectAll()}
          >
            全选当前筛选（{list.total} 首）
          </button>
        </div>
      ) : null}

      {selectAllIds || selection.length > 0 ? (
        <SelectionBar
          ids={totalForBar}
          songs={selectAllIds ? undefined : selectedSongs}
          selectAll={Boolean(selectAllIds)}
          selectAllTotal={selectAllIds?.length}
          onClear={clearSelection}
          onRemoved={(ids) => {
            list.removeSongs(ids)
            clearSelection()
          }}
        />
      ) : null}
    </>
  )
}
