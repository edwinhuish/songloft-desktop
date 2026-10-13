/**
 * 默认封面：没有封面图（或图挂了）时显示的那一张。
 *
 * 设计取向是**简化**：三张图共用一套线条、一块底色（底色由**主题色**调出，
 * 见 tokens.css 的 `--cover-art-*`），类型**只由图案区分** ——
 *   * 歌曲 = 单音符；
 *   * 歌单 = 双音符（多一个符头、两根符杆被一根符杠连起来，是「一份集合」）；
 *   * 歌手 = 麦克风（人像与「音符数量」这条线不搭，换成同线条语言的麦克风）。
 * 线条、线宽、墨色全部一致，并排看才是同一套东西。
 *
 * 刻意**不按名字/类型换色相**：早先那版按名字哈希出五花八门的色相，
 * 在长列表里太吵 —— 默认封面的职责是「安静地把位置占上」，不是抢封面本身的戏。
 *
 * 画法上一律**描边、不用填充块**（符头那一小块除外）：同一份代码要同时服务 20px
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
        {kind === 'song' ? <SingleNote /> : kind === 'playlist' ? <DoubleNote /> : <Microphone />}
      </svg>
    </div>
  )
}

/** 符头：音符的共用零件（椭圆略斜，像手写谱面上的样子）。
 *  双音符要并排放下两个，所以半径可传，默认取单音符那档。 */
function NoteHead({
  cx,
  cy,
  rx = 5.6,
  ry = 4.2
}: {
  cx: number
  cy: number
  rx?: number
  ry?: number
}): React.JSX.Element {
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      fill="currentColor"
      transform={`rotate(-18 ${cx} ${cy})`}
    />
  )
}

/** 歌曲：单音符（符头 + 符杆 + 符尾一笔画完） */
function SingleNote(): React.JSX.Element {
  return (
    <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 33.5V13.2c6.4 1.7 9.4 5 9.4 9.6" fill="none" />
      <NoteHead cx={17.4} cy={33.6} />
    </g>
  )
}

/** 歌单：双音符（两个符头共用一根符杠）—— 与单音符唯一的差别就是「多一个」，
 *  这正是要的：一眼看出「一个是单曲，一堆是歌单」，而不是两张无关的图标。 */
function DoubleNote(): React.JSX.Element {
  return (
    <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
      {/* 两根符杆：右高左低，跟着符头的位置走 */}
      <path d="M19 34.5V14.5M35 31.5V11.5" fill="none" />
      {/* 符杠：把两根符杆顶端连成一条粗斜线（粗一点才像谱面上的符杠，而不是多一根线） */}
      <path d="M19 14.5 35 11.5" strokeWidth={4.4} fill="none" />
      <NoteHead cx={14.6} cy={34.5} rx={4.7} ry={3.5} />
      <NoteHead cx={30.6} cy={31.5} rx={4.7} ry={3.5} />
    </g>
  )
}

/** 歌手：麦克风（话筒头 + 支架弧 + 立杆 + 底座）。
 *  和音符同一套 2.6 描边、同样只留四个元素 —— 换的是题材，不是画法。 */
function Microphone(): React.JSX.Element {
  return (
    <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" fill="none">
      {/* 话筒头：rx 取半宽即得胶囊形 */}
      <rect x={18.4} y={9.5} width={11.2} height={19} rx={5.6} />
      {/* 支架：抱着话筒头的 U 形弧 */}
      <path d="M15.2 21.5v3.4c0 4.9 3.9 8.8 8.8 8.8s8.8-3.9 8.8-8.8v-3.4" />
      <path d="M24 33.7V38.5" />
      <path d="M18.6 38.5h10.8" />
    </g>
  )
}
