/**
 * 侧栏导航。
 *
 * 相对 Flutter 端的改进：
 *   * 歌单列表直接嵌在侧栏（原实现歌单在「曲库」二级页面里，切歌单要来回跳）
 *   * 支持把歌曲行**拖到**侧栏歌单上直接加入（拖拽时目标歌单高亮）
 *   * 可折叠成图标条，给宽表腾出空间
 */

import { useEffect, useState } from 'react'

import {
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconHeart,
  IconHome,
  IconLibrary,
  IconListMusic,
  IconPlus
} from './Icons'
import { openMenuFromEvent } from './ContextMenu'
import { regularPlaylists, usePlaylists } from '@/state/usePlaylists'
import { useSettings } from '@/state/useSettings'
import { useUi } from '@/state/useUi'
import { useToasts } from '@/state/useToasts'
import { Cover } from './primitives'
import { TIP_ATTR, TIP_PLACE_ATTR } from './Tooltip'

export function Sidebar(): React.JSX.Element {
  const { route, navigate, sidebarCollapsed, toggleSidebar } = useUi()
  /**
   * 折叠态只剩图标，名字改由全局浮层交代（见 Tooltip.tsx：浮层必须渲染到滚动容器之外，
   * 否则会被歌单列表的 overflow 剪掉）；展开态文字就摆在那儿，**什么都不挂**。
   *
   * 浮层与全应用其余提示是同一套（`data-tip`），行为与配色只有一份。
   */
  const tip = (label: string): { [TIP_ATTR]?: string; [TIP_PLACE_ATTR]?: string } =>
    // 侧栏是唯一例外：往右弹（见 PLACE_ORDER 的说明），所以显式指定方位
    sidebarCollapsed ? { [TIP_ATTR]: label, [TIP_PLACE_ATTR]: 'right' } : {}
  const { playlists, load, create } = usePlaylists()
  const { patch } = useSettings()
  const push = useToasts((s) => s.push)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const regular = regularPlaylists(playlists)
  const count = playlists.length

  const isActive = (name: string, extra?: (r: typeof route) => boolean): boolean => {
    if (route.name === name) return true
    return extra ? extra(route) : false
  }

  const handleCreate = async (): Promise<void> => {
    const playlist = await create({ type: 'normal', name: '新建歌单' })
    if (playlist) navigate({ name: 'playlist', id: playlist.id })
  }

  return (
    <nav className="sidebar" data-collapsed={sidebarCollapsed} aria-label="主导航">
      {/* 顺序与左上角折叠菜单一致（浏览在前、收藏与历史居中）。
          ★ 侧栏刻意**没有**设置项：设置只在折叠菜单里，两处各留一份入口只会漂移 */}
      <div className="nav-group">
        <button
          type="button"
          className="nav-item"
          aria-current={isActive('home')}
          onClick={() => navigate({ name: 'home' })}
          {...tip('首页')}
        >
          <IconHome size={18} />
          <span className="nav-text">首页</span>
        </button>

        {/* 「文件夹」是曲库页里的一个标签（不是独立入口），所以进文件夹模式时这里照样高亮 */}
        <button
          type="button"
          className="nav-item"
          aria-current={isActive('library', (r) => r.name === 'folders')}
          onClick={() => navigate({ name: 'library' })}
          {...tip('曲库')}
        >
          <IconLibrary size={18} />
          <span className="nav-text">曲库</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={isActive('playlists', (r) => r.name === 'playlist')}
          onClick={() => navigate({ name: 'playlists' })}
          {...tip('歌单')}
        >
          <IconListMusic size={18} />
          <span className="nav-text">歌单</span>
          <span className="nav-count">{count || ''}</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={isActive('favorites')}
          onClick={() => navigate({ name: 'favorites' })}
          {...tip('我喜欢')}
        >
          <IconHeart size={18} filled={route.name === 'favorites'} />
          <span className="nav-text">我喜欢</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={isActive('recent')}
          onClick={() => navigate({ name: 'recent' })}
          {...tip('最近播放')}
        >
          <IconClock size={18} />
          <span className="nav-text">最近播放</span>
        </button>
      </div>

      <div className="nav-group">
        {/* 标题与「+」始终渲染，由 CSS 在折叠态淡出：条件渲染的话它们会在列宽
            还没收完时先一步消失，「弹一下」的观感正是这么来的 */}
        <div className="nav-section-head">
          <span className="nav-label">我的歌单</span>
          <button
            type="button"
            className="icon-btn nav-section-add"
            {...tip('新建歌单')}
            aria-label="新建歌单"
            onClick={() => void handleCreate()}
          >
            <IconPlus size={15} />
          </button>
        </div>

        <div className="sidebar-playlists">
          {regular.length === 0 ? (
            <div className="nav-empty">
              还没有歌单
              <br />
              点右上角 + 新建
            </div>
          ) : null}

          {regular.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className="nav-item"
              aria-current={route.name === 'playlist' && route.id === playlist.id}
              data-drop={dropTarget === playlist.id}
              {...tip(playlist.name)}
              onClick={() => navigate({ name: 'playlist', id: playlist.id })}
              onContextMenu={(event) =>
                openMenuFromEvent(event, [
                  {
                    key: 'open',
                    label: '打开歌单',
                    onClick: () => navigate({ name: 'playlist', id: playlist.id })
                  },
                  {
                    key: 'pin',
                    label: playlist.pinned_at ? '取消置顶' : '置顶',
                    onClick: () =>
                      void usePlaylists.getState().setPinned(playlist.id, !playlist.pinned_at)
                  }
                ])
              }
              onDragOver={(event) => {
                // 只有从歌曲行拖来的数据才接受，否则内部拖动会误触
                if (!event.dataTransfer.types.includes('application/x-songloft-songs')) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                setDropTarget(playlist.id)
              }}
              onDragLeave={() =>
                setDropTarget((current) => (current === playlist.id ? null : current))
              }
              onDrop={(event) => {
                const raw = event.dataTransfer.getData('application/x-songloft-songs')
                setDropTarget(null)
                if (!raw) return
                event.preventDefault()
                try {
                  const ids = JSON.parse(raw) as number[]
                  void usePlaylists
                    .getState()
                    .addSongs(playlist.id, ids)
                    .then((result) => {
                      push(
                        result.skipped > 0
                          ? `已加入「${playlist.name}」${result.added} 首，跳过 ${result.skipped} 首`
                          : `已加入「${playlist.name}」${result.added} 首`,
                        'success'
                      )
                    })
                    .catch(() => push('加入歌单失败', 'error'))
                } catch {
                  push('无法解析拖拽内容', 'error')
                }
              }}
            >
              <Cover
                coverUrl={playlist.cover_url}
                width={48}
                size={26}
                radius={6}
                kind="playlist"
                seed={playlist.name}
                className="nav-cover"
              />
              <span className="nav-text truncate grow">{playlist.name}</span>
              <span className="nav-count">{playlist.song_count || ''}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-foot">
        <button
          type="button"
          className="nav-item"
          onClick={() => {
            const next = !sidebarCollapsed
            toggleSidebar()
            void patch({ sidebarCollapsed: next })
          }}
          {...tip(sidebarCollapsed ? '展开侧栏' : '收起侧栏')}
        >
          {sidebarCollapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
          {/* 文字要跟着状态走：折叠着还写「收起侧栏」是自相矛盾的 */}
          <span className="nav-text">{sidebarCollapsed ? '展开侧栏' : '收起侧栏'}</span>
        </button>
      </div>
    </nav>
  )
}
