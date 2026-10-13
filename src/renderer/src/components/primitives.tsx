/** 复用的小原语：封面、滑条、开关、空态、骨架、加载指示 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { IconLoader, IconMusic } from './Icons'
import { buildCoverUrl } from '@/lib/url'
import { resourceContext } from '@/state/useAuth'

/* ─────────────────────────────── 封面 ─────────────────────────────── */

export interface CoverProps {
  coverUrl: string | null | undefined
  /** 请求的缩略宽度（走后端 `?w=`），按显示尺寸给，别一律要原图 */
  width?: number
  size?: number | string
  radius?: number | string
  round?: boolean
  /** 无封面时显示音符图标 */
  className?: string
  alt?: string
}

export function Cover({
  coverUrl,
  width = 320,
  size = '100%',
  radius = 'var(--r-md)',
  round = false,
  className,
  alt = ''
}: CoverProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  // token 变化（重新登录）后 URL 要跟着变，否则会 401。
  // 解构出两个字符串当依赖：resourceContext() 每次返回新对象，直接依赖它会每帧重算。
  const { baseUrl, accessToken } = resourceContext()
  const src = useMemo(
    () => buildCoverUrl(coverUrl, { baseUrl, accessToken }, width),
    [coverUrl, width, baseUrl, accessToken]
  )

  useEffect(() => setFailed(false), [src])

  const showImage = Boolean(src) && !failed

  return (
    <div
      className={`cover ${className ?? ''}`}
      data-round={round}
      style={{ width: size, height: size, borderRadius: round ? '50%' : radius }}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : (
        <IconMusic size={typeof size === 'number' ? Math.max(16, size * 0.34) : 26} />
      )}
    </div>
  )
}

/* ─────────────────────────────── 滑条 ─────────────────────────────── */

export interface SliderProps {
  value: number
  max: number
  onChange: (value: number) => void
  /** 拖动结束（用于把值写盘/发给后端），不传则只用 onChange */
  onCommit?: (value: number) => void
  className?: string
  ariaLabel: string
  /** 显示在外面的百分比填充，默认按 value/max */
  fillRatio?: number
}

export function Slider({
  value,
  max,
  onChange,
  onCommit,
  className,
  ariaLabel,
  fillRatio
}: SliderProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const ratioFromEvent = useCallback((clientX: number): number => {
    const el = ref.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    ref.current?.setPointerCapture(event.pointerId)
    setDragging(true)
    const ratio = ratioFromEvent(event.clientX)
    onChange(ratio * max)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    onChange(ratioFromEvent(event.clientX) * max)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    ref.current?.releasePointerCapture(event.pointerId)
    setDragging(false)
    const ratio = ratioFromEvent(event.clientX)
    onCommit?.(ratio * max)
  }

  const percent = Math.max(0, Math.min(100, (fillRatio ?? (max > 0 ? value / max : 0)) * 100))

  return (
    <div
      ref={ref}
      className={`slider ${className ?? ''}`}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="slider-track">
        <div className="slider-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="slider-knob" style={{ left: `${percent}%` }} />
    </div>
  )
}

/* ─────────────────────────────── 开关 ─────────────────────────────── */

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}

export function Switch({ checked, onChange, ariaLabel, disabled }: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}

/* ─────────────────────────────── 空态 ─────────────────────────────── */

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <IconMusic size={26} />}</div>
      <div className="empty-title">{title}</div>
      {description ? <div className="empty-desc">{description}</div> : null}
      {action}
    </div>
  )
}

/* ─────────────────────────────── 骨架 ─────────────────────────────── */

export function SongRowsSkeleton({
  rows = 12,
  columns = 5
}: {
  rows?: number
  columns?: number
}): React.JSX.Element {
  // 列数必须跟着真实表走：否则骨架的行高/间距和真表对不上，加载完成时会「跳」一下
  const widths = ['10%', '34%', '70%', '60%', '18%']
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="song-row" style={{ pointerEvents: 'none' }}>
          {Array.from({ length: columns }, (_, c) => (
            <div
              key={c}
              className="skeleton"
              style={{ width: widths[c % widths.length], height: 12, maxWidth: '100%' }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardGridSkeleton({
  cards = 10,
  size
}: {
  cards?: number
  /** 与落地后的网格同档：否则加载中是 158px 的小方块，加载完跳成 240px 的大图 */
  size?: 'lg'
}): React.JSX.Element {
  return (
    <div className="card-grid" data-size={size} aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="card" style={{ pointerEvents: 'none' }}>
          <div className="skeleton" style={{ aspectRatio: '1', borderRadius: 'var(--r-md)' }} />
          <div className="skeleton" style={{ height: 12, width: '76%' }} />
          <div className="skeleton" style={{ height: 10, width: '44%' }} />
        </div>
      ))}
    </div>
  )
}

export function Spinner({ size = 18 }: { size?: number }): React.JSX.Element {
  return <IconLoader size={size} />
}

/* ───────────────────────── 无限滚动触发 ───────────────────────── */

export function InfiniteSentinel({
  onVisible,
  disabled
}: {
  onVisible: () => void
  disabled?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || disabled) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisible()
      },
      { rootMargin: '400px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onVisible, disabled])

  return <div ref={ref} style={{ height: 1 }} />
}
