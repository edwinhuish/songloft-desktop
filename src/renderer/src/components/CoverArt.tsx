/**
 * 默认封面：没有封面图（或图挂了）时显示的那一张。
 *
 * 设计取向是**简雅**，不是「有辨识度的程序化生成」：
 *   * 一类一张图 —— 歌曲是音符、歌单是三条短横、歌手是人像线稿；
 *   * 颜色按类型给（低饱和的冷灰 / 暖灰 / 灰绿），深浅主题各一套明度（见 tokens.css）；
 *   * **不按名字做变化**。早先那版按名字哈希出五花八门的色相，在长列表里太吵 ——
 *     默认封面的职责是「安静地把位置填上」，不是抢封面本身的戏。
 *
 * 画法上一律**描边、不用填充块**（音符头那一小块除外）：同一份代码要同时服务 20px
 * （标题栏）与 640px（详情页大图），线宽写进 viewBox 里会等比缩放，两端都成立；
 * 图案只留三四个元素，小尺寸下才不会被糊成一团。
 */

export type CoverKind = 'song' | 'playlist' | 'artist'

/** 三类的线宽一致，形状才有可能看起来是同一套东西 */
const STROKE = 2.6

export function CoverArt({ kind }: { kind: CoverKind }): React.JSX.Element {
  return (
    <div className="cover-art" data-kind={kind} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        {kind === 'song' ? <Note /> : kind === 'playlist' ? <TrackList /> : <Portrait />}
      </svg>
    </div>
  )
}

/** 歌曲：一个八分音符（符头 + 符杆 + 符尾一笔画完） */
function Note(): React.JSX.Element {
  return (
    <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 33.5V13.2c6.4 1.7 9.4 5 9.4 9.6" fill="none" />
      <ellipse
        cx={17.4}
        cy={33.6}
        rx={5.6}
        ry={4.2}
        fill="currentColor"
        transform="rotate(-18 17.4 33.6)"
      />
    </g>
  )
}

/** 歌单：三条短横（最后一条短一截），像一份曲目列表 */
function TrackList(): React.JSX.Element {
  return (
    <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" fill="none" opacity={0.9}>
      <path d="M13 17h22" />
      <path d="M13 24h22" />
      <path d="M13 31h14" />
    </g>
  )
}

/** 歌手：人像线稿（头 + 肩），不填色 */
function Portrait(): React.JSX.Element {
  return (
    <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" fill="none">
      <circle cx={24} cy={18.4} r={6.4} />
      <path d="M11.6 39.6c0-6.4 5.5-10.6 12.4-10.6s12.4 4.2 12.4 10.6" />
    </g>
  )
}
