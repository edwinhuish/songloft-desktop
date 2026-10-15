/**
 * 列表拖动重排的落位计算。
 *
 * ★ 单独拎出来配单测，是因为「插到哪一格」的公式极容易差一位，而差一位的症状只是
 *   「拖完顺序看着差不多但不对」—— 不报错、不复现，没人会去怀疑一行 splice。
 *
 * 落点用「悬停到了哪一项 + 落在它的上半还是下半」表达，而不是一个裸下标：界面上画的
 * 那条插入线（上沿 / 下沿）就是这两个值，两边同源才不会有「线画在这里、东西落到那里」。
 */
export function moveItem<T>(items: T[], from: number, over: number, after: boolean): T[] {
  const next = [...items]
  if (from === over) return next
  const [moved] = next.splice(from, 1)
  /*
   * 目标下标是按**原数组**算的：被拖走的那一项若原本在目标之前，取出它之后目标整体左移
   * 一格，所以先减回来，再决定落在目标项的前面还是后面。
   */
  const insertAt = (from < over ? over - 1 : over) + (after ? 1 : 0)
  next.splice(insertAt, 0, moved)
  return next
}
