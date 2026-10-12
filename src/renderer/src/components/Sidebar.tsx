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
  IconFolder,
  IconHeart,
  IconHome,
  IconLibrary,
  IconListMusic,
  IconPlus
} from './Icons'
import { openMenuFromEvent } from './ContextMenu'
import { usePlaylists } from '@/state/usePlaylists'
import { useSettings } from '@/state/useSettings'
import { useUi } from '@/state/useUi'
import { useToasts } from '@/state/useToasts'
import { Cover } from './primitives'

/** 折叠态用自绘 tooltip（data-tip），展开态退回原生 title */
type NavTip = { 'data-tip'?: string; title?: string }

/**
 * 折叠态只剩图标，菜单名改由自绘 tooltip 交代：原生 title 有约一秒延迟、样式由系统
 * 决定，在这套深色界面里很突兀，两边同时开着还会先后弹出两个。展开态文字可见，仍留
 * title —— 歌单名被截断时它是唯一的兜底。
 */
function navTip(label: string, collapsed: boolean): NavTip {
  return collapsed ? { 'data-tip': label } : { title: label }
}

export function Sidebar(): React.JSX.Element {
  const { route, navigate, sidebarCollapsed, toggleSidebar } = useUi()
  const tip = (label: string): NavTip => navTip(label, sidebarCollapsed)
  const { playlists, load, create } = usePlaylists()
  const { patch } = useSettings()
  const push = useToasts((s) => s.push)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const regularPlaylists = playlists.filter(
    (p) => p.type === 'normal' && !p.labels.includes('built_in')
  )
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

        <button
          type="button"
          className="nav-item"
          aria-current={route.name === 'library' || route.name === 'folders'}
          onClick={() => navigate({ name: 'library' })}
          {...tip('曲库')}
        >
          <IconLibrary size={18} />
          <span className="nav-text">曲库</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={isActive('favorites')}
          onClick={() => navigate({ name: 'favorites' })}
          {...tip('我喜欢的音乐')}
        >
          <IconHeart size={18} filled={route.name === 'favorites'} />
          <span className="nav-text">我喜欢的</span>
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
          aria-current={isActive('folders')}
          onClick={() => navigate({ name: 'folders', path: '' })}
          {...tip('文件夹浏览')}
        >
          <IconFolder size={18} />
          <span className="nav-text">文件夹</span>
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
            title="新建歌单"
            aria-label="新建歌单"
            onClick={() => void handleCreate()}
          >
            <IconPlus size={15} />
          </button>
        </div>

        <div className="sidebar-playlists">
          {regularPlaylists.length === 0 ? (
            <div className="nav-empty">
              还没有歌单
              <br />
              点右上角 + 新建
            </div>
          ) : null}

          {regularPlaylists.map((playlist) => (
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
