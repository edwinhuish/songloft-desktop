/**
 * 默认封面：没有封面图（或图挂了）时显示的那一张。
 *
 * 视觉是**淡灰底 + 中灰记号**：底比记号更淡一档（tokens.css 的 `--cover-art-*`，
 * 刻意不跟主题色走）。类型**只由图案区分** ——
 *   * 歌曲 = 单音符（八分音符）；
 *   * 歌单 = 双音符（两个符头被一根符杠连起来：一份「集合」）；
 *   * 歌手 = 麦克风（人像与「音符数量」这条线不搭，换成同线条语言的麦克风）。
 * 线条、线宽、符头尺寸三类一致，并排看才是同一套东西。
 *
 * 刻意**不按名字/类型换色相**：早先那版按名字哈希出五花八门的色相，
 * 在长列表里太吵 —— 默认封面的职责是「安静地把位置占上」，不是抢封面本身的戏。
 *
 * 音符照**谱面**的比例画，而不是照「图标」画（几处讲究见下面的注释）：同一份代码要同时
 * 服务 20px（标题栏）与 640px（详情页大图），图案越接近乐器上的真实样子，放大后越经得起看。
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

/**
 * 符头：音符的共用零件。
 *
 * 谱面上符头的长轴是**向右上**倾斜的（约 20°~25°），不是正椭圆 —— 这一道倾斜是「像音符」
 * 与「像一个椭圆」之间最大的差别，所以宁可把角度写死也不用正圆。
 * 双音符要并排塞下两个，半径可传（形状比例不变，只等比缩小）。
 */
function NoteHead({
  cx,
  cy,
  rx = 5.4,
  ry = 4
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
      transform={`rotate(-22 ${cx} ${cy})`}
    />
  )
}

/** 歌曲：单音符 —— 符头在左下，符杆紧贴符头右缘立起，符尾从杆顶向右甩出再垂下。
 *  符尾的起点切向接近水平（`c5.4 .9 …` 的第一个控制点几乎不抬高），这一笔比旧版的
 *  斜起笔更像谱面上甩出来的符尾。 */
function SingleNote(): React.JSX.Element {
  return (
    <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M23.9 32.8V12.4c5.4.9 9.3 3.6 9.3 8.6" fill="none" />
      <NoteHead cx={18.7} cy={32.9} />
    </g>
  )
}

/** 歌单：双音符 —— 两个符头、两根符杆，顶端被**符杠**连成一体。
 *  与单音符唯一的差别就是「多一个」，这正是要的：一眼看出「一张是单曲，一串是歌单」。
 *
 *  符杠比符杆粗近一倍（4.8 : 2.6）—— 谱面上的符杠就是明显粗于符杆的，若按同宽画，
 *  放大后会被读成「多连了一根线」，而不是「两个音符连在一起」。 */
function DoubleNote(): React.JSX.Element {
  return (
    <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
      {/* 两根符杆：右高左低，跟着各自符头的位置走 */}
      <path d="M19.7 35.4V14.4M35.7 32.4V11.4" fill="none" />
      <path d="M19.7 14.4 35.7 11.4" strokeWidth={4.8} fill="none" />
      <NoteHead cx={14.8} cy={35.4} rx={5.1} ry={3.75} />
      <NoteHead cx={30.8} cy={32.4} rx={5.1} ry={3.75} />
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
