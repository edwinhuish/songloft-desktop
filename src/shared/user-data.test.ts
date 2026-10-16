/**
 * 用户数据目录判据的单测。
 *
 * 这两条判据错了都不会报错，只会**静默**把数据放到别处：
 *   * 判据放宽 → 安装版把配置写进安装目录，卸载 / 换目录时跟着丢；
 *   * 优先级写反 → 绿色版拷到 U 盘上，配置却还留在这台机器的 %APPDATA%，「整个文件夹拷走」
 *     这个承诺当场失效。
 * 所以三档优先级与「标记不在就什么都不做」都要有用例钉住。
 */

import { describe, expect, it } from 'vitest'

import { chooseUserDataDir, portableDataDir } from './user-data'

describe('portableDataDir', () => {
  it('exe 旁边有标记时才给出目录，且就叫 data', () => {
    expect(portableDataDir('/home/edwin/Apps/Songloft', true)).toBe(
      '/home/edwin/Apps/Songloft/data'
    )
  })

  it('没有标记就返回 null（安装版走的是系统默认位置，不由这里插手）', () => {
    expect(portableDataDir('/home/edwin/Apps/Songloft', false)).toBeNull()
  })

  it('Windows 路径用反斜杠接着拼，不混进斜杠', () => {
    expect(portableDataDir('C:\\Apps\\Songloft', true)).toBe('C:\\Apps\\Songloft\\data')
  })

  it('末尾多写的分隔符不会拼出双写', () => {
    expect(portableDataDir('/home/edwin/Apps/Songloft/', true)).toBe(
      '/home/edwin/Apps/Songloft/data'
    )
    expect(portableDataDir('C:\\Apps\\Songloft\\\\', true)).toBe('C:\\Apps\\Songloft\\data')
  })
})

describe('chooseUserDataDir', () => {
  const fallback = '/home/edwin/.config/songloft-desktop'
  const portableDir = '/media/usb/Songloft/data'

  it('三档齐全时，显式指定赢', () => {
    expect(chooseUserDataDir({ override: '/tmp/e2e-data', portableDir, fallback })).toBe(
      '/tmp/e2e-data'
    )
  })

  it('没有显式指定时，免安装版的数据目录赢过系统默认位置', () => {
    expect(chooseUserDataDir({ override: '', portableDir, fallback })).toBe(portableDir)
  })

  it('两档都没有值就落到系统默认位置', () => {
    expect(chooseUserDataDir({ override: '', portableDir: null, fallback })).toBe(fallback)
  })

  it('空串按「没指定」算，不当成一个空路径用', () => {
    expect(chooseUserDataDir({ override: '', portableDir: null, fallback })).not.toBe('')
  })
})
