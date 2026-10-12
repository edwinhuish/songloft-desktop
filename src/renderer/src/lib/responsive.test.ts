/**
 * 迟滞判定的单测。
 *
 * 为什么值得单独测：这段逻辑出错的表现是「窗口停在阈值附近时侧栏来回抽风」，
 * 在真实窗口里很难稳定复现（取决于拖动的速度与方向），但它的本质只是一条
 * 边界规则 —— 那就用用例把边界两侧各钉一颗钉子。
 */

import { describe, expect, it } from 'vitest'

import { nextNarrow, SIDEBAR_COLLAPSE_BELOW, SIDEBAR_EXPAND_ABOVE } from './responsive'

describe('nextNarrow', () => {
  it('明显比阈值窄 → 算窄', () => {
    expect(nextNarrow(SIDEBAR_COLLAPSE_BELOW - 1, false)).toBe(true)
    expect(nextNarrow(1080, false)).toBe(true)
  })

  it('明显比阈值宽 → 不算窄', () => {
    expect(nextNarrow(SIDEBAR_EXPAND_ABOVE + 1, true)).toBe(false)
    expect(nextNarrow(1440, true)).toBe(false)
  })

  it('正好落在迟滞区下沿 → 维持原判（不能因为等于阈值就翻脸）', () => {
    expect(nextNarrow(SIDEBAR_COLLAPSE_BELOW, false)).toBe(false)
    expect(nextNarrow(SIDEBAR_COLLAPSE_BELOW, true)).toBe(true)
  })

  it('正好落在迟滞区上沿 → 维持原判', () => {
    expect(nextNarrow(SIDEBAR_EXPAND_ABOVE, true)).toBe(true)
    expect(nextNarrow(SIDEBAR_EXPAND_ABOVE, false)).toBe(false)
  })

  it('迟滞区中间 → 沿用上一次的结论，两个方向都成立', () => {
    const middle = (SIDEBAR_COLLAPSE_BELOW + SIDEBAR_EXPAND_ABOVE) / 2
    expect(nextNarrow(middle, true)).toBe(true)
    expect(nextNarrow(middle, false)).toBe(false)
  })

  it('阈值本身是自洽的：下沿严格小于上沿', () => {
    expect(SIDEBAR_COLLAPSE_BELOW).toBeLessThan(SIDEBAR_EXPAND_ABOVE)
  })
})
