/**
 * 自我介绍的交付前检查 —— T4d 第二条勾（「数字集合纳入统一校验」）的执行者。
 *
 * ## 「纳入统一校验」的具体含义
 *
 * 不是「也查一遍数字」，而是**用与 T4b 同一套东西查**：
 *
 * | 复用 | 从哪来 | 为什么不能各写一份 |
 * |---|---|---|
 * | `extractNumbers` | `verify/numbers` | 一个按「6」另一个按「6.0」切，两边都自洽，合起来不一致 |
 * | `compareNumeric` | `verify/numbers` | 排序用 `.sort()` 是字典序（`38 < 4.2`），集合比较会因此把顺序也当成不一致 |
 * | `locateNumbers` | `verify/parity` | 「数字 6 不一致」等于没有报错，失败必须落到句子上 |
 * | `textsParity` 的**口径** | `verify/parity` | 全集合相等，不做分类 —— 分类表会漂移（T4b 已认领这笔账） |
 *
 * ## 五条判据与各自的性质
 *
 * | 判据 | 严重性 | 性质 |
 * |---|---|---|
 * | 中英两档数字集合相等 | `fatal` | **回归绊线**：带数字的事实同进同出（`compose.ts`），所以它响时说的是「模板漂移了」 |
 * | 自述里的数字必须在该语言的简历里出现过 | `fatal` | 结构上成立（数字是从简历要点上抄的），响时说明润色阶段编了数字 |
 * | 字数超出档位上限 | `fatal` | **合成器自己的契约**：它「装不下就跳过」，越界只可能是它破了停止条件 |
 * | 字数不足档位下限 | `hard` | **档案内容的函数**，报的是手上这份产物够不够这一档 |
 * | 英文口播版句均 ≤ 25 词 | `target` | DESIGN 11.5 明确标为**优化目标**，不阻断交付 |
 *
 * ### 上限与下限为什么可以有不同严重性
 *
 * 不是妥协，是把责任分清楚：
 *
 * - **上限属于合成器。** 它逐条累加、装不下就跳过，所以「超了」只有一种成因 ——
 *   它自己的停止条件坏了（或某个必收项不收上限）。这是回归，`fatal`。
 * - **下限属于档案。** 手上有的是草稿，草稿只有 72 词，那它就是一份 72 词的
 *   自我介绍。把这种情况报成 `target`（「不阻断交付」）是反过来的谎：
 *   用户会以为拿到的是合格产物。所以它是 `hard`。
 *
 * ### 只报「太短」是不够的
 *
 * 短可动的地方有两件：往档案里补事实，或者把英文侧写出来（T3.1 的改写）。
 * 代价差一个量级，而**只报「太短」会让用户去做更贵的那件** ——
 * 更糟的是，补进去的事实仍然是中文，档位一点都不会变长。
 * 所以 `shortHints` 按代价从小到大给处置，`IntroView.zhFallbackFactIds`
 * 就是「英文侧还没写出来」这个判断的载体。
 *
 * ## 一条被自己抓到的错误：比较的是数字，不是文本行
 *
 * 第一版把「简历数字集合」直接写成了 `PackageView.texts`（一行行正文），
 * 然后拿自述里的数字去 `Set.has` 那些**整行文本** —— 于是每个数字都判成
 * 「简历上没有」，三档全红。修法不是改逻辑，是**改名字**：入参叫
 * `ResumeTexts`（它是文本行），要比较的那一侧显式跑一次 `extractNumbers`。
 * **名字说了谎，逻辑就会照着谎走。**
 *
 * @see DESIGN 10.2 / 11.5 · TASKS.md T4b / T4d
 */

import type { FailureSeverity } from '../verify/gate'
import { compareNumeric, extractNumbers } from '../verify/numbers'
import { locateNumbers } from '../verify/parity'
import type { IntroPair, IntroView } from './compose'
import {
  MAX_SPOKEN_SENTENCE_WORDS,
  averageSentenceLength,
  type IntroTargetName,
} from './targets'

export type IntroFindingReason =
  /** 中英两档的数字集合不等。DESIGN 10.2：一票否决。 */
  | 'intro_cross_language_mismatch'
  /** 自述里出现了该语言简历上没有的数字 —— 润色阶段编出来的。 */
  | 'intro_unsupported_number'
  /** 字数不足档位下限：档案（或某一语言的文案）撑不起这一档。 */
  | 'intro_too_short'
  /** 字数超出档位上限：**只可能是合成器破了自己的停止条件**。 */
  | 'intro_too_long'
  /** 英文口播版句子太长（DESIGN 11.5 的优化目标，不阻断）。 */
  | 'intro_sentence_too_long'

export interface IntroFinding {
  readonly reason: IntroFindingReason
  readonly severity: FailureSeverity
  readonly offending: string
  readonly detail: string
}

export interface IntroCheck {
  /** **只看 `fatal` 与 `hard`** —— `target` 层不参与，见文件头。 */
  readonly pass: boolean
  readonly findings: readonly IntroFinding[]
  /**
   * 没有另一种语言的对应档，因此**没有被两两比对过**的档位。
   *
   * TASKS.md T4d 点名的三档里，`intro_en@200w` 就在这一列 ——
   * 它在中文侧没有对应档，所以它只被「不许编数字」那条守着。
   * 这是**必须说出来的**：不说的话，用户会以为三档都过了跨语言校验。
   */
  readonly unpaired: readonly IntroTargetName[]
}

/**
 * 已渲染简历的**文本行**（`PackageView.texts`），按语言分。
 *
 * 名字是有意的：它是**文本行**，不是数字。这里踩过一次坑 —— 第一版叫
 * `ResumeNumbers` 却装着一行行正文，读代码的人（和写代码的人）都会
 * 顺着名字把整行当数字用。见文件头最后一节。
 */
export interface ResumeTexts {
  readonly zh: readonly string[]
  readonly en: readonly string[]
}

export interface IntroCheckInput {
  readonly views: readonly IntroView[]
  readonly pairs: readonly IntroPair[]
  readonly resumeTexts: ResumeTexts
}

function difference(left: readonly string[], right: ReadonlySet<string>): readonly string[] {
  return left.filter((item) => !right.has(item))
}

function numbersIn(text: string): readonly string[] {
  return [...extractNumbers(text)].sort(compareNumeric)
}

/** 文本行 → 数字集合。**这一步是必须的**，别把文本行本身当数字用。 */
function numberSetOf(texts: readonly string[]): ReadonlySet<string> {
  return new Set(texts.flatMap((text) => [...extractNumbers(text)]))
}

function describe(view: IntroView, numbers: readonly string[]): string {
  return locateNumbers(view.sentences, numbers)
    .map((location) => {
      const sentence = location.texts[0]
      return sentence === undefined ? location.number : `${location.number}（「${sentence}」）`
    })
    .join('、')
}

/** 档位键相同的那一档、另一种语言。没有就是 `null`（未配对）。 */
function siblingOf(pairs: readonly IntroPair[], view: IntroView): IntroView | null {
  const name = view.target.name
  for (const pair of pairs) {
    if (pair.zh?.target.name === name) return pair.en
    if (pair.en?.target.name === name) return pair.zh
  }
  return null
}

function langLabel(lang: 'zh' | 'en'): string {
  return lang === 'zh' ? '中文' : '英文'
}

/**
 * 某一档为什么短 —— 按**代价从小到大**给出可动的几件事。
 *
 * 只报「太短」是不够的：可动的有两件（补事实 / 把英文侧写出来），
 * 而它们的代价差一个量级。报错不指出最便宜的那条路，用户就会去走最贵的那条，
 * 而且走完还是短（他补进去的仍然是中文）。
 */
function shortHints(view: IntroView, sibling: IntroView | null): string {
  const hints: string[] = []

  if (view.zhFallbackFactIds.length > 0) {
    const fallback = view.zhFallbackFactIds
    const shown = fallback.slice(0, 3).join('、')
    const more = fallback.length > 3 ? ' 等' : ''
    hints.push(
      `其中 ${fallback.length} 条事实（${shown}${more}）的${langLabel(view.target.lang)}侧` +
        '直接用了中文原文，所以它们贡献的英文词数是零。' +
        `**先跑${langLabel(view.target.lang)}改写** —— ` +
        '它比往档案里补事实便宜，而且补中文事实并不会让这一档变长。',
    )
  }

  if (view.skipped.length > 0) {
    hints.push(
      `另有 ${view.skipped.length} 条事实装不下（已收 ${view.factIds.length} 条）：` +
        '档案里的事实够多，但单条太长 —— 把那条经历拆成两条要点，就能塞进更多内容。',
    )
  }

  if (hints.length === 0 && sibling !== null) {
    const siblingUnits = `${sibling.units} ${sibling.target.lang === 'zh' ? '字' : '词'}`
    const coverage = view.units / view.target.units
    const siblingCoverage = sibling.units / sibling.target.units
    // 判据是**覆盖率之差**，不是「同档是否落在档内」。
    // 「同档达标了吗」这个问法在两边都不足时会给出同一种答案，
    // 于是「中文 87%、英文 53%」和「中文 60%、英文 53%」会被归成一类 ——
    // 而前者的成因是换算、后者才是档案。
    hints.push(
      siblingCoverage - coverage > 0.2
        ? `同档的${langLabel(sibling.target.lang)}档填到了 ${(siblingCoverage * 100).toFixed(0)}%` +
          `（${siblingUnits}），而这一档只填到 ${(coverage * 100).toFixed(0)}%。` +
          '两者差得太多，所以**这一条多半不是补档案能解决的** —— ' +
          '先看 `targets.ts` 的「已知问题」：中英语速常数把它们拼成「同一档」' +
          '这件事还没有被验证过。在拍板之前它是一条真红，但不该由你去补内容。'
        : `同档的${langLabel(sibling.target.lang)}档也只填到 ${(siblingCoverage * 100).toFixed(0)}%` +
          `（${siblingUnits}），所以这不是语言之间的差异 —— ` +
          '档案里可朗读的内容不足以填满这一档。' +
          '往档案里补一到两条带结果的经历要点，或改用更短的档位。',
    )
  }

  if (hints.length === 0) {
    hints.push(
      '没有可再收的事实（全部已收）：档案里能念的东西不够这一档。' +
        '往档案里补一到两条带结果的经历要点，或改用更短的档位。',
    )
  }

  return hints.join('')
}

function checkBand(view: IntroView, sibling: IntroView | null): readonly IntroFinding[] {
  const { target, units } = view
  const findings: IntroFinding[] = []
  const unit = target.lang === 'zh' ? '字' : '词'

  if (units > target.maxUnits) {
    findings.push({
      reason: 'intro_too_long',
      severity: 'fatal',
      offending: `${units} / 上限 ${target.maxUnits}`,
      detail:
        `${target.name} 有 ${units} ${unit}，超出档位上限 ${target.maxUnits}。` +
        '合成器是「装不下就跳过」的，所以超出只可能是它破了自己的停止条件' +
        '（例如某个不收上限的必收项）—— 这是回归，不是用户输入问题。',
    })
  }

  if (units < target.minUnits) {
    findings.push({
      reason: 'intro_too_short',
      severity: 'hard',
      offending: `${units} / 下限 ${target.minUnits}`,
      detail:
        `${target.name} 只有 ${units} ${unit}，低于档位下限 ${target.minUnits}` +
        `（目标 ${target.units} ${unit}，±10%）。` +
        `已收 ${view.factIds.length} 条事实、跳过 ${view.skipped.length} 条。` +
        shortHints(view, sibling),
    })
  }

  return findings
}

function checkReadability(view: IntroView): readonly IntroFinding[] {
  if (view.target.mode !== 'spoken' || view.target.lang !== 'en') return []

  const average = averageSentenceLength(view.text, 'en')
  if (average <= MAX_SPOKEN_SENTENCE_WORDS) return []

  const longest = [...view.sentences].sort(
    (left, right) => right.split(' ').length - left.split(' ').length,
  )[0]

  return [
    {
      reason: 'intro_sentence_too_long',
      severity: 'target',
      offending: `句均 ${average.toFixed(1)} 词 / 上限 ${MAX_SPOKEN_SENTENCE_WORDS}`,
      detail:
        `英文口播版句均 ${average.toFixed(1)} 词，超过 ${MAX_SPOKEN_SENTENCE_WORDS} 词。` +
        `最长的一句是「${longest ?? ''}」。` +
        '这条不阻断交付（DESIGN 11.5 把它列为优化目标）：口播时从句套从句听不进去，' +
        '但它是「读起来更顺」的问题，不是「内容错了」的问题。',
    },
  ]
}

function checkUnsupported(
  view: IntroView,
  resumeNumbers: ReadonlySet<string>,
): readonly IntroFinding[] {
  const extra = difference(numbersIn(view.text), resumeNumbers)
  if (extra.length === 0) return []

  return [
    {
      reason: 'intro_unsupported_number',
      severity: 'fatal',
      offending: extra.join('、'),
      detail:
        `${view.target.name} 里出现了简历上没有的数字：${describe(view, extra)}。` +
        '自述的数字必须从简历要点上抄下来 —— 同一份档案的另一个视图，' +
        '不该出现简历里没有的事实。这是润色阶段编数字的典型症状：' +
        '宁可把这一句删掉，也不要改数字。',
    },
  ]
}

function checkPair(pair: IntroPair): readonly IntroFinding[] {
  const zh = pair.zh
  const en = pair.en
  // 一侧缺失时无从比对 —— 那属于 `unpaired`，不是这里的事。
  if (zh === null || en === null) return []

  const zhNumbers = numbersIn(zh.text)
  const enNumbers = numbersIn(en.text)
  const onlyInZh = difference(zhNumbers, new Set(enNumbers))
  const onlyInEn = difference(enNumbers, new Set(zhNumbers))
  if (onlyInZh.length === 0 && onlyInEn.length === 0) return []

  const parts: string[] = []
  if (onlyInZh.length > 0) parts.push(`只在中文档：${describe(zh, onlyInZh)}`)
  if (onlyInEn.length > 0) parts.push(`只在英文档：${describe(en, onlyInEn)}`)

  return [
    {
      reason: 'intro_cross_language_mismatch',
      severity: 'fatal',
      offending: [...onlyInZh, ...onlyInEn].join('、'),
      detail:
        `同一档位（${pair.key}）的中英两版数字集合必须完全相等（DESIGN 10.2）。` +
        `${parts.join('；')}。带数字的事实是同进同出的，所以出现这个差异意味着` +
        '**两种语言的模板漂移了**（例如英文模板的日期被改掉），而不是用户档案有问题。',
    },
  ]
}

export function checkIntros(input: IntroCheckInput): IntroCheck {
  const findings: IntroFinding[] = []
  const resumeNumbers = {
    zh: numberSetOf(input.resumeTexts.zh),
    en: numberSetOf(input.resumeTexts.en),
  }

  for (const pair of input.pairs) findings.push(...checkPair(pair))

  for (const view of input.views) {
    findings.push(...checkBand(view, siblingOf(input.pairs, view)))
    findings.push(...checkReadability(view))
    findings.push(...checkUnsupported(view, resumeNumbers[view.target.lang]))
  }

  const unpaired: IntroTargetName[] = []
  for (const pair of input.pairs) {
    if (pair.zh !== null && pair.en !== null) continue
    if (pair.zh !== null) unpaired.push(pair.zh.target.name)
    if (pair.en !== null) unpaired.push(pair.en.target.name)
  }

  return {
    pass: !findings.some(
      (finding) => finding.severity === 'fatal' || finding.severity === 'hard',
    ),
    findings,
    unpaired,
  }
}
