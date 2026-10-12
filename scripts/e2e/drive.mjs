/**
 * 通过 Chrome DevTools Protocol 驱动已启动的 Electron 渲染层，逐个界面截图并**断言**。
 *
 * 走的是**真实 DOM 交互**（点侧栏、双击歌曲行、派发 Ctrl+K），不是去戳内部 store：
 * 这样顺带验证了事件绑定、路由跳转、无障碍标记是否真的接对，
 * 而不是"我调了函数所以应该渲染了"。
 *
 * ★ 两条设计约束（都是踩过坑之后的结论）：
 *
 *   1. **一个 STEP 只做一次点击**，靠该步自己的 wait 等渲染落定。
 *      不要写"点 A 再点 B"的 helper —— 曾有一个 clickWait(A, …, B) 只点第一个参数，
 *      调用处却当成"点了两个"，于是 B 根本没被点、断言却因为不区分内容而全绿，
 *      白跑了两轮 70 秒的巡检才发现。
 *
 *   2. **断言必须能区分内容，不能只数个数**。
 *      「歌手分面」和「流派分面」都是 5 张卡，只断言 `cards === 5` 的话，
 *      点没点中「流派」这个 chip 是看不出来的。所以下面用 cardTitles 按文字断言。
 *
 * ★ 为什么必须有断言：mock 的 lyric 有 10 行、lxlyric 只覆盖其中 4 行 —— 这是
 *   「逐字源覆盖不全时主歌词被整行丢掉」的精确复现条件。没有断言时，这类**静默**
 *   缺陷只能靠人肉看截图（本项目的歌词丢行缺陷正是这样被发现的）。
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const CDP = process.env.CDP_PORT ?? '9222'
/** 默认落在仓库根的 .e2e/shots（已 gitignore）；run.sh 会显式传 SHOT_DIR */
const OUT = process.env.SHOT_DIR ?? join(HERE, '..', '..', '.e2e', 'shots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 期望值构造器。
 * 失败时 `label` 会原样打进日志 —— 断言失败信息里出现 "undefined" 等于没写断言。
 */
const exactly = (n) => Object.assign((v) => v === n, { label: `=${n}` })
const atLeast = (n) => Object.assign((v) => v >= n, { label: `>=${n}` })
/** 断言数组里每一项都包含某个子串（用于区分"哪个分面"） */
const containsAll = (...names) =>
  Object.assign(
    (v) => names.every((n) => (Array.isArray(v) ? v : []).some((x) => String(x).includes(n))),
    {
      label: `含[${names.join('+')}]`
    }
  )

/**
 * 注入到渲染层的助手。
 *
 * ⚠️ 这段是**模板字符串**：注释里出现反引号会把它提前闭合，症状是 Node 抛
 *    "SyntaxError: Unexpected identifier"。所以里面的注释一律用普通引号。
 */
const HELPERS = `
window.__t = {
  q: (sel) => document.querySelector(sel),
  qa: (sel) => [...document.querySelectorAll(sel)],
  byText: (sel, text) => [...document.querySelectorAll(sel)].find((e) => (e.textContent || '').includes(text)) || null,
  click: (sel, text) => {
    const el = text ? window.__t.byText(sel, text) : document.querySelector(sel);
    if (!el) return 'NOT_FOUND:' + sel + (text ? '/' + text : '');
    el.click();
    return 'OK';
  },
  dbl: (sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'NOT_FOUND';
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return 'OK';
  },
  key: (key, mods) => {
    window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, mods || {})));
    return 'OK';
  },
  /** 分面卡上显示的标题，用来断言"当前是哪一维分面" */
  cardTitles: () => [...document.querySelectorAll('.card .card-title')].map((e) => (e.textContent || '').trim()),
  /**
   * chip 上的文字，用来断言"当前挂了哪些筛选"。
   * 不能改用个数断言："当前筛选"那一行里还有一个同为 .chip 的「清空全部」按钮。
   */
  chipTitles: () => [...document.querySelectorAll('.chip')].map((e) => (e.textContent || '').trim()),
  counts: () => ({
    rows: document.querySelectorAll('.song-row').length,
    cards: document.querySelectorAll('.card').length,
    navs: document.querySelectorAll('.nav-item').length,
    chips: document.querySelectorAll('.chip').length,
    switches: document.querySelectorAll('[role="switch"]').length,
    // 文件夹页的目录行（与歌曲行是两个不同的容器）
    folderRows: document.querySelectorAll('.folder-row').length,
    // 歌词面板：行数用于回归"逐字源只覆盖部分行时不能丢主歌词的行"
    lyricLines: document.querySelectorAll('.lyric-line').length,
    lyricWords: document.querySelectorAll('.lyric-word').length,
    // 命令面板：条目数，用于确认 Ctrl+K 真的渲染出了可选项
    paletteItems: document.querySelectorAll('.palette-item').length,
    cardTitles: window.__t.cardTitles(),
    chipTitles: window.__t.chipTitles()
  })
};
'ready'
`

async function findPage() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP}/json`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(500)
  }
  throw new Error('等不到渲染层调试 target')
}

class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)))
      else entry.resolve(msg.result)
    })
  }

  send(method, params = {}) {
    this.id += 1
    const id = this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 25000)
    })
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (res.exceptionDetails) {
      const d = res.exceptionDetails
      throw new Error(`渲染层抛错: ${d.exception?.description ?? d.text}`)
    }
    return res.result?.value
  }

  async shot(name, wait = 1000) {
    await sleep(wait)
    const res = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(res.data, 'base64'))
    return Buffer.from(res.data, 'base64').length
  }
}

/**
 * [输出名, 表达式（只允许一次点击）, 点完后等多久, 期望的 DOM 统计]
 *
 * mock 数据基线：43 首（41 本地 + 2 网络 + 0 电台）、5 位歌手、8 张专辑、5 种流派、
 * 3 张歌单、10 条最近播放、6 首收藏、5 个文件夹；流派「摇滚」12 首。
 */
const STEPS = [
  ['01-home', "window.__t.click('.nav-item', '首页')", 1500],

  // ── 曲库：类型筛选 → 分面浏览 → 组合筛选 ──────────────────────────────
  ['02-library', "window.__t.click('.nav-item', '曲库')", 2200, { rows: exactly(43) }],
  [
    '03-library-type-local',
    "window.__t.click('.segmented button', '本地')",
    2000,
    { rows: exactly(41), chipTitles: containsAll('本地') }
  ],
  [
    '04-library-type-radio',
    "window.__t.click('.segmented button', '电台')",
    2000,
    { rows: exactly(0), chipTitles: containsAll('电台') }
  ],
  // 切回「全部」：分面浏览必须在不带类型过滤的基线上看，否则后面 rows 断言会串味
  [
    '05-library-type-all',
    "window.__t.click('.segmented button', '全部')",
    2000,
    { rows: exactly(43) }
  ],
  // 打开分类浏览。默认维是「歌手」，所以卡片内容必须是歌手名
  [
    '06-library-browse-on',
    "window.__t.click('.btn', '分类浏览')",
    2600,
    { cards: exactly(5), cardTitles: containsAll('陈屿', '野岸乐队') }
  ],
  // 切到「流派」维：卡片数同为 5，但内容必须变成流派名 —— 这是"有没有点中 chip"的唯一判据
  [
    '07-library-genre-facets',
    "window.__t.click('.chip', '流派')",
    2600,
    { cards: exactly(5), cardTitles: containsAll('摇滚', '爵士') }
  ],
  // 点流派卡：applyFilter 会关掉分类浏览并在表头挂出筛选 chip
  // 断言按 chip 文字而不是个数 —— 「清空全部」也是 .chip
  [
    '08-library-filter-rock',
    "window.__t.click('.card', '摇滚')",
    2400,
    { rows: exactly(12), cards: exactly(0), chipTitles: containsAll('流派：摇滚') }
  ],

  // ── 歌单 / 文件夹 / 最近 / 收藏 ────────────────────────────────────────
  ['09-playlists', "window.__t.click('.nav-item', '歌单')", 1800, { cards: atLeast(3) }],
  ['10-playlist-detail', "window.__t.click('.nav-item', '深夜写码')", 2200, { rows: atLeast(1) }],
  ['11-folders', "window.__t.click('.nav-item', '文件夹')", 2000, { folderRows: exactly(5) }],
  ['12-recent', "window.__t.click('.nav-item', '最近播放')", 2400, { rows: exactly(10) }],
  ['13-favorites', "window.__t.click('.nav-item', '我喜欢的')", 2400, { rows: exactly(6) }],

  // ── 设置四页 ───────────────────────────────────────────────────────────
  ['14-settings-appearance', "window.__t.click('.nav-item', '设置')", 1600],
  [
    '15-settings-playback',
    "window.__t.click('.settings-nav button', '播放')",
    1800,
    { switches: atLeast(1) }
  ],
  [
    '16-settings-library',
    "window.__t.click('.settings-nav button', '曲库')",
    2200,
    { switches: atLeast(2) }
  ],
  ['17-settings-server', "window.__t.click('.settings-nav button', '服务器')", 1600],

  // ── 播放 / 面板 ────────────────────────────────────────────────────────
  ['18-playing', "window.__t.click('.nav-item', '曲库')", 2400],
  ['19-now-playing-panel', "window.__t.dbl('.song-row')", 1800],
  [
    '20-lyrics-panel',
    'window.__t.click(\'button[aria-label="歌词面板"]\')',
    2600,
    { lyricLines: exactly(10), lyricWords: atLeast(20) }
  ],
  ['21-queue-panel', 'window.__t.click(\'button[aria-label="播放队列"]\')', 1200],
  [
    '22-command-palette',
    "window.__t.key('k', { ctrlKey: true })",
    1400,
    { paletteItems: atLeast(1) }
  ]
]

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })

  const page = await findPage()
  console.log(`[drive] 已连接 ${page.url}`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const session = new Session(ws)
  await session.send('Page.enable')
  await session.send('Runtime.enable')

  // 等启动编排跑完（设置 → 会话 → 预载），最多 20 秒
  for (let i = 0; i < 40; i += 1) {
    if (await session.evaluate("!!document.querySelector('.shell')")) break
    await sleep(500)
  }

  await session.evaluate(HELPERS)
  console.log('[drive] 启动时 DOM:', JSON.stringify(await session.evaluate('window.__t.counts()')))

  let failures = 0
  for (const [name, expr, wait, expect] of STEPS) {
    let clicked
    try {
      clicked = await session.evaluate(expr)
    } catch (error) {
      clicked = `ERR ${error.message}`
    }
    const bytes = await session.shot(name, wait ?? 1000)
    const stats = await session.evaluate('window.__t.counts()')

    let verdict = ''
    if (expect) {
      const bad = Object.entries(expect).filter(([key, want]) => !want(stats[key]))
      if (bad.length === 0) {
        verdict = ` expect=✓(${Object.entries(expect)
          .map(([k, w]) => `${k}${w.label ?? ''}`)
          .join(' ')})`
      } else {
        failures += 1
        verdict = ` ⛔ EXPECT_FAIL ${bad
          .map(([k, w]) => `${k} 期望 ${w.label ?? '断言'} 实际 ${JSON.stringify(stats[k])}`)
          .join('; ')}`
      }
    }

    console.log(
      `  ${clicked === 'OK' ? '✓' : '!'} ${name}.png (${bytes}B) click=${clicked} dom=${JSON.stringify(stats)}${verdict}`
    )
  }

  ws.close()

  if (failures > 0) {
    console.error(`[drive] ${failures} 个界面的期望值未满足`)
    process.exit(1)
  }
  console.log('[drive] 全部界面巡检通过')
}

main().catch((error) => {
  console.error('[drive] 失败:', error.message)
  process.exit(1)
})
