/**
 * 两份「数据快照」是否等价。
 *
 * 用途只有一处：页面切回来时的那次静默刷新（见 renderer/hooks 里那三个数据 hook）——
 * 重新取回来的数据与手头这份一模一样时，界面**一个字都不该改**：列表、滚动位置、
 * 已加载的分页、选中的行都原样留着。于是「一样」只能比内容，不能比引用 ——
 * 每次 fetch 都会解析出一批全新的对象。
 *
 * ★ 为什么不用 `JSON.stringify` 比：它受**键顺序**影响。后端换一下字段顺序（数据没变）
 *   就会被判成「变了」，界面于是白刷一次、用户刚拖到的位置也没了 —— 而这正是这一整套
 *   机制要避免的事。所以这里按语义比：对象比键集合（顺序无关）、数组比顺序、原始值直接比。
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameData(item, b[index]))
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && sameData(left[key], right[key])
  )
}
