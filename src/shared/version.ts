/**
 * 版本号比较。
 *
 * 只做「谁更新」这一件事，而且刻意做得保守：认不出来的写法一律判「不比它新」。
 * 宁可少提示一次更新，也不要拿一个看不懂的字符串去吓用户（后端版本里就有 `dev`、
 * `mock-2026.10.12` 这类非语义化写法）。
 */

/** 抠出数字部分：`v1.2.3` / `1.2.3-rc.1` / `1.2` → [1,2,3] / [1,2,3] / [1,2,0]；认不出返回 null */
function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

/**
 * `latest` 是否比 `current` 新。
 *
 * 数字部分相同时判「不新」——`1.1.0-rc.1` 不高于 `1.1.0`，正式版不该被预发布版催着升。
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const next = parseVersion(latest)
  const now = parseVersion(current)
  if (!next || !now) return false
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) return next[index] > now[index]
  }
  return false
}
