/**
 * 版本比较的单测。
 *
 * 这条判据决定「检查更新」会不会误报，而误报的两种方向都不轻：
 *   * 少报：用户以为是最新版，其实落后了；
 *   * 多报：拿个看不懂的字符串（`dev` / `mock-2026.10.12`）当「有新版本」反复催人升级。
 * 所以「认不出 → 判不新」这条保守规则也必须有用例钉住。
 */

import { describe, expect, it } from 'vitest'

import { isNewerVersion } from './version'

describe('isNewerVersion', () => {
  it('三段数字逐个比较', () => {
    expect(isNewerVersion('v1.2.4', '1.2.3')).toBe(true)
    expect(isNewerVersion('v1.3.0', '1.2.9')).toBe(true)
    expect(isNewerVersion('v2.0.0', '1.99.99')).toBe(true)
    expect(isNewerVersion('v1.2.3', '1.2.4')).toBe(false)
  })

  it('两边都带 v 或都不带，结果一致', () => {
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('v1.1.0', 'v1.0.0')).toBe(true)
    expect(isNewerVersion('v1.1.0', '1.0.0')).toBe(true)
  })

  it('数字部分相同即不算新（预发布版不催正式版）', () => {
    expect(isNewerVersion('v1.2.3', '1.2.3')).toBe(false)
    expect(isNewerVersion('v1.2.3-rc.1', '1.2.3')).toBe(false)
  })

  it('缺一段时按 0 补', () => {
    expect(isNewerVersion('v1.3', '1.2.9')).toBe(true)
    expect(isNewerVersion('v1.2', '1.2.0')).toBe(false)
  })

  it('认不出来的写法一律判不新（宁可不提示，也不瞎提示）', () => {
    expect(isNewerVersion('dev', '1.0.0')).toBe(false)
    expect(isNewerVersion('mock-2026.10.12', '1.0.0')).toBe(false)
    expect(isNewerVersion('v1.1.0', 'abc1234')).toBe(false)
  })
})
