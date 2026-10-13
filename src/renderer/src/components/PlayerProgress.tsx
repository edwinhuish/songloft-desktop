/**
 * 播放进度条。底栏与迷你条共用。
 *
 * 抽出来不是为了少写几行 JSX，而是「拖动期间只动本地 scrub、松手才 seek」那套（连同
 * 左右方向键）**只能有一份** —— 两处各写一遍的话，迟早只有一处还记着「松手才 seek」，
 * 另一处每移动一像素就写一次 audio.currentTime，把解码器的缓冲反复丢掉。
 *
 * 样式名照旧走 `.playerbar-progress*`：两条栏上的进度条本来就是同一条（贴栏顶的 3px 细线，
 * hover / 拖动时变粗到 5px），各起一套类名只会让两处慢慢长得不一样。
 */

import { useRef } from 'react'

import { formatDuration } from '@/lib/format'

export interface PlayerProgressProps {
  /** 总时长（秒）。<= 0 时不可拖 */
  duration: number
  /** 播放器当前的位置（秒） */
  position: number
  /**
   * 拖动中松手前的位置（秒），null = 没在拖。**由调用方持有**：
   * 拖动期间栏上那行「已播 / 总长」也要跟着走，那份值在调用方手里。
   */
  scrub: number | null
  onScrub: (seconds: number | null) => void
  onSeek: (seconds: number) => void
  onSeekBy: (delta: number) => void
}

export function PlayerProgress({
  duration,
  position,
  scrub,
  onScrub,
  onSeek,
  onSeekBy
}: PlayerProgressProps): React.JSX.Element {
  // ★ 用 ref 而不是用 scrub 判「是否在拖」：pointermove 的闭包拿到的可能还是上一帧的 state
  const scrubbing = useRef(false)

  /** 指针横坐标 → 秒 */
  const secondsAt = (clientX: number, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  const beginScrub = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (duration <= 0) return
    event.preventDefault()
    scrubbing.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    onScrub(secondsAt(event.clientX, event.currentTarget))
  }

  const moveScrub = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!scrubbing.current) return
    onScrub(secondsAt(event.clientX, event.currentTarget))
  }

  const endScrub = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!scrubbing.current) return
    scrubbing.current = false
    const target = secondsAt(event.clientX, event.currentTarget)
    onScrub(null)
    onSeek(target)
  }

  const cancelScrub = (): void => {
    if (!scrubbing.current) return
    scrubbing.current = false
    onScrub(null)
  }

  const shown = scrub ?? position

  return (
    /*
      拖动期间只更新本地 scrub，松手才真去 seek —— 见文件头那段说明。
      左右方向键也接上，键盘用户不该只能靠 Ctrl+←/→ 跳曲。
    */
    <div
      className="playerbar-progress"
      role="slider"
      tabIndex={0}
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatDuration(shown)} / ${formatDuration(duration)}`}
      data-dragging={scrub !== null}
      onPointerDown={beginScrub}
      onPointerMove={moveScrub}
      onPointerUp={endScrub}
      onPointerCancel={cancelScrub}
      onKeyDown={(event) => {
        if (duration <= 0) return
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          onSeekBy(5)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onSeekBy(-5)
        }
      }}
    >
      <div className="playerbar-progress-track" />
      <div
        className="playerbar-progress-fill"
        style={{ width: `${duration > 0 ? (shown / duration) * 100 : 0}%` }}
      />
    </div>
  )
}
