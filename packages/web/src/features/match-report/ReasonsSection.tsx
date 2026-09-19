import type { MatchReportRow } from '../../../../core/src/match/index'
import { formatPoints, NO_REASONS_TEXT, SECTION_TITLES } from './format'

/**
 * 逐条理由 —— T2.2 那句「为什么删了我这段实习」在界面上的落点。
 *
 * `impact` 的语义是**相对满分的差额**（命中项 = 0，失分项为负）。
 * 这里刻意把 `0` 也显示出来，而不是把「没有失分」渲染成空白：
 * 空白要被读成「没检查」，`0` 才能被读成「检查了，没失分」。
 *
 * 理由数组为空时给一句明确的话（`NO_REASONS_TEXT`），不留空框 ——
 * 一个空的「逐条理由」小节与一个渲染失败的小节在屏幕上一模一样。
 */
export function ReasonsSection({ row }: { readonly row: MatchReportRow }) {
  return (
    <section data-section="reasons" aria-label={SECTION_TITLES.reasons}>
      <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {SECTION_TITLES.reasons}
      </h4>
      {row.reasons.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500" data-role="no-reasons">
          {NO_REASONS_TEXT}
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {row.reasons.map((reason, index) => (
            // 理由没有稳定 id，且同一 kind 可能重复出现（同名技能不会，但
            // 未来换 JD 结构时不保证）—— 用「种类 + 下标」做键，比只按下标稳定。
            <li
              key={`${reason.kind}-${index}`}
              data-reason-kind={reason.kind}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="text-slate-700" data-role="reason-label">
                {reason.label}
              </span>
              <span className="font-mono text-slate-900" data-role="reason-impact">
                {formatPoints(reason.impact)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
