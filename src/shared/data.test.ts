/**
 * `sameData` 的单测。
 *
 * 这条判据决定「切回页面时界面要不要动」，两种误判的代价不对称：
 *   * 判成「变了」而其实没变 —— 用户白丢一次滚动位置与已加载的分页（要挡的就是它）；
 *   * 判成「没变」而其实变了 —— 用户看到的是陈旧的列表，且要等到下一次切换才自愈。
 * 所以「键顺序不同视为相同」（挡住前者）与「数组顺序不同视为不同」（不放过后者）
 * 都必须有用例钉住。
 */

import { describe, expect, it } from 'vitest'

import { sameData } from './data'

describe('sameData', () => {
  it('原始值按值比（含 NaN 这类特例）', () => {
    expect(sameData(1, 1)).toBe(true)
    expect(sameData('a', 'a')).toBe(true)
    expect(sameData(1, '1')).toBe(false)
    expect(sameData(NaN, NaN)).toBe(true)
    expect(sameData(null, null)).toBe(true)
    expect(sameData(null, undefined)).toBe(false)
  })

  it('对象比键集合，与键顺序无关', () => {
    expect(sameData({ id: 1, title: 'a' }, { title: 'a', id: 1 })).toBe(true)
    expect(sameData({ id: 1 }, { id: 1, title: 'a' })).toBe(false)
    expect(sameData({ id: 1, title: 'a' }, { id: 1, title: 'b' })).toBe(false)
  })

  it('数组比顺序：换了次序就是变了', () => {
    expect(sameData([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(sameData([1, 2, 3], [3, 2, 1])).toBe(false)
    expect(sameData([1, 2], [1, 2, 3])).toBe(false)
  })

  it('嵌套结构逐层比', () => {
    const before = [{ id: 1, artist: { name: 'a', ids: [1, 2] } }]
    // 键顺序被打乱、内容一样 —— 后端换个序列化顺序不该算「数据变了」
    const after = [{ artist: { ids: [1, 2], name: 'a' }, id: 1 }]
    expect(sameData(before, after)).toBe(true)
    expect(sameData(before, [{ id: 1, artist: { name: 'a', ids: [2, 1] } }])).toBe(false)
  })

  it('数组与对象不混为一谈', () => {
    expect(sameData([], {})).toBe(false)
    expect(sameData([1], { 0: 1 })).toBe(false)
  })
})
