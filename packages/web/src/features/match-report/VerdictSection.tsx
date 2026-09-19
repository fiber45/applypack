import type { MatchReportRow } from '../../../../core/src/match/index'
import { formatPoints, formatSignedPoints, SECTION_TITLES } from './format'

type RejectedRow = Extract<MatchReportRow, { status: 'rejected' }>
type SelectedRow = Extract<MatchReportRow, { status: 'selected' }>

/**
 * 结论 —— 展开后第三块，也是「淘汰项与选中项同等可查」最容易被做坏的地方。
 *
 * ## 唯一的结构风险：淘汰行被简化成一句话
 *
 * 一个很自然的写法是：
 *
 * ```tsx
 * {row.status === 'rejected' ? (
 *   <p>{row.rejection.summary}</p>       // 一行结论就够了
 * ) : (
 *   <Everything />                        // 入选的才给完整面板
 * )}
 * ```
 *
 * 它读起来合理，实现也短，结果是**被淘汰的那条反而信息更少** ——
 * 而那条恰好是用户唯一有动力点开的。所以两个分支返回**同一种骨架**：
 *
 * | 位置 | 两种状态都用同一个 `data-role` | 内容来源不同 |
 * |---|---|---|
 * | 总述 | `verdict-summary` | 淘汰 → `rejection.summary`；入选 → 名次 + 入选线 |
 * | 关键项 | `verdict-primary` | 淘汰 → 主要失分；入选 → 满分项个数 |
 * | 差值 | `verdict-delta` | 两者都是 `总分 − 入选线`，只是符号不同 |
 * | 入选线 | `verdict-cutoff` | 同一个数 |
 *
 * 于是「两种状态面板一样厚」这件事**可以被断言**，而不是靠 code review。
 * 只有一个角色是淘汰项独有的（`overtaken`：被谁挤掉）—— 因为「被谁挤掉」
 * 对入选项没有意义，硬造一个对称的位置反而是在编内容。
 *
 * `row` 是判别联合，所以 `row.status === 'rejected'` 分支里 `rejection` 必定非空，
 * **这一层连一句空值判断都写不出来** —— 信息不可能在这里悄悄消失。
 */
export function VerdictSection({
  row,
  cutoff,
}: {
  readonly row: MatchReportRow
  readonly cutoff: number
}) {
  return (
    <section data-section="verdict" aria-label={SECTION_TITLES.verdict}>
      <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {SECTION_TITLES.verdict}
      </h4>

      <p className="mt-2 text-sm text-slate-700" data-role="verdict-summary">
        {row.status === 'rejected'
          ? row.rejection.summary
          : `入选（第 ${row.rank} 名）。`}
      </p>

      <p className="mt-1 text-sm text-slate-700" data-role="verdict-primary">
        {row.status === 'rejected' ? <RejectedPrimary row={row} /> : <SelectedPrimary row={row} />}
      </p>

      <p className="mt-1 text-sm text-slate-500">
        {row.status === 'rejected' ? '距入选线 ' : '高于入选线 '}
        <span className="font-mono text-slate-900" data-role="verdict-delta">
          {formatSignedPoints(row.total - cutoff)}
        </span>
        {' 分'}
      </p>

      <p className="mt-1 text-sm text-slate-500" data-role="verdict-cutoff">
        {`入选线 ${formatPoints(cutoff)} 分`}
      </p>

      {row.status === 'rejected' ? <OvertakenList row={row} /> : null}
    </section>
  )
}

/**
 * `blockingReason` 可以为 `null`（四项都没有明显短板，纯粹排在入选线之后）。
 * 那不是「没有信息」，是一个需要说明白的状态 —— 所以给一句确定的文案，
 * 而不是渲染空白行。空白行会被读成「这里坏了」。
 */
function RejectedPrimary({ row }: { readonly row: RejectedRow }) {
  const blocking = row.rejection.blockingReason
  return blocking === null ? (
    <span data-role="verdict-blocking-none">各项指标均无明显短板，只是排在入选线之后。</span>
  ) : (
    <span data-role="verdict-blocking">{`主要失分：${blocking.label}（${formatPoints(blocking.impact)} 分）`}</span>
  )
}

/**
 * 入选项的关键项。刻意**不**写「无需解释」就完事 —— 那样两个分支的厚度就不一样了，
 * 而厚度不一样正是「不同等可查」的起点。这里给的是一个同类的量：
 * 有多少项拿了满分。
 */
function SelectedPrimary({ row }: { readonly row: SelectedRow }) {
  const fullMarks = row.reasons.filter((reason) => reason.impact === 0).length
  return fullMarks === 0 ? (
    <span data-role="verdict-strength-none">没有未失分的单项，它靠没有明显短板入选。</span>
  ) : (
    <span data-role="verdict-strength">{`满分项 ${fullMarks} 个，未失分。`}</span>
  )
}

function OvertakenList({ row }: { readonly row: RejectedRow }) {
  if (row.rejection.overtakenBy.length === 0) {
    return (
      // `limit: 0` 时没有入选项，也就没有被谁挤掉这回事。留一句确定的话，
      // 而不是省略整块 —— 省略会让两种情况的面板厚度不同。
      <p className="mt-1 text-sm text-slate-500" data-role="overtaken-empty">
        本次没有任何条目入选，不存在「被谁挤掉」。
      </p>
    )
  }

  return (
    <ul className="mt-1 space-y-0.5" data-role="overtaken">
      {row.rejection.overtakenBy.map((entry) => (
        <li
          key={entry.entryId}
          className="flex items-baseline justify-between gap-3 text-sm text-slate-500"
        >
          <span data-role="overtaken-label">{`分数最接近的入选条目：${entry.label}`}</span>
          <span className="font-mono" data-role="overtaken-total">
            {formatPoints(entry.total)}
          </span>
        </li>
      ))}
    </ul>
  )
}
