/**
 * 默认封面：没有封面图（或图挂了）时，按名字/ID 现场生成的那一张。
 *
 * 一张图由三件事拼成：
 *   * **底**：同色相的双色渐变。色相由名字哈希决定，明度与饱和度取自主题令牌
 *     （见 tokens.css 的 --cover-art-*），所以深浅两个主题各自成立、且换主题不用重算。
 *   * **图案**：按类型换形状 —— 歌曲是均衡器条、歌单是曲目列表、歌手是人像剪影。
 *     三类一眼能分开，这正是「默认封面」最该干的事。
 *   * **变化**：色相、渐变角度、形状变体，以及每根条/每行的长短，全部来自名字哈希
 *     （见 lib/cover-art.ts）。同一个名字永远得到同一张脸。
 *
 * ★ 形状一律**填充**、不用描边：同一份代码要同时服务 24px（侧栏、命令面板）与
 *   300px（详情页大图）。描边在小尺寸下会细到看不见，填充则是等比缩小。
 */

import type { CSSProperties } from 'react'

import { coverArt, type CoverArt as CoverArtStyle, type CoverKind } from '@/lib/cover-art'

export function CoverArt({ kind, seed }: { kind: CoverKind; seed: string }): React.JSX.Element {
  const art = coverArt(seed, kind)
  const style = {
    '--art-h': art.h,
    '--art-h2': art.h2,
    '--art-angle': `${art.angle}deg`
  } as CSSProperties

  return (
    <div className="cover-art" data-kind={kind} style={style} aria-hidden="true">
      <svg viewBox="0 0 48 48" preserveAspectRatio="xMidYMid slice">
        {kind === 'song' ? (
          <Bars art={art} />
        ) : kind === 'playlist' ? (
          <TrackList art={art} />
        ) : (
          <Portrait art={art} />
        )}
      </svg>
    </div>
  )
}

/** 取第 i 个确定性随机数（数组长度固定，取模只是防越界） */
function pick(art: CoverArtStyle, i: number): number {
  return art.rand[i % art.rand.length]
}

/** 歌曲：一排均衡器条，高低由名字决定 */
function Bars({ art }: { art: CoverArtStyle }): React.JSX.Element {
  const count = 4 + art.variant
  const gap = 3
  const width = (32 - gap * (count - 1)) / count
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const height = 9 + pick(art, i) * 22
        return (
          <rect
            key={i}
            x={8 + i * (width + gap)}
            y={24 - height / 2}
            width={width}
            height={height}
            rx={width / 2}
            fill="currentColor"
            opacity={0.55 + pick(art, i + 3) * 0.42}
          />
        )
      })}
    </g>
  )
}

/** 歌单：一份曲目列表（圆点 + 长短不一的条），行数随变体在 3/4 之间 */
function TrackList({ art }: { art: CoverArtStyle }): React.JSX.Element {
  const rows = art.variant === 0 ? 3 : 4
  const step = rows === 3 ? 11 : 9
  return (
    <g>
      {Array.from({ length: rows }, (_, i) => {
        const y = 24 - ((rows - 1) * step) / 2 + i * step
        return (
          <g key={i} opacity={0.52 + pick(art, i + 5) * 0.44}>
            <circle cx={11} cy={y} r={2.6} fill="currentColor" />
            <rect
              x={18}
              y={y - 2}
              width={15 + pick(art, i + 2) * 11}
              height={4}
              rx={2}
              fill="currentColor"
            />
          </g>
        )
      })}
    </g>
  )
}

/** 歌手：人像剪影（头 + 肩），背后一圈同心光环 —— 歌手封面本来就是圆的 */
function Portrait({ art }: { art: CoverArtStyle }): React.JSX.Element {
  return (
    <g>
      <circle cx={24} cy={24} r={19} fill="currentColor" opacity={0.16} />
      <circle cx={24} cy={17} r={6.2 + art.variant * 0.6} fill="currentColor" opacity={0.95} />
      <path d="M8 42c0-8 7-12.5 16-12.5s16 4.5 16 12.5z" fill="currentColor" opacity={0.95} />
    </g>
  )
}
