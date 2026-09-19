/**
 * 投递包 —— 同一份 A 级档案**一次产出三版**（DESIGN 10.1 的 target 抽象）。
 *
 * ```
 * Resume_CN          resume_zh              中文视图
 * Resume_EN          resume_en_campus      英文视图（按目标语规范重写，不是翻译）
 * Resume_Bilingual   顺序拼页 EN → CN，非并排
 * ```
 *
 * ## 本文件里唯一重要的两个判断
 *
 * ### ① 双语版进不了「两两数字相等」这组比较
 *
 * TASKS.md T4b 的原话是三版两两相等。**把双语版放进去是一个看起来更严、
 * 实际更弱的做法**，两头都错：
 *
 * - **它更弱：** 双语版的数字集合是两半的并集。若「双语版只剩了 EN 一半」，
 *   它的集合恰好等于英版 —— 两两比较全绿。**它看起来在覆盖「拼页有没有拼全」，
 *   实际一条都没覆盖。**
 * - **它更冗余：** 英版与中版本来就要求相等（否则整包已经失败），
 *   于是双语版与它们的比较是同一个结论的第三次复述。
 *
 * 所以双语版由两条**它才是唯一执行者**的检查守着：
 * 「中英两半的每一行都在双语版里」（`bilingual_incomplete`）与
 * 「英版是前半段」（`bilingual_en_not_first`）。分工写在这里，
 * 因为「哪条检查守哪件事」正是最容易在后续改动里被挪错的东西。
 *
 * ### ② 「数字相等」有两种：独立核对出来的，和构造上必然的
 *
 * 中英两版的文本并不都独立：
 *
 * | 文本 | 两侧的关系 | 数字相等是 |
 * |---|---|---|
 * | 要点（`highlights`） | **没跑英文改写时逐字相同**；跑过则各自独立 | 前者构造性，后者真的核对了 |
 * | 联系方式行 | 同一个档案字段的两次渲染，只有标签与分隔符不同 | 弱独立（只能抓到渲染器 bug） |
 * | 日期 / GPA / 语言分数 / 技能关键词 | 两侧逐字相同 | 构造性 |
 *
 * 所以本层的报告必须把这两样分开，而不是合成一个「通过」：
 *
 * - `independentCn` / `independentEn` —— 只在某一侧独有的文本里出现的数字。
 *   **这才是这次比较真正覆盖的范围**：数字全落在共享文本上时，比较是两个
 *   恒等集合在比，无论怎么写都相等。
 * - `bulletsFromSharedSource` —— 中英两版的**要点**是否逐字相同。
 *   `true` 表示英文那一版还没做过独立改写，于是「要点里的数字一致」
 *   不是核对出来的，而是同一份文本被渲染了两次。
 *
 * **不把 `bulletsFromSharedSource: true` 报成失败**：档案本身没问题，
 * 缺的是「还没做英文改写」这个动作，用户该看到的是一句提示，
 * 不是一条红。但它也**不能**被说成「跨语言一致性已通过」——
 * 这两种说法在界面上必须长得不一样，否则用户会以为自己得到了一层
 * 在他跑英文改写之前并不存在的保护。
 *
 * 顺带一个真实的收益：联系方式行的两次渲染虽然弱，但它们**确实**独立 ——
 * 英版里把手机号打错一位会被这条校验抓到，而那是最难靠肉眼发现的一类错。
 *
 * ## 两个事实源为什么是分开的
 *
 * `rewritten.zh` 与 `rewritten.en` 是两次独立的改写调用（T3.1），
 * 提示词与目标语不同，产出之间没有可推导的关系。这不是接口设计上的
 * 「灵活」，是把真实情况如实表达出来 —— 一旦合并成一个 map，
 * `②` 里那张表的第一行就永远落在「构造性」那一侧。
 *
 * @see DESIGN 10.1 / 10.2 · TASKS.md T4b · T4c（文件名）· T4d（自述三视图）
 */

import type { ArchiveV1 } from '../schema/index'
import type { FailureSeverity } from '../verify/gate'
import { compareNumeric, extractNumbers } from '../verify/numbers'
import { locateNumbers, textsParity } from '../verify/parity'
import { extractLines } from './ats'
import { renderBilingualHtml, renderHtml } from './html'
import { CAMPUS_LAYOUT, type BlockKind, type LayoutSpec } from './layout'
import {
  buildDocumentModel,
  type BuildDocumentOptions,
  type DocumentModel,
  type RenderLang,
  type RenderTarget,
} from './model'
import { BLOCK_LABELS, estimatePages, layoutBlocks, type PageEstimate } from './paginate'

export type PackageViewName = 'Resume_CN' | 'Resume_EN' | 'Resume_Bilingual'

/** 单语版长度 1；双语版长度 2，**EN 在前**（DESIGN 10.1「顺序拼页，非并排」）。 */
export type ViewModels = readonly [DocumentModel] | readonly [DocumentModel, DocumentModel]

export interface PackageView {
  readonly name: PackageViewName
  readonly models: ViewModels
  readonly html: string
  /**
   * 页面上真实出现的文本行（`extractLines` 的结果）。
   *
   * 一致性校验的输入是它，**不是模型**。差别在于：模型是「我们打算渲染什么」，
   * 文本行是「渲染出来实际是什么」。转义、语言回退、节顺序这些环节都发生在
   * 两者之间，而跨语言不一致恰恰最可能由它们造成 —— 拿模型去校验，
   * 等于在一半的路上设检查站。
   */
  readonly texts: readonly string[]
  readonly pages: PageEstimate
}

export interface DeliveryPackageViews {
  readonly cn: PackageView
  readonly en: PackageView
  readonly bilingual: PackageView
}

export interface DeliveryPackageOptions {
  /** 只渲染这些条目（来自匹配结果，T2.2）。省略即全部渲染。 */
  readonly includedEntryIds?: readonly string[]
  /** 逐语种的改写产物（T3.1 的两次独立调用）。省略即用档案原文。 */
  readonly rewritten?: Partial<Record<RenderLang, ReadonlyMap<string, readonly string[]>>>
  readonly layout?: LayoutSpec
}

export type PackageFailureReason =
  /** 中英两版数字集合不等。DESIGN 10.2：一票否决。 */
  | 'cross_language_mismatch'
  /** 双语版缺了某一半的行。 */
  | 'bilingual_incomplete'
  /** 双语版的前半段不是英版。 */
  | 'bilingual_en_not_first'
  /** 英版超过一页。 */
  | 'en_over_one_page'

export interface PackageFailure {
  readonly reason: PackageFailureReason
  /**
   * 复用闸门的严重性词表（`core/verify/gate.ts`）。
   *
   * **本层没有 `target` 层。** 闸门里 `target` 的含义是「写得好不好」，
   * 而投递包的四项没有一项是好坏问题：数字不一致是撒谎，
   * 双语缺一半、顺序倒了、超页，都是「这份东西不能投出去」。
   * 所以全部阻断，`severity` 在这里只区分「事实问题」与「形态问题」。
   */
  readonly severity: FailureSeverity
  readonly offending: string
  readonly detail: string
}

export interface CrossLanguageParity {
  readonly status: 'consistent' | 'inconsistent'
  /** 只出现在中版的数字（全集合口径，DESIGN 10.2） */
  readonly onlyInCn: readonly string[]
  readonly onlyInEn: readonly string[]
  /** 两侧逐字相同的文本条数 */
  readonly sharedTexts: number
  /**
   * **校验的实际作用范围**：只出现在一侧的文本里、且共享文本没有覆盖到的数字。
   * 数字全落在共享文本上时，这次比较是两个恒等集合在比 —— 报「一致」
   * 虽然没错，但它没有排除任何一种可能的错误。
   */
  readonly independentCn: readonly string[]
  readonly independentEn: readonly string[]
  /**
   * 中英两版的要点是否逐字相同。
   *
   * `true` ⇒ 英文那一版没做过独立改写 ⇒ 要点上的「数字一致」是同一份文本
   * 被渲染了两次，**不是核对出来的**。界面必须把这种情况与真正核对过的
   * 情况分开说，理由见文件头 ②。
   */
  readonly bulletsFromSharedSource: boolean
}

export interface PackageCheck {
  readonly pass: boolean
  readonly failures: readonly PackageFailure[]
  readonly parity: CrossLanguageParity
}

const CN_TARGET: RenderTarget = 'resume_zh'
const EN_TARGET: RenderTarget = 'resume_en_campus'

function countOf(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1)
  return counts
}

/**
 * 按**多重集**把左侧文本分成「两侧都有」与「只有左侧有」。
 *
 * 用多重集而不是集合，是因为页面上同一行出现两次是可能的
 * （两条内容相同的要点），而那种情况下「另一侧也有一行」只抵消一次。
 * 集合语义会把重复行当成一次匹配，于是双语版少拼一行也不会被发现。
 */
function splitTexts(
  left: readonly string[],
  right: readonly string[],
): { shared: readonly string[]; leftOnly: readonly string[] } {
  const pool = countOf(right)
  const shared: string[] = []
  const leftOnly: string[] = []
  for (const text of left) {
    const remaining = pool.get(text) ?? 0
    if (remaining > 0) {
      shared.push(text)
      pool.set(text, remaining - 1)
    } else {
      leftOnly.push(text)
    }
  }
  return { shared, leftOnly }
}

function setOfNumbers(texts: readonly string[]): ReadonlySet<string> {
  return new Set(texts.flatMap((text) => [...extractNumbers(text)]))
}

function sortedSet(values: ReadonlySet<string>): readonly string[] {
  return [...values].sort(compareNumeric)
}

/** 一份视图里全部要点文本（按阅读顺序）。用来判断两版是否同源。 */
function bulletTexts(view: PackageView): readonly string[] {
  return view.models.flatMap((model) =>
    model.sections.flatMap((section) => section.entries.flatMap((entry) => entry.bullets)),
  )
}

export function crossLanguageParity(cn: PackageView, en: PackageView): CrossLanguageParity {
  const report = textsParity(cn.texts, en.texts)
  const { shared, leftOnly: cnOnlyTexts } = splitTexts(cn.texts, en.texts)
  const { leftOnly: enOnlyTexts } = splitTexts(en.texts, cn.texts)

  // 「共享文本里已经出现过的数字」—— 这些数字两边都有，不构成校验。
  const sharedNumbers = setOfNumbers(shared)
  const independentCn = sortedSet(
    new Set([...setOfNumbers(cnOnlyTexts)].filter((number) => !sharedNumbers.has(number))),
  )
  const independentEn = sortedSet(
    new Set([...setOfNumbers(enOnlyTexts)].filter((number) => !sharedNumbers.has(number))),
  )

  // 要点是否两边都有（多重集口径）：有任一边独有的要点 ⇒ 两侧的编辑内容独立。
  const bulletsFromSharedSource =
    splitTexts(bulletTexts(cn), bulletTexts(en)).leftOnly.length === 0 &&
    splitTexts(bulletTexts(en), bulletTexts(cn)).leftOnly.length === 0

  return {
    status:
      report.onlyInLeft.length > 0 || report.onlyInRight.length > 0
        ? 'inconsistent'
        : 'consistent',
    onlyInCn: report.onlyInLeft,
    onlyInEn: report.onlyInRight,
    sharedTexts: shared.length,
    independentCn,
    independentEn,
    bulletsFromSharedSource,
  }
}

/** 「6（CET-6）」—— 把数字级的判据翻译成一行可以动手改的文本。 */
function describeNumbers(texts: readonly string[], numbers: readonly string[]): string {
  return locateNumbers(texts, numbers)
    .map((location) => {
      const line = location.texts[0]
      return line === undefined ? location.number : `${location.number}（「${line}」）`
    })
    .join('、')
}

function startsWith(haystack: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > haystack.length) return false
  return prefix.every((text, index) => haystack[index] === text)
}

/** 最占地方的几类块 —— 超页时唯一能指导「删哪里」的信息。 */
function heaviestBlocks(model: DocumentModel, layout: LayoutSpec): string {
  const totals = new Map<BlockKind, number>()
  for (const block of layoutBlocks(model, layout)) {
    totals.set(block.kind, (totals.get(block.kind) ?? 0) + block.heightPt)
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kind, height]) => `${BLOCK_LABELS[kind]} ${Math.round(height)}pt`)
    .join(' / ')
}

/**
 * 对三版做交付前的检查。**纯函数**：同样的三版永远得到同样的结论。
 *
 * 单独导出（而不是只作为 `buildDeliveryPackage` 的内部步骤），是为了让它
 * 能被**反向验证** —— T4b 的第三条勾要求「篡改英版任意一个数字 ⇒ 校验必须失败」。
 * 一条无法与「检查根本没在跑」区分的绿，不算绿（T1.4 的教训）。
 */
export function checkPackage(
  views: DeliveryPackageViews,
  layout: LayoutSpec = CAMPUS_LAYOUT,
): PackageCheck {
  const failures: PackageFailure[] = []
  const parity = crossLanguageParity(views.cn, views.en)

  if (parity.status === 'inconsistent') {
    const parts: string[] = []
    if (parity.onlyInCn.length > 0) {
      parts.push(`只在中版：${describeNumbers(views.cn.texts, parity.onlyInCn)}`)
    }
    if (parity.onlyInEn.length > 0) {
      parts.push(`只在英版：${describeNumbers(views.en.texts, parity.onlyInEn)}`)
    }
    failures.push({
      reason: 'cross_language_mismatch',
      severity: 'fatal',
      offending: [...parity.onlyInCn, ...parity.onlyInEn].join('、'),
      detail:
        `中英两版的数字集合必须完全相等（DESIGN 10.2）。${parts.join('；')}。` +
        '同一个事实的两种写法是最常见的成因（中版「六级」/ 英版「CET-6」）——' +
        '两份里都用同一个数字即可，不要放宽校验。',
    })
  }

  // 双语版：完整性 + 顺序。**这两条是「双语版只剩一半」唯一可能被抓到的地方**
  // （两两数字相等抓不到它，见文件头 ①）。
  const cnMissing = splitTexts(views.cn.texts, views.bilingual.texts).leftOnly
  const enMissing = splitTexts(views.en.texts, views.bilingual.texts).leftOnly
  const missing = [...new Set([...cnMissing, ...enMissing])]
  if (missing.length > 0) {
    failures.push({
      reason: 'bilingual_incomplete',
      severity: 'hard',
      offending: missing.slice(0, 3).join(' / '),
      detail:
        `双语版缺了 ${missing.length} 行，例如「${missing[0] ?? ''}」。` +
        '双语版是顺序拼页（EN 在前），两半的每一行都必须出现 —— ' +
        '少了半页的简历投出去，比报错难收拾得多。',
    })
  }

  if (!startsWith(views.bilingual.texts, views.en.texts)) {
    failures.push({
      reason: 'bilingual_en_not_first',
      severity: 'hard',
      offending: views.bilingual.texts[0] ?? '',
      detail:
        '双语版的前半段不是英版。DESIGN 10.1 要求顺序拼页且 EN 在前 —— ' +
        '顺序反了不会被排版引擎发现，只会让招聘方先读到中文。',
    })
  }

  const enModel = views.en.models[0]
  if (!views.en.pages.fitsOnePage) {
    failures.push({
      reason: 'en_over_one_page',
      severity: 'hard',
      offending: `${views.en.pages.pages} 页（超 ${views.en.pages.overflowPt}pt）`,
      detail:
        `英版超过一页。DESIGN 10.1 要求外企校招英版严格 1 页。` +
        `最占地方的块：${heaviestBlocks(enModel, layout)}。` +
        '注：中文版不设页数上限 —— 把英美的规范套到中文简历上，正是 10.1 反对的方向。',
    })
  }

  return { pass: failures.length === 0, failures, parity }
}

function modelOptions(
  target: RenderTarget,
  lang: RenderLang,
  options: DeliveryPackageOptions,
): BuildDocumentOptions {
  const rewritten = options.rewritten?.[lang]
  return {
    target,
    ...(options.includedEntryIds === undefined
      ? {}
      : { includedEntryIds: options.includedEntryIds }),
    ...(rewritten === undefined ? {} : { rewritten }),
  }
}

function makeView(name: PackageViewName, models: ViewModels, layout: LayoutSpec): PackageView {
  const [first, second] = models
  const html = second === undefined ? renderHtml(first) : renderBilingualHtml([first, second])
  return { name, models, html, texts: extractLines(html), pages: estimatePages(models, layout) }
}

export interface DeliveryPackage {
  readonly views: DeliveryPackageViews
  readonly layout: LayoutSpec
  readonly check: PackageCheck
}

/**
 * 从一份档案产出三版投递包与它的检查结论。
 *
 * 顺序固定为 CN → EN → 双语，双语内部 EN 在前。这个顺序在 T4c 会变成
 * 文件名的前缀（`Resume_EN.pdf` / `Resume_CN.pdf` / `Resume_Bilingual.pdf`），
 * 所以它是产物的一部分，不是调用方的口味。
 */
export function buildDeliveryPackage(
  archive: ArchiveV1,
  options: DeliveryPackageOptions = {},
): DeliveryPackage {
  const layout = options.layout ?? CAMPUS_LAYOUT

  const cnModel = buildDocumentModel(archive, modelOptions(CN_TARGET, 'zh', options))
  const enModel = buildDocumentModel(archive, modelOptions(EN_TARGET, 'en', options))

  const views: DeliveryPackageViews = {
    cn: makeView('Resume_CN', [cnModel], layout),
    en: makeView('Resume_EN', [enModel], layout),
    // EN 在前：DESIGN 10.1 的「顺序拼页（EN 在前），非并排」。
    bilingual: makeView('Resume_Bilingual', [enModel, cnModel], layout),
  }

  return { views, layout, check: checkPackage(views, layout) }
}
