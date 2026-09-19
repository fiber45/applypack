/**
 * T2.3 在 DOM 层的两条验收。
 *
 * ## 这个文件只验一件事：界面有没有把**已经拿到的信息**藏起来
 *
 * 算术（四项构成相加等于总分、判别联合排除「淘汰但没解释」）全部在
 * `core/match/report.test.ts` 里验过了 —— 那里是零 DOM 环境，跑得快。
 * 这里验的是渲染：折叠有没有真的折、每一条能不能展开、
 * **被淘汰的那一条展开后与入选的那一条是不是一样厚**。
 *
 * ## 两条容易写成恒真的断言，以及它们各自的反面
 *
 * | 想验的 | 会写成恒真的写法 | 这里怎么写 |
 * |---|---|---|
 * | 每一条都可展开 | 「存在展开按钮」—— 只要有一行有就过 | 按钮数 **=== 行数**，且逐个检查 `aria-expanded` |
 * | 两种状态同等可查 | 「都有三个小节」—— 若渲染根本没跑，两边都是空数组，也相等 | 先钉死小节集合**非空且等于确定的三项**，再比两边是否相同 |
 *
 * 第二条是本文件最容易自我欺骗的地方：**「A 等于 B」在 A、B 都为空时也成立**。
 * 所以下面每一条对称性断言之前，都有一条非平凡性断言。
 */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  buildReportView,
  matchArchive,
  type MatchReportRow,
  type MatchReportView,
} from '../../../../core/src/match/index'
import { SAMPLE_LIMIT, SAMPLE_NOW, sampleArchive, sampleJd } from '../../demo/sample'
import {
  expandControlText,
  formatPoints,
  formatSignedPoints,
  SECTION_TITLES,
} from './format'
import { MATCH_REPORT_TEST_ID, MATCH_ROW_TEST_ID, MatchReport } from './MatchReport'

/**
 * 样本刻意选的是 Demo 那一份而不是新造一份：
 * 界面上能演示的东西与断言里验的东西**必须是同一批数据**，
 * 否则会出现「测试全绿但 Demo 上看得出来不对劲」这种最难查的状态。
 *
 * 这份样本已知含：入选 3 条、淘汰 3 条、至少一个 raw === 0 的维度、
 * 至少一个 raw === 1 的维度 —— 下面几条非平凡性断言会把它们钉住。
 */
const VIEW = buildReportView(matchArchive(sampleArchive, sampleJd, { now: SAMPLE_NOW, limit: SAMPLE_LIMIT }))

const EXPECTED_SECTIONS = ['composition', 'reasons', 'verdict']

function pick<T>(items: readonly T[], index: number): T {
  const value = items[index]
  if (value === undefined) throw new Error(`样本里缺少下标 ${index} —— 数据变了`)
  return value
}

function rowsOf(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="${MATCH_ROW_TEST_ID}"]`))
}

function elementsOf(root: HTMLElement, role: string): readonly HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-role="${role}"]`))
}

function textsOf(root: HTMLElement, role: string): readonly string[] {
  return elementsOf(root, role).map((element) => (element.textContent ?? '').trim())
}

function textOf(root: HTMLElement, role: string): string {
  return textsOf(root, role)[0] ?? ''
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** 到 0.1 的整数倍上比较 —— 浮点和不能直接比。 */
function tenths(value: number): number {
  return Math.round(value * 10)
}

function expandButtonOf(row: HTMLElement): HTMLElement {
  const button = row.querySelector<HTMLElement>('button[aria-expanded]')
  if (button === null) {
    throw new Error(`这一行没有展开控件：${row.dataset['entryId'] ?? '?'}`)
  }
  return button
}

function toggle(row: HTMLElement): void {
  fireEvent.click(expandButtonOf(row))
}

function sectionIdsOf(row: HTMLElement): readonly string[] {
  return Array.from(row.querySelectorAll<HTMLElement>('[data-section]')).map(
    (element) => element.dataset['section'] ?? '',
  )
}

function renderReport(view: MatchReportView = VIEW): HTMLElement {
  return render(<MatchReport view={view} />).container
}

describe('逐条可展开查看分数构成（T2.3 第一条勾）', () => {
  it('打开时全部折叠：明细不在 DOM 里', () => {
    const container = renderReport()
    expect(Array.from(container.querySelectorAll('[data-section]'))).toHaveLength(0)
    // 折叠 ≠ 藏起来：连一句话都不该出现。用 `hidden` 实现的话，「折叠」这条验收
    // 就只能去查 CSS 了，而那不是它的意思。
    expect(container.textContent).not.toContain(SECTION_TITLES.composition)
  })

  it('每一行都有展开控件，条数恰好等于条目数', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    // 非平凡性前提：样本里两种状态都得有，不然下面几条对称性断言无从谈起。
    expect(VIEW.selectedCount).toBeGreaterThan(0)
    expect(VIEW.rejectedCount).toBeGreaterThan(0)
    expect(rows).toHaveLength(VIEW.rows.length)

    const buttons = rows.map(expandButtonOf)
    expect(buttons).toHaveLength(VIEW.rows.length)
    for (const button of buttons) expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('展开控件的名字指名了它展开的是哪一条', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    rows.forEach((row, index) => {
      const data = pick(VIEW.rows, index)
      // 名字来自与组件共用的那个函数 —— 断言不会因为改了文案就失效，
      // 但会因为「忘记写名次 / 忘记写条目名」而红。
      expect(expandButtonOf(row).textContent?.trim()).toBe(expandControlText(false, data))
    })
  })

  it('点开一条只展开那一条', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    toggle(pick(rows, 0))
    expect(sectionIdsOf(pick(rows, 0))).toEqual(EXPECTED_SECTIONS)
    expect(sectionIdsOf(pick(rows, 1))).toHaveLength(0)
    expect(expandButtonOf(pick(rows, 0)).getAttribute('aria-expanded')).toBe('true')
    expect(expandButtonOf(pick(rows, 1)).getAttribute('aria-expanded')).toBe('false')
  })

  it('可以同时展开多条 —— 对照两条经历是这份报告的主要用法', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    toggle(pick(rows, 0))
    toggle(pick(rows, 1))
    expect(sectionIdsOf(pick(rows, 0))).toEqual(EXPECTED_SECTIONS)
    expect(sectionIdsOf(pick(rows, 1))).toEqual(EXPECTED_SECTIONS)
  })

  it('再点一次收回去', () => {
    const container = renderReport()
    const row = pick(rowsOf(container), 0)
    toggle(row)
    toggle(row)
    expect(sectionIdsOf(row)).toHaveLength(0)
    expect(expandButtonOf(row).getAttribute('aria-expanded')).toBe('false')
  })

  it('展开后四项分数构成按固定顺序出现，标签与数据一致', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    rows.forEach((row, index) => {
      toggle(row)
      const data = pick(VIEW.rows, index)
      expect(textsOf(row, 'dimension-label')).toEqual(data.composition.map((item) => item.label))
      expect(elementsOf(row, 'contribution')).toHaveLength(data.composition.length)
      expect(textsOf(row, 'dimension-hint').every((hint) => hint.length > 0)).toBe(true)
    })
  })

  it('屏幕上四项相加等于该行总分 —— 用户可以自己把数加起来核对', () => {
    // 这是 T2.2 那句「能把报告上的数加起来验证」在界面上的兑现。
    // core 用最大余数法保证了这个恒等式**精确**成立，所以这里可以要求到 0.1 分。
    const container = renderReport()
    const rows = rowsOf(container)
    rows.forEach((row, index) => {
      toggle(row)
      const data = pick(VIEW.rows, index)
      const contributions = textsOf(row, 'contribution').map(Number)
      const total = Number(textOf(row, 'row-total'))

      expect(contributions).toHaveLength(data.composition.length)
      expect(tenths(sum(contributions))).toBe(tenths(total))
    })
  })

  it('显示的就是那套口径：逐格文本等于共享格式化函数的输出', () => {
    // **比文本，不比数字。** 数值比会被 `toFixed(2)` 骗过去 ——
    // `Number('4.10') === 4.1`，于是「界面自己再格式化一遍」不会被发现。
    // 而它是有代价的：项目里一旦存在第二套数字口径，下一次改口径就只改一处，
    // 界面上会出现两个都「看起来对」却互不相等的数。
    //
    // 这条断言在变异测试里是**唯一**能抓住 `formatPoints → toFixed(2)` 的一条，
    // 所以它不是在验格式化本身，是在验「只有一套口径」。
    const container = renderReport()
    const rows = rowsOf(container)
    rows.forEach((row, index) => {
      const data = pick(VIEW.rows, index)
      toggle(row)
      expect(textsOf(row, 'contribution')).toEqual(
        data.composition.map((item) => formatPoints(item.contribution)),
      )
      expect(textsOf(row, 'max-contribution')).toEqual(
        data.composition.map((item) => formatPoints(item.maxContribution)),
      )
      expect(textOf(row, 'row-total')).toBe(formatPoints(data.total))
      expect(textsOf(row, 'dimension-hint')).toEqual(
        data.composition.map((item) => item.hint),
      )
    })
  })

  it('得 0 分的维度照样显示 0，不是被省掉', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    let checked = 0

    rows.forEach((row, index) => {
      const data = pick(VIEW.rows, index)
      const zeroAt = data.composition.findIndex((item) => item.raw === 0)
      if (zeroAt === -1) return
      toggle(row)
      checked += 1
      // 四行都在，那一行的贡献正是 0 —— 「拿 0 分」与「没被检查」分得开。
      expect(textsOf(row, 'contribution')).toHaveLength(data.composition.length)
      expect(Number(pick(textsOf(row, 'contribution'), zeroAt))).toBe(0)
      expect(pick(textsOf(row, 'dimension-hint'), zeroAt).length).toBeGreaterThan(0)
    })

    // 这条是本条断言的非平凡性来源：样本里若没有 0 分维度，上面整个循环一次都不跑。
    expect(checked).toBeGreaterThan(0)
  })
})

describe('淘汰项与选中项同等可查（T2.3 第二条勾）', () => {
  /** 展开全部行，返回「每一行的小节序列」。 */
  function expandAll(container: HTMLElement): readonly (readonly string[])[] {
    const rows = rowsOf(container)
    return rows.map((row) => {
      toggle(row)
      return sectionIdsOf(row)
    })
  }

  it('前提：样本里选中项与淘汰项同时存在', () => {
    expect(VIEW.rows.some((row) => row.status === 'selected')).toBe(true)
    expect(VIEW.rows.some((row) => row.status === 'rejected')).toBe(true)
  })

  it('每一行的小节集合完全相同，且不是一个空集合', () => {
    const container = renderReport()
    const all = expandAll(container)

    // 非平凡性：先钉死它是确定的三项。
    // 少了这一句，「所有行都相同」在「所有行都没有小节」时也成立 —— 恒真。
    for (const sections of all) expect(sections).toEqual(EXPECTED_SECTIONS)
    expect(new Set(all.map((sections) => sections.join(','))).size).toBe(1)

    // 再按状态分开说一遍，确保两种状态都被覆盖到，而不是碰巧全都同一种。
    const rows = rowsOf(container)
    const rejectedSections = all.filter((_, index) => pick(rows, index).dataset['status'] === 'rejected')
    const selectedSections = all.filter((_, index) => pick(rows, index).dataset['status'] === 'selected')
    expect(rejectedSections.length).toBe(VIEW.rejectedCount)
    expect(selectedSections.length).toBe(VIEW.selectedCount)
  })

  it('淘汰行的面板不是空壳：结论小节四格齐全且都有内容', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    const rejectedRows = rows.filter((row) => row.dataset['status'] === 'rejected')
    // 非平凡性：没有淘汰行的话，下面整个循环空转。
    expect(rejectedRows.length).toBeGreaterThan(0)

    for (const row of rejectedRows) {
      toggle(row)
      expect(textOf(row, 'verdict-summary').length).toBeGreaterThan(0)
      expect(textOf(row, 'verdict-primary').length).toBeGreaterThan(0)
      expect(textOf(row, 'verdict-delta').length).toBeGreaterThan(0)
      expect(textOf(row, 'verdict-cutoff').length).toBeGreaterThan(0)
      // 被谁挤掉要么列出条目，要么明说「本次无人入选」—— 不允许整块消失。
      const overtaken =
        elementsOf(row, 'overtaken').length + elementsOf(row, 'overtaken-empty').length
      expect(overtaken).toBeGreaterThan(0)
    }
  })

  it('入选行有**同样四格** —— 不是「入选就不用解释了」', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    const selectedRows = rows.filter((row) => row.dataset['status'] === 'selected')
    expect(selectedRows.length).toBeGreaterThan(0)

    for (const row of selectedRows) {
      toggle(row)
      expect(textOf(row, 'verdict-summary').length).toBeGreaterThan(0)
      expect(textOf(row, 'verdict-primary').length).toBeGreaterThan(0)
      expect(textOf(row, 'verdict-delta').length).toBeGreaterThan(0)
      expect(textOf(row, 'verdict-cutoff').length).toBeGreaterThan(0)
    }
  })

  it('两种状态的构成与理由一样齐 —— 逐项对比，不只看「有没有」', () => {
    const container = renderReport()
    const rows = rowsOf(container)
    const shapeOf = (row: HTMLElement, data: MatchReportRow) => ({
      sections: sectionIdsOf(row),
      compositionRows: elementsOf(row, 'contribution').length,
      expectedCompositionRows: data.composition.length,
      hints: elementsOf(row, 'dimension-hint').length,
      // 理由可以是零条，但那一格必须以「没有失分」或理由行的形式**被渲染**出来。
      reasonSlots: elementsOf(row, 'reason-label').length + elementsOf(row, 'no-reasons').length,
      verdictSlots: [
        'verdict-summary',
        'verdict-primary',
        'verdict-delta',
        'verdict-cutoff',
      ].map((role) => elementsOf(row, role).length),
    })

    const shapes = rows.map((row, index) => {
      toggle(row)
      return shapeOf(row, pick(VIEW.rows, index))
    })

    for (const shape of shapes) {
      expect(shape.sections).toEqual(EXPECTED_SECTIONS)
      expect(shape.compositionRows).toBe(shape.expectedCompositionRows)
      expect(shape.hints).toBe(shape.expectedCompositionRows)
      expect(shape.reasonSlots).toBeGreaterThan(0)
      expect(shape.verdictSlots).toEqual([1, 1, 1, 1])
    }

    // 最后一步：不同行之间也必须一样。把所有形状去重后应当只剩一个。
    const distinct = new Set(
      shapes.map((shape) =>
        JSON.stringify({
          sections: shape.sections,
          compositionRows: shape.compositionRows,
          hints: shape.hints,
          verdictSlots: shape.verdictSlots,
        }),
      ),
    )
    expect(distinct.size).toBe(1)
  })

  it('差值的方向与大小对得上：入选为正、淘汰为负，且等于总分减入选线', () => {
    const container = renderReport()
    const rows = rowsOf(container)

    rows.forEach((row, index) => {
      const data = pick(VIEW.rows, index)
      toggle(row)
      const shown = textOf(row, 'verdict-delta')
      const delta = Number(shown)

      // **比文本，不比数字。** `Number('+8.3')` 与 `Number('8.3')` 都是 8.3，
      // 所以按数值比会把「正号丢了」放过去 —— 而正号正是「高于入选线」
      // 与「距入选线」两个方向在屏幕上的唯一区别。
      expect(shown).toBe(formatSignedPoints(data.total - VIEW.cutoff))

      if (data.status === 'rejected') {
        // 淘汰意味着总分不高于入选线。若这条红了，说明要么排序错了、
        // 要么界面上把差值算成了别的量。
        expect(delta).toBeLessThanOrEqual(0)
      } else {
        expect(delta).toBeGreaterThanOrEqual(0)
      }
    })
  })
})

describe('报告整体', () => {
  it('报告容器有名字，行数与状态分布与视图一致', () => {
    const container = renderReport()
    expect(container.querySelectorAll(`[data-testid="${MATCH_REPORT_TEST_ID}"]`)).toHaveLength(1)
    const rows = rowsOf(container)
    expect(rows).toHaveLength(VIEW.rows.length)
    expect(rows.filter((row) => row.dataset['status'] === 'selected')).toHaveLength(
      VIEW.selectedCount,
    )
    expect(rows.filter((row) => row.dataset['status'] === 'rejected')).toHaveLength(
      VIEW.rejectedCount,
    )
    expect(container.textContent).toContain(formatPoints(VIEW.cutoff))
  })

  it('极端档位不改变结构：全部淘汰时每一行照样可展开、照样有四格', () => {
    const none = buildReportView(
      matchArchive(sampleArchive, sampleJd, { now: SAMPLE_NOW, limit: 0 }),
    )
    const container = renderReport(none)
    const rows = rowsOf(container)
    expect(rows).toHaveLength(none.rows.length)
    expect(none.selectedCount).toBe(0)
    for (const row of rows) {
      expect(row.dataset['status']).toBe('rejected')
      toggle(row)
      expect(sectionIdsOf(row)).toEqual(EXPECTED_SECTIONS)
      expect(elementsOf(row, 'contribution')).toHaveLength(4)
      // 没有入选者时「被谁挤掉」这一格要明说，不能空着。
      expect(
        elementsOf(row, 'overtaken').length + elementsOf(row, 'overtaken-empty').length,
      ).toBeGreaterThan(0)
    }
  })
})
