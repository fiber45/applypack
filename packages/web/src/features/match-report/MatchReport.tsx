import { useState } from 'react'

import type {
  MatchReportRow as MatchRow,
  MatchReportView,
} from '../../../../core/src/match/index'
import { CompositionSection } from './CompositionSection'
import { expandControlText, formatPoints, statusLabel } from './format'
import { ReasonsSection } from './ReasonsSection'
import { VerdictSection } from './VerdictSection'

/** 测试与文档共用的锚点，写在一处，避免两侧各记一个字符串。 */
export const MATCH_REPORT_TEST_ID = 'match-report'
export const MATCH_ROW_TEST_ID = 'match-row'

/**
 * 匹配报告 —— T2.3 的两条验收都在这个文件与它下面那三个小节里落地。
 *
 * ## 一行一个 `useState`，而不是「当前展开哪一行」
 *
 * 折叠状态是**每行自己的**，所以它就该是每行自己的 state。用外层一个
 * `expandedEntryId` 也能写，代价是「同时展开两条」变成不可能 —— 而
 * 「这个入选的为什么比我那段实习分高」恰恰需要把两条摊开对照着看。
 * 界面上的一个便利决定，在这里多花了一个 `useState`，值。
 *
 * ## 折叠 = 不渲染，不是藏起来
 *
 * 明细用条件渲染，不渲染成 `hidden` 的元素。两个理由：
 * 1. 一屏几十条要点时，DOM 里躺着全部明细会让「扫一眼列表」变慢；
 * 2. **测试要能分辨「折叠」与「展开」**。用 `hidden` 的话，
 *    「默认折叠」这条断言就只能去查 CSS，而 CSS 不是这条验收的意思。
 *
 * @see TASKS.md T2.3 · `core/match/report.ts` 文件头（视图模型的形状从哪来）
 */
export function MatchReport({ view }: { readonly view: MatchReportView }) {
  return (
    <section
      data-testid={MATCH_REPORT_TEST_ID}
      aria-label="匹配报告"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-3">
        <h2 className="text-base font-semibold text-slate-900">匹配报告</h2>
        <p className="text-sm text-slate-500">
          {`入选 ${view.selectedCount} 条 · 淘汰 ${view.rejectedCount} 条 · 入选线 ${formatPoints(view.cutoff)} 分`}
        </p>
      </header>

      <ol className="mt-3 space-y-2">
        {view.rows.map((row) => (
          <ReportRow key={row.entryId} row={row} cutoff={view.cutoff} />
        ))}
      </ol>
    </section>
  )
}

function ReportRow({ row, cutoff }: { readonly row: MatchRow; readonly cutoff: number }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <li
      data-testid={MATCH_ROW_TEST_ID}
      data-status={row.status}
      data-entry-id={row.entryId}
      className={`rounded-md border px-3 py-2 ${
        row.status === 'selected' ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-slate-400" data-role="row-rank">
          {row.rank}
        </span>
        <span className="text-sm font-medium text-slate-900" data-role="row-label">
          {row.label}
        </span>
        <span
          data-role="row-status"
          className={`rounded px-1.5 py-0.5 text-xs ${
            row.status === 'selected'
              ? 'bg-indigo-50 text-indigo-700'
              : 'bg-slate-200 text-slate-600'
          }`}
        >
          {statusLabel(row.status)}
        </span>
        <span className="ml-auto font-mono text-sm text-slate-900" data-role="row-total">
          {formatPoints(row.total)}
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((previous) => !previous)}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
        >
          {expandControlText(expanded, row)}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
          <CompositionSection row={row} />
          <ReasonsSection row={row} />
          <VerdictSection row={row} cutoff={cutoff} />
        </div>
      ) : null}
    </li>
  )
}
