/**
 * 评测执行器 —— 确定性、无网络、可被 CI 当作阻断项。
 *
 * ## 为什么报告要写「漏报 / 多报 / 数值不符」三种
 *
 * 一句「用例 hallu-01 失败」等于没说。三种问题对应三种完全不同的处置：
 *
 *   - **漏报**：闸门该拦的没拦 —— 这是**安全性**问题，最严重
 *   - **多报**：闸门拦了不该拦的 —— 这是**可用性**问题（用户会被挡住）
 *   - **数值不符**：判对了方向但细节错了（例如 `offending` 指了另一个数字）——
 *     这是**可解释性**问题：用户拿到的理由指错了地方
 *
 * 合成一个布尔值之后，一次「多报」与一次「漏报」看起来一模一样，
 * 而这正是评测集最该替人分清楚的事。
 *
 * ## 这里的断言为什么可以这么严
 *
 * 闸门是纯函数（AGENTS.md 红线 6），所以同一条用例的结果是**逐字可复现**的。
 * 于是期望可以写成「失败集合恰好等于这些」，而不是「至少包含」——
 * 「至少包含」会让一个新增的误报悄悄混进去。
 */

import {
  textsParity,
  verifyBullets,
  type Bullet,
  type CompiledJd,
  type Failure,
} from '../../core/src/index'
import { EVAL_KINDS, KIND_EXPECTED_REASON, type EvalCase, type EvalKind } from './schema'

export interface CaseResult {
  readonly id: string
  readonly kind: EvalKind
  readonly note: string
  /** 空数组即通过 */
  readonly problems: readonly string[]
}

export interface EvalRun {
  readonly total: number
  readonly passed: number
  readonly failed: readonly CaseResult[]
  /** 每个 kind 实际跑了多少条 —— 「凑够 30 条」不该靠一个类型堆量 */
  readonly byKind: Readonly<Record<string, number>>
}

/** 由技能词造一个最小 JD。用例只关心「要求哪些词」，其余字段不是考点。 */
export function jdOf(skills: readonly string[]): CompiledJd {
  return {
    title: '评测岗位',
    company: null,
    hardRequirements: [],
    skills: skills.map((name) => ({
      name,
      proficiency: 'proficient',
      required: true,
      evidence: `评测用例要求 ${name}`,
    })),
    responsibilities: [],
    register: 'technical',
    language: 'zh',
  }
}

function keyOf(failure: { reason: string; bulletId: string }): string {
  return `${failure.reason}@${failure.bulletId}`
}

function countsOf(list: readonly { reason: string; bulletId: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of list) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function compareCounts(
  expected: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
  problems: string[],
): void {
  for (const [key, count] of expected) {
    const found = actual.get(key) ?? 0
    if (found < count) problems.push(`漏报：期望 ${count} 条 ${key}，闸门只报了 ${found} 条`)
  }
  for (const [key, count] of actual) {
    const wanted = expected.get(key) ?? 0
    if (count > wanted) {
      problems.push(`多报：闸门报了 ${count} 条 ${key}，用例只期望 ${wanted} 条`)
    }
  }
}

function runGateCase(testCase: EvalCase): string[] {
  const problems: string[] = []
  const bullets: Bullet[] = [...(testCase.input.bullets ?? [])]
  const result = verifyBullets({
    bullets,
    sources: testCase.input.sources ?? [],
    jd: jdOf(testCase.input.skills ?? []),
  })

  const expected = testCase.expect
  if (expected.pass !== undefined && result.pass !== expected.pass) {
    problems.push(
      `pass 判断相反：用例期望 ${String(expected.pass)}，闸门给出 ${String(result.pass)}` +
        (result.failures.length === 0 ? '' : `（失败：${result.failures.map((f) => f.reason).join(', ')}）`),
    )
  }

  // 逐条核对。带 `offending` 的期望是**消耗式**匹配：
  // 同一条 bullet 上可以有多条同原因的失败（例如一句里编了两个数字），
  // 若不消耗，两条期望会同时匹配到第一条实际失败，第二条的真假就没人查了。
  const remaining: Failure[] = [...result.failures]
  const rest: { reason: string; bulletId: string }[] = []
  for (const wanted of expected.failures ?? []) {
    if (wanted.offending === undefined) {
      rest.push(wanted)
      continue
    }
    const index = remaining.findIndex(
      (actual) =>
        actual.reason === wanted.reason &&
        actual.bulletId === wanted.bulletId &&
        actual.offending === wanted.offending,
    )
    if (index === -1) {
      problems.push(
        `漏报：期望 ${keyOf(wanted)} 的违规内容为「${wanted.offending}」，闸门没有报出这一条`,
      )
      continue
    }
    remaining.splice(index, 1)
  }
  compareCounts(countsOf(rest), countsOf(remaining), problems)

  return problems
}

function runParityCase(testCase: EvalCase): string[] {
  const problems: string[] = []
  const expected = testCase.expect.parity
  if (expected === undefined) {
    problems.push('用例缺少 expect.parity')
    return problems
  }

  const report = textsParity(testCase.input.left ?? [], testCase.input.right ?? [])
  if (report.ok !== expected.ok) {
    problems.push(
      `一致性判断相反：用例期望 ok=${String(expected.ok)}，实际 ok=${String(report.ok)}` +
        `（左侧独有 ${report.onlyInLeft.join(',') || '无'}；右侧独有 ${report.onlyInRight.join(',') || '无'}）`,
    )
  }
  const compareList = (
    label: string,
    actual: readonly string[],
    wanted: readonly string[] | undefined,
  ): void => {
    if (wanted === undefined) return
    if (actual.join(',') !== wanted.join(',')) {
      problems.push(`${label}：用例期望 [${wanted.join(',')}]，实际 [${actual.join(',')}]`)
    }
  }
  compareList('onlyInLeft', report.onlyInLeft, expected.onlyInLeft)
  compareList('onlyInRight', report.onlyInRight, expected.onlyInRight)

  return problems
}

export function runCase(testCase: EvalCase): CaseResult {
  const problems =
    testCase.kind === 'language_parity' ? runParityCase(testCase) : runGateCase(testCase)
  return { id: testCase.id, kind: testCase.kind, note: testCase.note, problems }
}

export function runCases(cases: readonly EvalCase[]): EvalRun {
  const results = cases.map(runCase)
  const byKind: Record<string, number> = {}
  for (const kind of EVAL_KINDS) byKind[kind] = 0
  for (const result of results) byKind[result.kind] = (byKind[result.kind] ?? 0) + 1

  const failed = results.filter((result) => result.problems.length > 0)
  return { total: results.length, passed: results.length - failed.length, failed, byKind }
}

/** 失败明细。CI 里被打出来的就是这一段，所以它必须能直接读。 */
export function formatFailures(run: EvalRun): string {
  if (run.failed.length === 0) return `全部 ${run.total} 条用例通过。`
  const lines = [`${run.failed.length} / ${run.total} 条用例未通过：`]
  for (const result of run.failed) {
    lines.push(`\n  [${result.kind}] ${result.id} —— ${result.note}`)
    for (const problem of result.problems) lines.push(`      · ${problem}`)
  }
  return lines.join('\n')
}

/**
 * 覆盖率自检。
 *
 * 用例数够不等于覆盖够：36 条全落在 `hallucinated_number` 上，
 * 一个数字凑够了、其余六个场景一条没测。所以这里同时检查
 * **总数**与**每种 kind 都有**。
 */
export function coverageProblems(
  run: EvalRun,
  minimum: number,
): readonly string[] {
  const problems: string[] = []
  if (run.total < minimum) problems.push(`用例总数 ${run.total} 少于要求的 ${minimum} 条`)
  for (const kind of EVAL_KINDS) {
    const count = run.byKind[kind] ?? 0
    if (count === 0) problems.push(`没有任何用例覆盖 ${kind}（预期原因：${String(KIND_EXPECTED_REASON[kind])}）`)
  }
  return problems
}
