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
  IconPlus,
  IconSettings,
  IconSparkle
} from './Icons'
import { openMenuFromEvent } from './ContextMenu'
import { usePlaylists } from '@/state/usePlaylists'
import { useSettings } from '@/state/useSettings'
import { useUi } from '@/state/useUi'
import { useToasts } from '@/state/useToasts'
import { Cover } from './primitives'

export function Sidebar(): React.JSX.Element {
  const { route, navigate, sidebarCollapsed, toggleSidebar } = useUi()
  const { playlists, load, create } = usePlaylists()
  const { settings, patch } = useSettings()
  const push = useToasts((s) => s.push)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const regularPlaylists = playlists.filter((p) => p.type === 'normal' && !p.labels.includes('built_in'))
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
          title="首页"
        >
          <IconHome size={18} />
          <span className="nav-text">首页</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={route.name === 'library' || route.name === 'folders'}
          onClick={() => navigate({ name: 'library' })}
          title="曲库"
        >
          <IconLibrary size={18} />
          <span className="nav-text">曲库</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={isActive('favorites')}
          onClick={() => navigate({ name: 'favorites' })}
          title="我喜欢的音乐"
        >
          <IconHeart size={18} filled={route.name === 'favorites'} />
          <span className="nav-text">我喜欢的</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={isActive('recent')}
          onClick={() => navigate({ name: 'recent' })}
          title="最近播放"
        >
          <IconClock size={18} />
          <span className="nav-text">最近播放</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={isActive('playlists', (r) => r.name === 'playlist')}
          onClick={() => navigate({ name: 'playlists' })}
          title="歌单"
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
          title="文件夹浏览"
        >
          <IconFolder size={18} />
          <span className="nav-text">文件夹</span>
        </button>
      </div>

      <div className="nav-group" style={{ marginTop: 6 }}>
        <div className="row-between" style={{ padding: '0 4px 0 12px', minHeight: 26 }}>
          {sidebarCollapsed ? null : <span className="nav-label" style={{ padding: 0 }}>我的歌单</span>}
          {sidebarCollapsed ? null : (
            <button
              type="button"
              className="icon-btn"
              style={{ width: 24, height: 24 }}
              title="新建歌单"
              aria-label="新建歌单"
              onClick={() => void handleCreate()}
            >
              <IconPlus size={15} />
            </button>
          )}
        </div>

        <div className="sidebar-playlists">
          {regularPlaylists.length === 0 && !sidebarCollapsed ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-4)', lineHeight: 1.8 }}>
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
              style={{ height: 40 }}
              aria-current={route.name === 'playlist' && route.id === playlist.id}
              data-drop={dropTarget === playlist.id}
              title={playlist.name}
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
                    onClick: () => void usePlaylists.getState().setPinned(playlist.id, !playlist.pinned_at)
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
              onDragLeave={() => setDropTarget((current) => (current === playlist.id ? null : current))}
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
                size={sidebarCollapsed ? 28 : 26}
                radius={6}
              />
              <span className="nav-text truncate grow">{playlist.name}</span>
              {sidebarCollapsed ? null : <span className="nav-count">{playlist.song_count || ''}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-foot">
        {!sidebarCollapsed && settings.activeServerUrl ? (
          <button
            type="button"
            className="nav-item"
            title={settings.activeServerUrl}
            onClick={() => navigate({ name: 'settings', section: 'server' })}
          >
            <IconSparkle size={16} />
            <span className="nav-text truncate">
              {(() => {
                try {
                  return new URL(settings.activeServerUrl).host
                } catch {
                  return settings.activeServerUrl
                }
              })()}
            </span>
          </button>
        ) : null}

        <button
          type="button"
          className="nav-item"
          aria-current={isActive('settings')}
          onClick={() => navigate({ name: 'settings', section: 'appearance' })}
          title="设置"
        >
          <IconSettings size={18} />
          <span className="nav-text">设置</span>
        </button>

        <button
          type="button"
          className="nav-item"
          onClick={() => {
            const next = !sidebarCollapsed
            toggleSidebar()
            void patch({ sidebarCollapsed: next })
          }}
          title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
        >
          {sidebarCollapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
          <span className="nav-text">收起侧栏</span>
        </button>
      </div>
    </nav>
  )
}
