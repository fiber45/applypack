/**
 * 跨语言数字一致性 —— DESIGN 10.2「跨语言一致性校验（可机械验证）」的原语。
 *
 * ## 这条校验在防什么
 *
 * 英文简历不是中文简历的翻译，而是按目标语规范**重写**（DESIGN 10.1）。
 * 于是中文版写「耗时从 4.2 小时降至 38 分钟」，英文版可能写成
 * "cut turnaround from 4.2 hours to 38 minutes"，也可能写成
 * "reduced turnaround by 91%" —— 后者是一个**原文里从未出现过的数字**。
 *
 * 翻译不一致最难被发现的地方正是这里：两份都是「对的」，措辞也各自地道，
 * 只有把数字集合拉平来看才看得出它们讲的是两件事。而这件事**可以机械验证**。
 *
 * ## 为什么是「全集合相等」而不是按类别（时间/金额/百分比…）比
 *
 * TASKS.md T4b 的原话是按类别两两相等。**全集合相等是它的充分条件**：
 * 集合相同 ⇒ 任意类别划分下都相同。所以这里的判据更强，也更容易解释 ——
 * 不需要先定义「哪些数字是时间、哪些是金额」，而那个分类本身就是一个
 * 会漏、会漂移的启发式。
 *
 * 代价要说清楚：全集合相等会**误伤**「91%」这种正确的换算。
 * 这是有意接受的 —— 换算是改写，而跨语言改写要一致的是事实，不是算式。
 * 想让某个换算通过，正确做法是在两份里都用原始数字，
 * 而不是放宽闸门让它放过任意的数字差异。
 *
 * @see DESIGN 10.2 · TASKS.md T3.4（评测集的「跨语言不一致」类）· T4b
 */

import { compareNumeric, extractNumbers } from './numbers'

export interface ParityReport {
  readonly ok: boolean
  /** 只出现在左侧的数字（左侧 = 基准，通常是中文版） */
  readonly onlyInLeft: readonly string[]
  /** 只出现在右侧的数字 */
  readonly onlyInRight: readonly string[]
}

function difference(a: ReadonlySet<string>, b: ReadonlySet<string>): readonly string[] {
  return [...a].filter((value) => !b.has(value)).sort(compareNumeric)
}

/** 两个文本集合里出现过的数字集合是否相同。 */
export function textsParity(
  left: readonly string[],
  right: readonly string[],
): ParityReport {
  const leftSet = new Set(left.flatMap((text) => [...extractNumbers(text)]))
  const rightSet = new Set(right.flatMap((text) => [...extractNumbers(text)]))
  const onlyInLeft = difference(leftSet, rightSet)
  const onlyInRight = difference(rightSet, leftSet)
  return { ok: onlyInLeft.length === 0 && onlyInRight.length === 0, onlyInLeft, onlyInRight }
}

/**
 * 多份视图两两一致（中 / 英 / 双语三版，以及自述三视图）。
 *
 * 返回**第一处**不一致及其涉及的两份视图 —— 报「全部两两组合」会在三版时
 * 给出三条本质上是同一个问题的失败，用户读起来像是三个不同的毛病。
 */
export interface MultiViewParityReport extends ParityReport {
  /** 参与的视图名，仅在 `ok: false` 时有意义 */
  readonly pair: readonly [string, string] | null
}

export function multiViewParity(
  views: readonly { readonly name: string; readonly texts: readonly string[] }[],
): MultiViewParityReport {
  for (let i = 0; i < views.length; i += 1) {
    for (let j = i + 1; j < views.length; j += 1) {
      const left = views[i]
      const right = views[j]
      /* c8 ignore next -- 索引由循环边界保证存在 */
      if (left === undefined || right === undefined) continue
      const report = textsParity(left.texts, right.texts)
      if (!report.ok) return { ...report, pair: [left.name, right.name] }
    }
  }
  return { ok: true, onlyInLeft: [], onlyInRight: [], pair: null }
}

export interface NumberLocation {
  readonly number: string
  /** 含这个数字的文本，按输入顺序、逐字保留（不截断） */
  readonly texts: readonly string[]
}

/**
 * 「这些数字出现在哪里」—— 把一条数字级的判据翻译成一行行可以动手改的文本。
 *
 * ## 为什么需要它
 *
 * `textsParity` 的失败信息是 `onlyInRight: ['6']`。看到它的人能做的事情只有
 * 一件：把两份文档从头读到尾，找哪个地方多写了个 6。**这等于没有报错。**
 * 这条不匹配的真实成因往往是极小的：中版写「全国大学英语六级考试」、
 * 英版写「CET-6」，同一个事实，一个带数字一个不带。
 *
 * 所以失败信息必须落到**行**上。这不是文案打磨，是「报错理由写错，
 * 用户会被引向错误的处置方向」这条原则的又一次应用（见 T3.3 的三条绳子）。
 *
 * 只报命中该数字的文本，不做任何归因 —— 归因（是术语不一致还是真编了数字）
 * 需要语义，而这一层拒绝理解语义。
 */
export function locateNumbers(
  texts: readonly string[],
  numbers: readonly string[],
): readonly NumberLocation[] {
  return numbers.map((number) => ({
    number,
    texts: texts.filter((text) => extractNumbers(text).includes(number)),
  }))
}

