import type { MatchReportRow } from '../../../../core/src/match/index'
import { formatPoints, formatRatio, SECTION_TITLES } from './format'

/**
 * 分数构成 —— 「逐条可展开查看」展开后要看到的第一块。
 *
 * ## 四行恒在，**包括得 0 分的那行**
 *
 * `row.composition` 由 `core/match/report.ts` 保证恒为四项，这里就直接 `map`，
 * 不做任何过滤。看起来「把 0 分的项藏起来更清爽」—— 但那样一来，
 * 一个近乎满分的条目展开后只剩一行，而被淘汰的条目展开后有四行，
 * 用户会以为界面只帮他检查了一项。**结构上能做对的事，不要在渲染层再犯一次。**
 *
 * ## 数字直接用 `formatPoints`，界面不重新舍入
 *
 * `contribution` 已经在 core 里用最大余数法分配好，四项相加**精确等于**总分。
 * 界面上再 `toFixed(1)` 一次就可能把这个性质破坏掉（同一个数舍两次会漂），
 * 于是「用户把四个数加起来发现不等于总分」—— 那会让整套打分看起来是编的。
 */
export function CompositionSection({ row }: { readonly row: MatchReportRow }) {
  return (
    <section data-section="composition" aria-label={SECTION_TITLES.composition}>
      <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {SECTION_TITLES.composition}
      </h4>
      <ul className="mt-2 space-y-2">
        {row.composition.map((item) => (
          <li key={item.dimension} data-dimension={item.dimension}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-700" data-role="dimension-label">
                {item.label}
              </span>
              <span className="font-mono text-sm text-slate-900">
                <span data-role="contribution">{formatPoints(item.contribution)}</span>
                <span className="text-slate-400">
                  {' / '}
                  <span data-role="max-contribution">{formatPoints(item.maxContribution)}</span>
                </span>
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-slate-200" aria-hidden="true">
                <div
                  className="h-1.5 rounded-full bg-indigo-500"
                  style={{ width: formatRatio(item.raw) }}
                />
              </div>
              <span className="w-10 text-right font-mono text-xs text-slate-500">
                <span data-role="dimension-raw">{formatRatio(item.raw)}</span>
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500" data-role="dimension-hint">
              {item.hint}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
