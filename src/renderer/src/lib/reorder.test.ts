import { describe, expect, it } from 'vitest'

import { moveItem } from './reorder'

const list = ['a', 'b', 'c', 'd']

describe('moveItem', () => {
  it('往上拖：落在目标项的上半 → 插到它前面', () => {
    expect(moveItem(list, 3, 1, false)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('往上拖：落在目标项的下半 → 插到它后面', () => {
    expect(moveItem(list, 3, 1, true)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('往下拖：落在目标项的上半 → 插到它前面', () => {
    expect(moveItem(list, 0, 2, false)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('往下拖：落在目标项的下半 → 插到它后面', () => {
    expect(moveItem(list, 0, 2, true)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('拖到相邻项的内侧边界上是空操作', () => {
    // 往下拖一格、落在目标项的上半 = 没挪动（它本来就在前面）
    expect(moveItem(list, 0, 1, false)).toEqual(list)
    // 往上拖一格、落在目标项的下半 = 没挪动
    expect(moveItem(list, 2, 1, true)).toEqual(list)
  })

  it('拖到自己身上是空操作', () => {
    expect(moveItem(list, 2, 2, false)).toEqual(list)
    expect(moveItem(list, 2, 2, true)).toEqual(list)
  })

  it('拖到两端', () => {
    expect(moveItem(list, 0, 3, true)).toEqual(['b', 'c', 'd', 'a'])
    expect(moveItem(list, 3, 0, false)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('不改入参', () => {
    moveItem(list, 0, 2, true)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })
})
