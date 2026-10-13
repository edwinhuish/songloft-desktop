import { describe, expect, it } from 'vitest'

import {
  applyPluginOrder,
  entryPathsOf,
  isDisplayable,
  isSvgPath,
  pluginDisplayName,
  pluginFallbackHue,
  pluginIconPath,
  pluginPageUrl,
  toPlugin,
  toPluginList,
  type JSPlugin
} from './plugin'

/**
 * 这批用例锁的是**顺序语义**，它是从上游 plugin_order.dart 原样搬过来的。
 *
 * 为什么值得单独测：这是一段「看起来怎么写都对」的纯函数，四条语义里有两条只在边界
 * 上才看得出来 —— 卸载竞态（order 里的孤儿条目）与新装插件落尾。写错任何一条的症状
 * 都是「插件顺序偶尔不对」，在界面上极难复现，也没人会去怀疑一个排序函数。
 */

function plugin(entryPath: string, extra: Partial<JSPlugin> = {}): JSPlugin {
  return {
    id: entryPath.length,
    name: entryPath.toUpperCase(),
    version: '1.0.0',
    description: '',
    author: '',
    homepage: '',
    license: '',
    entryPath,
    main: 'main.js',
    minHostVersion: '',
    permissions: [],
    icon: '',
    updateUrl: '',
    downloadUrl: '',
    renderEngine: '',
    status: 'active',
    filePath: '',
    createdAt: '',
    updatedAt: '',
    ...extra
  }
}

const names = (plugins: JSPlugin[]): string[] => plugins.map((p) => p.entryPath)

describe('applyPluginOrder', () => {
  it('order 为空时原样返回（顺序沿用后端）', () => {
    const list = [plugin('b'), plugin('a')]
    expect(names(applyPluginOrder(list, []))).toEqual(['b', 'a'])
  })

  it('按 entryPath 顺序重排', () => {
    const list = [plugin('a'), plugin('b'), plugin('c')]
    expect(names(applyPluginOrder(list, ['c', 'a', 'b']))).toEqual(['c', 'a', 'b'])
  })

  it('order 里已卸载的 entryPath 被跳过，不影响其余顺序', () => {
    const list = [plugin('a'), plugin('b')]
    expect(names(applyPluginOrder(list, ['gone', 'b', 'a']))).toEqual(['b', 'a'])
  })

  it('未列入 order 的插件按原相对顺序追加到末尾（新装插件落尾）', () => {
    const list = [plugin('a'), plugin('fresh'), plugin('b')]
    expect(names(applyPluginOrder(list, ['b', 'a']))).toEqual(['b', 'a', 'fresh'])
  })

  it('order 里重复的 entryPath 只取首个匹配位置', () => {
    const list = [plugin('a'), plugin('b')]
    expect(names(applyPluginOrder(list, ['a', 'a', 'b']))).toEqual(['a', 'b'])
  })

  it('不改入参（派生值不能被原地排序）', () => {
    const list = [plugin('a'), plugin('b')]
    applyPluginOrder(list, ['b', 'a'])
    expect(names(list)).toEqual(['a', 'b'])
  })

  it('没有 entryPath 的插件不参与排序（上游同样丢弃）', () => {
    const list = [plugin('a'), plugin(''), plugin('b')]
    expect(names(applyPluginOrder(list, ['b', 'a']))).toEqual(['b', 'a'])
  })
})

describe('isDisplayable', () => {
  it('只有启用的插件出现在入口位上', () => {
    expect(isDisplayable(plugin('a'))).toBe(true)
    expect(isDisplayable(plugin('a', { status: 'inactive' }))).toBe(false)
    // error 是「后端正在自愈」，入口点进去也是 503，故不展示
    expect(isDisplayable(plugin('a', { status: 'error' }))).toBe(false)
  })

  it('没有 entryPath 就不可能出现（缺它的插件页地址拼不出来）', () => {
    expect(isDisplayable(plugin(''))).toBe(false)
  })
})

describe('toPlugin', () => {
  it('snake_case 线格式转成驼峰模型', () => {
    const model = toPlugin({
      id: 7,
      name: '示例',
      entry_path: 'demo',
      min_host_version: '1.2.0',
      render_engine: 'lynx',
      update_url: 'https://example.com/u',
      permissions: ['songs:read']
    })
    expect(model).toMatchObject({
      id: 7,
      name: '示例',
      entryPath: 'demo',
      minHostVersion: '1.2.0',
      renderEngine: 'lynx',
      updateUrl: 'https://example.com/u',
      permissions: ['songs:read']
    })
  })

  it('缺字段与未知 status 都有确定兜底（不让 undefined 漏进界面）', () => {
    const model = toPlugin({ id: '3' })
    expect(model.id).toBe(3)
    expect(model.entryPath).toBe('')
    expect(model.permissions).toEqual([])
    expect(model.status).toBe('inactive')
  })

  it('列表接口整体缺 plugins 时返回空数组', () => {
    expect(toPluginList(undefined)).toEqual([])
    expect(toPluginList(null)).toEqual([])
  })
})

describe('展示辅助', () => {
  it('name 为空时退回 entryPath，再退回 id', () => {
    expect(pluginDisplayName(plugin('demo'))).toBe('DEMO')
    expect(pluginDisplayName(plugin('demo', { name: '' }))).toBe('demo')
    expect(pluginDisplayName(plugin('', { name: '', id: 9 }))).toBe('插件 #9')
  })

  it('图标路径按 static 目录拼，没有图标就没有路径', () => {
    expect(pluginIconPath(plugin('demo', { icon: 'icon.svg' }))).toBe(
      '/api/v1/jsplugin/demo/static/icon.svg'
    )
    expect(pluginIconPath(plugin('demo'))).toBe('')
    expect(pluginIconPath(plugin('', { icon: 'a.png' }))).toBe('')
  })

  it('SVG 判定看扩展名（后端会加 content hash 指纹）', () => {
    expect(isSvgPath('icon.abc123.svg')).toBe(true)
    expect(isSvgPath('icon.svg')).toBe(true)
    expect(isSvgPath('icon.png')).toBe(false)
  })

  it('兜底色相稳定且落在 0–359', () => {
    expect(pluginFallbackHue('demo')).toBe(pluginFallbackHue('demo'))
    expect(pluginFallbackHue('demo')).toBeGreaterThanOrEqual(0)
    expect(pluginFallbackHue('demo')).toBeLessThan(360)
  })

  it('entryPathsOf 丢掉空 entryPath', () => {
    expect(entryPathsOf([plugin('a'), plugin(''), plugin('b')])).toEqual(['a', 'b'])
  })
})

describe('pluginPageUrl', () => {
  const ctx = { baseUrl: 'http://localhost:58091/', accessToken: 'tok' }

  it('带上 token、主题与 embed 标记，并去掉 baseUrl 的尾斜杠', () => {
    const url = pluginPageUrl(plugin('demo'), { ...ctx, theme: 'dark' })
    expect(url).toBe(
      'http://localhost:58091/api/v1/jsplugin/demo?access_token=tok&theme=dark&embed=1'
    )
  })

  it('embed 可显式关掉（独立打开插件页时）', () => {
    const url = pluginPageUrl(plugin('demo'), { ...ctx, embed: false })
    expect(url).not.toContain('embed=')
  })

  it('没有 entryPath 就没有地址（不拼出一个 404 路径）', () => {
    expect(pluginPageUrl(plugin(''), ctx)).toBe('')
  })
})
