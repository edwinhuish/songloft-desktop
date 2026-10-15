/**
 * 本地文件。
 *
 * 这一页是「双击音频文件就能播」在界面上的那一半：文件已经进来之后，用户要能看见它、
 * 换一首放、或者再挑几个进来。
 *
 * ★ 它是**全应用唯一不需要登录的内容页**（曲库、歌单、收藏、搜索都读后端，本地文件读的是
 *   本机磁盘）。所以免登录模式进来就落在这里，页面上那条提示也只在这一页出现 ——
 *   既说清「为什么这几个入口是灰的」，也给出回登录页的那条路。
 *
 * ★ 刻意不复用 SongTable：那张表是为**曲库里的歌**做的（收藏、加入歌单、从曲库删除、
 *   查看歌手专辑、拖到侧栏歌单…全都要经后端），而这里每一首都不在曲库里。与其传一堆
 *   「关掉这个关掉那个」的开关进去，不如照它的样子写一张只有本地文件才有的表
 *   （共用 .song-table / .song-row 那套样式，观感仍然是一张表）。
 */

import { useState } from 'react'

import {
  IconFolderOpen,
  IconMusic,
  IconPause,
  IconPlay,
  IconServer,
  IconTrash
} from '@/components/Icons'
import { EmptyState } from '@/components/primitives'
import { useAuth } from '@/state/useAuth'
import { useLocalFiles, playLocalFileAt, pickLocalFiles } from '@/state/useLocalFiles'
import { usePlayer } from '@/state/usePlayer'
import { toast } from '@/state/useToasts'

/** 列宽（与 SongTable 同一个写法：grid 轨道直接写进 style） */
const GRID = '38px minmax(220px, 3fr) 84px 112px'

export function LocalFilesPage(): React.JSX.Element {
  const songs = useLocalFiles((s) => s.songs)
  const remove = useLocalFiles((s) => s.remove)
  const clear = useLocalFiles((s) => s.clear)
  const guest = useAuth((s) => s.guest)
  const leaveGuest = useAuth((s) => s.leaveGuest)
  const currentId = usePlayer((s) =>
    s.cursor >= 0 && s.cursor < s.order.length ? (s.queue[s.order[s.cursor]]?.id ?? null) : null
  )
  const playing = usePlayer((s) => s.playing)
  const toggle = usePlayer((s) => s.toggle)
  /** 文件框开着的时候把按钮按下去 —— 挑大文件/多选时对话框可能停一会儿 */
  const [picking, setPicking] = useState(false)

  const openPicker = async (): Promise<void> => {
    setPicking(true)
    try {
      await pickLocalFiles()
    } catch (error) {
      toast('打开文件失败', 'error', error instanceof Error ? error.message : undefined)
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title row" style={{ gap: 10 }}>
            <IconMusic size={24} />
            本地文件
          </h1>
          <p className="page-subtitle">
            {songs.length === 0
              ? '打开本机的音频文件直接播放，不需要连接服务器'
              : `共 ${songs.length} 个文件 · 双击任意一行开始播放`}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={picking}
            onClick={() => void openPicker()}
          >
            <IconFolderOpen size={15} />
            打开文件…
          </button>
          <button
            type="button"
            className="btn"
            disabled={songs.length === 0}
            onClick={() => playLocalFileAt(0)}
          >
            <IconPlay size={15} />
            播放全部
          </button>
          <button
            type="button"
            className="btn"
            data-variant="danger"
            disabled={songs.length === 0}
            onClick={() => {
              clear()
              toast('已清空本地文件列表', 'success')
            }}
          >
            <IconTrash size={15} />
            清空列表
          </button>
        </div>
      </div>

      {guest ? (
        <div className="probe-result" style={{ marginBottom: 14 }}>
          <span>
            当前是免登录模式：曲库、歌单、收藏与搜索都需要连接服务器，本地文件的播放不受影响。
          </span>
          <button type="button" className="btn" data-size="sm" onClick={leaveGuest}>
            <IconServer size={15} />
            连接服务器
          </button>
        </div>
      ) : null}

      {songs.length === 0 ? (
        <EmptyState
          icon={<IconMusic size={26} />}
          title="还没有打开过本地文件"
          description="也可以直接把音频文件拖到应用图标上、或用系统里「用 Songloft Desktop 打开」—— 双击即播，不必登录"
          action={
            <button
              type="button"
              className="btn"
              data-variant="primary"
              disabled={picking}
              onClick={() => void openPicker()}
            >
              <IconFolderOpen size={15} />
              打开文件…
            </button>
          }
        />
      ) : (
        <div className="song-table">
          <div className="song-head" style={{ gridTemplateColumns: GRID }}>
            <div>#</div>
            <div>文件</div>
            <div>格式</div>
            <div style={{ textAlign: 'right' }}>操作</div>
          </div>

          {songs.map((song, index) => {
            const current = song.id === currentId
            return (
              <div
                key={`${song.id}-${index}`}
                className="song-row"
                style={{ gridTemplateColumns: GRID }}
                data-current={current}
                onDoubleClick={() => playLocalFileAt(index)}
              >
                <div className="song-index">
                  <span className="song-index-num">{index + 1}</span>
                  <button
                    type="button"
                    className="song-index-play"
                    aria-label={current && playing ? '暂停' : '播放'}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (current) void toggle()
                      else playLocalFileAt(index)
                    }}
                  >
                    {current && playing ? <IconPause size={13} /> : <IconPlay size={13} />}
                  </button>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div className="song-title truncate">{song.title}</div>
                  {/* 同名文件（不同目录）只能靠路径区分 —— 标题那一行放不下，缀在下面 */}
                  <div className="song-cell truncate" style={{ fontSize: 12 }}>
                    {song.file_path}
                  </div>
                </div>

                <div className="song-cell">
                  {song.format ? <span className="badge">{song.format.toUpperCase()}</span> : null}
                </div>

                <div className="song-actions" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="icon-btn"
                    data-tip="从列表移除（不影响正在播放的队列）"
                    aria-label={`移除 ${song.title}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (song.file_path) remove([song.file_path])
                    }}
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
