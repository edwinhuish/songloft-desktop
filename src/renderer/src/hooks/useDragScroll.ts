/**
 * 按住横向拖动来滚动（鼠标左键）。
 *
 * 三件事必须一起做，少一件「拖」就会变成「点」：
 *   * **超阈值才算拖动**：按下不动就是普通点击，行内按钮（如封面上的播放键）照常工作。
 *     阈值内也刻意**不** capture 指针 —— 一 capture，后续指针事件连配套的 click
 *     都会被重定向，普通点击没必要冒这个险。
 *   * **拖过之后吃掉那次 click**：松开时浏览器仍会补一个 click，它的落点由**按下位置**
 *     决定，与中间拖到哪儿无关 —— 不拦掉的话，横向拖一下就会顺带播放。
 *   * **只接管鼠标**：触摸/触控板的横向手势交给浏览器原生平移，两边一起动只会打架。
 *
 * 返回的 `dragging` 供调用方切换光标（grab ↔ grabbing）。
 */

import { useEffect, useRef, useState } from 'react'

export function useDragScroll(threshold = 5): {
  ref: React.RefObject<HTMLDivElement | null>
  dragging: boolean
} {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let pointerId: number | null = null
    let startX = 0
    let startScroll = 0
    let moved = false

    const onDown = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      pointerId = event.pointerId
      startX = event.clientX
      startScroll = el.scrollLeft
      // 每次按下都重置：上一次拖动留下的标记不能吃掉这一次的正常点击
      moved = false
    }

    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return
      const delta = event.clientX - startX
      if (!moved) {
        if (Math.abs(delta) < threshold) return
        moved = true
        setDragging(true)
        // 到这一步已经确定是拖动：捕获指针，拖出行外也继续跟手
        el.setPointerCapture(event.pointerId)
      }
      el.scrollLeft = startScroll - delta
    }

    const onUp = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
      pointerId = null
      setDragging(false)
    }

    const onClick = (event: MouseEvent): void => {
      if (!moved) return
      event.preventDefault()
      event.stopPropagation()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    // 捕获阶段拦：不能让这次 click 落到卡片或按钮上
    el.addEventListener('click', onClick, true)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('click', onClick, true)
    }
  }, [threshold])

  return { ref, dragging }
}
