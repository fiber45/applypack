import { useMemo } from 'react'

import { buildReportView, matchArchive } from '../../core/src/match/index'
import { SAMPLE_LIMIT, SAMPLE_NOW, sampleArchive, sampleJd } from './demo/sample'
import { MatchReport } from './features/match-report/MatchReport'

/**
 * Demo 外壳。
 *
 * ## 它现在**只**有匹配报告，这是刻意的
 *
 * Web 端的完整形态是「档案编辑 / 生成 / 预览 / 导出」四块（DESIGN 3.1），
 * 那些属于各自的任务（M5 / M6）。现在把外壳做到「能打开、能看到一块真东西」
 * 就停 —— 一个铺满空壳页面的骨架比只有一个真页面的骨架更难看懂。
 *
 * ## 这一页没有任何网络请求
 *
 * 不是「我们没写请求」，是**结构上没有可以发请求的东西**：`matchArchive` 与
 * `buildReportView` 都来自 `core`，而 `core` 的 `tsconfig` 里 `lib` 不含 DOM、
 * 也没有任何运行时依赖。这段链路里没有一个 API 名字，也没有 `await`。
 * 演示时可以直接开 DevTools 的 Network 面板证明这一点 —— M6.4 要求的
 * 那个验证步骤，从这里开始就已经成立了。
 */
export function App() {
  const view = useMemo(
    () => buildReportView(matchArchive(sampleArchive, sampleJd, { now: SAMPLE_NOW, limit: SAMPLE_LIMIT })),
    [],
  )

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-lg font-semibold text-slate-900">applypack · 匹配报告</h1>
        <p className="mt-1 text-sm text-slate-500">
          样本档案与 JD 都是虚构数据。整条链路跑在浏览器里，全程零网络请求。
        </p>
      </header>

      <MatchReport view={view} />
    </main>
  )
}
