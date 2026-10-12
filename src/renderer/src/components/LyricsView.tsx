/**
 * 歌词视图。
 *
 * 相对 Flutter 端的改进是三处细节：
 *   1. **逐字高亮**：后端 lxlyric 带的 `<mm:ss.xx>` 逐字时间轴直接用上，
 *      当前字比整行高亮精细得多（原实现只在「卡拉OK」页做）；
 *   2. **点行跳转**：点任意一行歌词直接 seek 过去，找段落不用拖进度条；
 *   3. **手动滚动优先**：用户滚歌词时暂停自动归位（否则想看后面几段会被拽回去），
 *      停手 3 秒后恢复跟随。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { findCurrentLine, findCurrentWord, type LyricLine } from '@shared/lyric'
import { usePlayer } from '@/state/usePlayer'
import { useSettings } from '@/state/useSettings'
import { IconLoader } from './Icons'

export function LyricsView({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const lyrics = usePlayer((s) => s.lyrics)
  const loading = usePlayer((s) => s.lyricsLoading)
  const failed = usePlayer((s) => s.lyricFailed)
  const currentTime = usePlayer((s) => s.currentTime)
  const seek = usePlayer((s) => s.seek)
  const settings = useSettings((s) => s.settings)

  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const [userScrolling, setUserScrolling] = useState(false)
  const scrollTimer = useRef<number | null>(null)

  const activeIndex = useMemo(
    () => (lyrics.synced ? findCurrentLine(lyrics.lines, currentTime) : -1),
    [lyrics, currentTime]
  )

  // 用户开始滚 → 暂停跟随；停手 3 秒 → 恢复
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => {
      setUserScrolling(true)
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
      scrollTimer.current = window.setTimeout(() => setUserScrolling(false), 3000)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onScroll)
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
    }
  }, [])

  // 当前行变化时把它滚到容器中部
  useEffect(() => {
    if (userScrolling || activeIndex < 0 || !lyrics.synced) return
    const container = containerRef.current
    const line = activeRef.current
    if (!container || !line) return
    const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeIndex, userScrolling, lyrics.synced])

  if (loading) {
    return (
      <div className="lyrics-empty">
        <IconLoader size={20} />
        <div style={{ marginTop: 10 }}>正在加载歌词…</div>
      </div>
    )
  }

  if (lyrics.lines.length === 0) {
    return (
      <div className="lyrics-empty">
        {failed ? (
          <>
            歌词加载失败
            <br />
            可以在歌曲菜单里手动指定歌词
          </>
        ) : (
          <>
            这首歌还没有歌词
            <br />
            安装「歌词搜索」插件后会自动补全
          </>
        )}
      </div>
    )
  }

  const activeLine = activeIndex >= 0 ? lyrics.lines[activeIndex] : null
  const activeWordIndex = activeLine?.words.length ? findCurrentWord(activeLine.words, currentTime) : -1

  return (
    <div ref={containerRef} className="lyrics" style={{ fontSize: compact ? settings.lyricFontSize * 0.85 : settings.lyricFontSize }}>
      {lyrics.lines.map((line, index) => (
        <LyricRow
          key={`${line.time}-${index}`}
          line={line}
          active={index === activeIndex}
          activeWordIndex={index === activeIndex ? activeWordIndex : -1}
          showTranslation={settings.lyricShowTranslation}
          showRoman={settings.lyricShowRoman}
          synced={lyrics.synced}
          onClick={() => {
            if (lyrics.synced) seek(line.time)
          }}
          ref={index === activeIndex ? activeRef : undefined}
        />
      ))}
    </div>
  )
}

interface LyricRowProps {
  line: LyricLine
  active: boolean
  activeWordIndex: number
  showTranslation: boolean
  showRoman: boolean
  synced: boolean
  onClick: () => void
  ref?: React.Ref<HTMLDivElement>
}

function LyricRow({
  line,
  active,
  activeWordIndex,
  showTranslation,
  showRoman,
  synced,
  onClick,
  ref
}: LyricRowProps): React.JSX.Element {
  return (
    <div
      ref={ref}
      className="lyric-line"
      data-active={active}
      style={{ cursor: synced ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <div className="lyric-main">
        {line.words.length > 0 ? (
          line.words.map((word, i) => (
            <span key={`${word.time}-${i}`} className="lyric-word" data-sung={i <= activeWordIndex && active}>
              {word.text}
            </span>
          ))
        ) : (
          <>{line.text}</>
        )}
      </div>
      {showRoman && line.roman ? <div className="lyric-roman">{line.roman}</div> : null}
      {showTranslation && line.translation ? <div className="lyric-translation">{line.translation}</div> : null}
    </div>
  )
}
