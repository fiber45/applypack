/**
 * 评测集的 CI 入口。
 *
 * 四组断言，各自的必要性不同：
 *
 * 1. **用例本身的完整性** —— 60 条全落在 `hallucinated_number` 上也能凑够数量，
 *    所以「总数」与「每种场景都有」分开检查
 * 2. **闸门在评测集上的表现** —— 这一条就是 CI 阻断项本身
 * 3. **确定性** —— 跑两遍逐字相同。它是「同一 `(profile, JD)` 通过与否高度一致」
 *    这句话唯一的实现方式（AGENTS.md §7 要求的可复现性）
 * 4. **反向验证** —— 前三组都有可能因为「评测器坏了、永远返回空问题列表」
 *    而全绿。这一组专门证明它不是永远绿的
 *
 * 第 4 组是本文件里最该被认真写的。前 3 组绿不绿只说明「当前没有已知问题」，
 * 第 4 组才说明「这个判据有能力发现问题」。
 */

import { describe, expect, it } from 'vitest'

import { COLLECTED, EVAL_CASES } from './cases'
import { coverageProblems, formatFailures, runCase, runCases } from './runner'
import { validateCase, type EvalCase } from './schema'

/** TASKS.md T3.4 的下限。写在这里而不是散在断言里，是为了让「凑数」无处可藏。 */
const MINIMUM_CASES = 30

function problemText(problems: readonly { origin: string; path: string; message: string }[]): string {
  return problems.map((problem) => `${problem.origin} → ${problem.path}: ${problem.message}`).join('\n')
}

describe('用例集本身的完整性', () => {
  it('每个用例文件都通过结构校验（字段、kind、失败原因）', () => {
    expect(problemText(COLLECTED.problems)).toBe('')
  })

  it(`用例数不少于 ${MINIMUM_CASES} 条，且每一种场景都有覆盖`, () => {
    const run = runCases(EVAL_CASES)
    expect(coverageProblems(run, MINIMUM_CASES)).toEqual([])
    // 顺带把分布打出来 —— 覆盖是否均衡，报告里一眼能看出
    expect(Object.values(run.byKind).every((count) => count > 0)).toBe(true)
  })

  it('id 唯一（重名会让报告指向两条不同的用例）', () => {
    const ids = EVAL_CASES.map((testCase) => testCase.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('闸门在评测集上的表现 —— CI 阻断项', () => {
  it('全部用例通过', () => {
    const run = runCases(EVAL_CASES)
    expect(formatFailures(run)).toBe(`全部 ${run.total} 条用例通过。`)
  })
})

describe('确定性', () => {
  it('同一批用例跑两遍，结果逐字相同', () => {
    const first = runCases(EVAL_CASES)
    const second = runCases(EVAL_CASES)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('反向验证：评测器不是永远绿的', () => {
  function caseById(id: string): EvalCase {
    const found = EVAL_CASES.find((testCase) => testCase.id === id)
    if (found === undefined) throw new Error(`找不到用例 ${id}`)
    return found
  }

  it('把一条「该通过」的用例改成期望失败 → 立刻报「pass 判断相反」', () => {
    const tampered: EvalCase = {
      ...caseById('clean-01'),
      expect: { pass: false, failures: [{ reason: 'too_long', bulletId: 'b0' }] },
    }
    const result = runCase(tampered)
    expect(result.problems.join('\n')).toContain('pass 判断相反')
  })

  it('把一条「该拦截」的用例的期望数字改掉 → 报「漏报」而不是静默通过', () => {
    const tampered: EvalCase = {
      ...caseById('hallu-01'),
      expect: {
        pass: false,
        failures: [{ reason: 'number_not_in_source', bulletId: 'b0', offending: '41' }],
      },
    }
    const result = runCase(tampered)
    expect(result.problems.join('\n')).toContain('漏报')
  })

  it('少报一条失败 → 报「多报」，与「漏报」区分开', () => {
    const tampered: EvalCase = {
      ...caseById('hallu-06'),
      expect: {
        pass: false,
        failures: [{ reason: 'number_not_in_source', bulletId: 'b0', offending: '15' }],
      },
    }
    const result = runCase(tampered)
    const text = result.problems.join('\n')
    expect(text).toContain('多报')
    expect(text).not.toContain('漏报')
  })

  it('标错标签的用例被结构校验拦下（kind 与期望原因对不上）', () => {
    const problems = validateCase(
      {
        id: 'mislabeled',
        kind: 'overlong',
        note: '标着超长，实际期望被动语态',
        input: { bullets: [{ id: 'b0', text: '随便一句' }], sources: ['随便一句'] },
        expect: { pass: false, failures: [{ reason: 'passive_voice', bulletId: 'b0' }] },
      },
      'inline',
    )
    expect(problems.map((problem) => problem.path)).toContain('expect.failures')
  })

  it('少一种场景的用例被覆盖率自检拦下', () => {
    const subset = EVAL_CASES.filter((testCase) => testCase.kind !== 'language_parity')
    const problems = coverageProblems(runCases(subset), MINIMUM_CASES)
    expect(problems.join('\n')).toContain('language_parity')
  })

  it('用例数不足被拦下', () => {
    const problems = coverageProblems(runCases(EVAL_CASES.slice(0, 5)), MINIMUM_CASES)
    expect(problems.join('\n')).toContain('少于要求')
  })
})
