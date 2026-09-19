/**
 * 匹配报告的**视图模型** —— T2.3 两条验收的落地点。
 *
 * ## 这一层存在的理由
 *
 * `MatchReport` 已经回答了「谁入选、谁被淘汰、为什么」。`MatchReportView` 再多做一件事：
 * **把「报告里有哪些信息」变成一条形状上的事实，而不是一条要靠界面自觉遵守的约定。**
 *
 * T2.3 的两条验收各自对应到这里的一个决定：
 *
 * | TASKS.md T2.3 | 在这里怎么落 |
 * |---|---|
 * | 逐条可展开查看分数构成 | 每行恒带 `composition`，四项维度、**一个不少**（见下②） |
 * | 淘汰项与选中项同等可查 | 行是**判别联合**：`status: 'rejected'` 的行上 `rejection` 不可能是 `null`（见下①） |
 *
 * ## ① 判别联合：让「淘汰但没解释」不可表达
 *
 * `MatchReportRow = SelectedReportRow | RejectedReportRow`，`rejection` 的类型随
 * `status` 变：`selected` 行是 `null`，`rejected` 行是 `RejectionExplanation`。
 * 于是「淘汰了但没给出理由」这个状态**在类型上不可表达**，界面上也就不可能写出
 * `if (row.rejection === null) return null` 这种「静默少一块」的分支。
 *
 * 这是本项目反复用同一招的地方：**把不变量做成形状约束，而不是做成注释**
 * （对照 `MatchItem` 让匹配层读不到 B 级字段、`introFacts` 让自述拿不到 `ArchiveV1`）。
 * 注释会被下一个人读漏，类型不会。
 *
 * ## ② 分数构成恒为四项：不许「只显示失分项」
 *
 * 最自然的实现是学 `reasons` 那样**只列有失分的维度** —— 看起来更干净，其实有害：
 * 一个近乎满分的选中项会只剩一行，而一个被淘汰的条目会列满四行。用户看到的是
 * 「选中的那条只被检查了一项，淘汰的那条被检查了四项」，恰恰把「同等可查」反过来了。
 * 更糟的是这个信息差**没有任何症状**：两边都渲染成功、都不报错。
 *
 * 所以 `composition` 恒为四项，**得 0 分的维度也在**：`highlightCount === 0` 的条目
 * 量化率是 0，那一行照样出现，写着 0 —— 「这一项拿了 0 分」和「这一项没被检查」
 * 是两件完全不同的事，而它们只在有这一行时才分得开。
 *
 * ## ③ `Σ contribution === total`，精确成立
 *
 * 每一个 contribution 都是 `raw × weight × 100`，但**不直接四舍五入**，而是用
 * **最大余数法**（apportionment）分配到一个固定的十等分总额上，总额正好是 `total`。
 *
 * 直接四舍五入的后果很具体：四个各差 0.05 的数相加，屏幕上会出现
 * 「8.3 + 4.5 + 2.2 + 2.3 = 17.3，而总分写着 17.4」。用户的结论不会是
 * 「这是舍入误差」，而是**「这个分数是编的」** —— 而 T2.2 承诺的恰恰是
 * 「用户能把报告上的数加起来，验证它确实等于自己离满分差了多少」。
 * 一条会被舍入误差打破的承诺，等于没有这条承诺。
 *
 * 代价是每个 contribution 可能被挪动最多一个最小刻度（0.1 分）。这个代价被一条断言钉住：
 * **移动量必须小于 0.1**，所以最大余数法只能是「让显示自洽」的手段，
 * 不可能悄悄变成「替用户调分」的手段 —— 想凑掉 3 分就必然越界。
 * 另外，得 0 分的维度**恒显示 0**，不参与凑数。
 *
 * @see DESIGN 8.5 / 8.6 · ADR-4 · TASKS.md T2.2 / T2.3
 */

import type { MatchReport, ScoredItem } from './index'
import { labelOf, type RejectionExplanation } from './reasons'
import type { MatchWeights } from './score'
import type { MatchKind, Reason } from './types'

/**
 * 四项维度的**固定顺序**。顺序进入断言 —— 「恒为四项」若不管顺序，
 * 一次 `Object.entries` 就能让它随插入顺序漂移，而界面上的行序会跟着变。
 */
export type ReportDimension = keyof MatchWeights

export const REPORT_DIMENSIONS: readonly ReportDimension[] = Object.freeze([
  'keyword',
  'recency',
  'quantification',
  'depth',
] as const)

/** 维度的人话名字。`Record<ReportDimension, string>` 的完整性由类型强制 —— 漏一个就编译不过。 */
export const DIMENSION_LABEL: Readonly<Record<ReportDimension, string>> = Object.freeze({
  keyword: 'JD 技能命中',
  recency: '时效',
  quantification: '量化率',
  depth: '描述充实度',
})

/** 这个维度在量什么。展开后第一句要回答的就是它，否则「量化率 0.67」不构成解释。 */
export const DIMENSION_HINT: Readonly<Record<ReportDimension, string>> = Object.freeze({
  keyword: 'JD 里列出的技能，有多少出现在这条经历的文本里',
  recency: '结束时间距参照时间有多久',
  quantification: '要点里带数字的比例',
  depth: '要点条数与文本长度',
})

export interface CompositionRow {
  readonly dimension: ReportDimension
  readonly label: string
  readonly hint: string
  /** 该维度的原始得分，[0, 1]。界面上的进度条用这个值，不用 contribution。 */
  readonly raw: number
  /** 权重，来自 `MatchReport.weights`。 */
  readonly weight: number
  /** 满分时该维度值多少分 = `weight × 100`。四项相加恒为 100。 */
  readonly maxContribution: number
  /**
   * 该维度实际贡献了多少分。**四项相加精确等于该行的 `total`**（见文件头 ③）。
   * 已分配到 0.1 的整数倍，所以界面直接显示它就行，不要自己再舍一次。
   */
  readonly contribution: number
}

interface ReportRowBase {
  readonly entryId: string
  readonly label: string
  readonly kind: MatchKind
  /** 1 起，按分数降序连续编号，**跨选中 / 淘汰不断** —— 名次不该因为一条线而跳号。 */
  readonly rank: number
  readonly total: number
  /** 恒为四项，顺序同 `REPORT_DIMENSIONS`。选中项与淘汰项**一模一样地有**。 */
  readonly composition: readonly CompositionRow[]
  /** 逐条理由，按影响幅度降序。可能是空数组（四项都没失分时），但**恒存在**。 */
  readonly reasons: readonly Reason[]
}

export interface SelectedReportRow extends ReportRowBase {
  readonly status: 'selected'
  readonly rejection: null
}

export interface RejectedReportRow extends ReportRowBase {
  readonly status: 'rejected'
  /** 判别联合：这一行是淘汰项，`rejection` 就**必然**有值。 */
  readonly rejection: RejectionExplanation
}

export type MatchReportRow = SelectedReportRow | RejectedReportRow

export interface MatchReportView {
  readonly rows: readonly MatchReportRow[]
  readonly selectedCount: number
  readonly rejectedCount: number
  readonly cutoff: number
  /** 报告里实际用了哪些维度，供界面渲染表头。恒等于 `REPORT_DIMENSIONS`。 */
  readonly dimensions: readonly ReportDimension[]
}

/** 浮点误差容忍。`0.1` 的整数倍在二进制里不精确，比较前先把误差抹掉。 */
const EPSILON = 1e-9

function tenths(value: number): number {
  return Math.round(value * 10 + (value < 0 ? -EPSILON : EPSILON))
}

/**
 * 最大余数法：把一组非负实数分配成整数个 0.1，且**和恰好等于 `target`**。
 *
 * 四条性质，都由断言守着：
 * 1. 和精确等于 `target`（这是它存在的唯一理由）
 * 2. 每项的移动量 < 0.1（一个最小刻度），所以它只是显示层的自洽手段，
 *    不能替用户调分 —— 有人想「凑数」就得移动 ≥ 0.1，那条断言会红
 * 3. **恰好为 0 的项恒为 0**：得 0 分的维度不许因为凑数显示成 0.1。
 *    「量化率 0 分」与「量化率 0.1 分」是两个不同的意思，后一个是编的
 * 4. 确定性：余数相同时按下标升序，同输入同输出
 *
 * 移动量上界是 0.1 而不是 0.05：这个算法等价于「每个数各自四舍五入，
 * 但进位方向由全局和是否平掉来决定」，所以单项的偏差可以接近一个整刻度。
 * 写成 0.05 会是错的，而错的界会让断言在不该红的时候红。
 */
export function apportionToTenths(values: readonly number[], target: number): readonly number[] {
  const targetTenths = tenths(target)
  const exact = values.map((value) => value * 10)
  const base = exact.map((value) => Math.floor(value + EPSILON))
  let remaining = targetTenths - base.reduce((sum, value) => sum + value, 0)

  // 余数大的先补，余数相同则下标小的先补 —— 不这样定序，整数分配会随排序实现漂移。
  // **恒为 0 的项不参与分配**（性质 3），所以它要先被排除在候选之外。
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value + EPSILON) }))
    .filter(({ index }) => (exact[index] ?? 0) > 0)
    .sort((left, right) =>
      right.fraction - left.fraction !== 0
        ? right.fraction - left.fraction
        : left.index - right.index,
    )

  const result = [...base]
  for (const { index } of order) {
    if (remaining <= 0) break
    result[index] = (result[index] ?? 0) + 1
    remaining -= 1
  }

  // 反向差额只可能来自浮点噪声（`target` 本身就是这组数的和四舍五入来的）。
  // 从余数最小的开始减，且不允许减成负数 —— 负数会让界面显示出「负的贡献」。
  for (const { index } of [...order].reverse()) {
    if (remaining >= 0) break
    const current = result[index] ?? 0
    if (current > 0) {
      result[index] = current - 1
      remaining += 1
    }
  }

  return result.map((value) => value / 10)
}

function compositionOf(entry: ScoredItem, weights: MatchWeights): readonly CompositionRow[] {
  const scores = REPORT_DIMENSIONS.map((dimension) => entry.breakdown[dimension])
  const contributions = REPORT_DIMENSIONS.map(
    (dimension, index) => (scores[index] ?? 0) * weights[dimension] * 100,
  )
  const apportioned = apportionToTenths(contributions, entry.breakdown.total)

  return REPORT_DIMENSIONS.map((dimension, index) => ({
    dimension,
    label: DIMENSION_LABEL[dimension],
    hint: DIMENSION_HINT[dimension],
    raw: scores[index] ?? 0,
    weight: weights[dimension],
    maxContribution: weights[dimension] * 100,
    contribution: apportioned[index] ?? 0,
  }))
}

/**
 * 把 `MatchReport` 摊平成界面直接可渲染的行。
 *
 * 这是个**全函数**：没有 `undefined` 分支、没有按 id 的查找、没有 `?? 默认值`。
 * 这不是风格问题 —— 「查不到就显示个空」正是信息静默消失的写法，
 * 而它在类型上已经不可能发生（`ScoredItem.rejection` 是必填字段，
 * `RejectedReportRow.rejection` 非空）。
 */
export function buildReportView(report: MatchReport): MatchReportView {
  const rows: MatchReportRow[] = report.scored.map((entry, index) => {
    const base = {
      entryId: entry.item.entryId,
      label: labelOf(entry.item),
      kind: entry.item.kind,
      rank: index + 1,
      total: entry.breakdown.total,
      composition: compositionOf(entry, report.weights),
      reasons: entry.reasons,
    }

    if (!entry.selected) {
      if (entry.rejection === null) {
        // 正常路径到不了这里：`matchItems` 对每条淘汰项都会算出解释。
        // 留着这句不是为了「防御性编程」，是为了**手搓报告时不要静默** ——
        // 少了它，一份矛盾的报告会渲染成一行没有解释的淘汰项，而那是可读的、不报错的。
        // 有一条断言专门构造这个矛盾并期待它抛错。
        throw new Error(`match 报告内部不一致：淘汰项 ${entry.item.entryId} 没有解释`)
      }
      return { ...base, status: 'rejected', rejection: entry.rejection }
    }

    return { ...base, status: 'selected', rejection: null }
  })

  return {
    rows,
    selectedCount: rows.filter((row) => row.status === 'selected').length,
    rejectedCount: rows.filter((row) => row.status === 'rejected').length,
    cutoff: report.cutoff,
    dimensions: REPORT_DIMENSIONS,
  }
}
