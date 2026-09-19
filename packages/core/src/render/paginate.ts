/**
 * 页数估算 —— 「EN 版页数 == 1」这条断言的执行者。
 *
 * ## 先说清楚这不是什么
 *
 * 它**不是**页数测量。真实的页数只有排版引擎知道，而 core 里没有排版引擎
 * （也没有字体）。这里做的是一次确定性的高度累加：把文档模型按块摊成
 * 「行数 × 行高 + 外边距」，再除以一页的可用高度。
 *
 * ## 那它凭什么能作为一条闸门
 *
 * 因为估算误差的方向是被**选择**过的，不是碰巧的：
 *
 * | 近似的哪一侧 | 取值方向 | 后果 |
 * |---|---|---|
 * | 字形宽度 `glyphEm.latin` | 偏宽（0.55） | 行数偏多 ⇒ 页数偏多 ⇒ 更容易报「超页」 |
 * | 换行位置 | 按字符累加，不做断词 | 长英文单词不会「恰好放下」⇒ 同样偏多 |
 * | 块的清单 | 与渲染块一一对应（有断言） | 漏块 ⇒ 低估，所以在测试里被钉住 |
 *
 * 结论：**它可能说「超页」而实际没超，不会说「刚好」而实际超了。**
 * 误报的代价是删一两个要点，漏报的代价是一份两页的简历投出去而用户以为一页。
 * 这个不对称就是它敢当闸门的全部理由。
 *
 * ## 边界（写下来而不是绕过去）
 *
 * - **只在边界附近有意义。** `pages` 对多页文档是 `ceil` 近似，因为真实的
 *   分页取决于「块能不能被拆开」，而那是引擎的行为。所以被断言的只有
 *   `fitsOnePage`（`usedPt <= capacityPt`），`pages > 1` 时它只是量级。
 * - **拼页时反而精确。** 双语版的两半各自从新页开始（`break-before: page`），
 *   不存在跨页断点，所以 `pages = pages(en) + pages(cn)` 是**精确**的。
 *   同一个公式在单份文档上是近似、在拼页上是精确 —— 这个反差值得记一笔。
 * - **它必须被 pdfjs 的实测替换。** Web 端接入 PDF 之后，这条断言应换成
 *   「实测页数 == 1」。只改这里的常量是不够的，也不该够。
 *
 * @see DESIGN 10.1 · TASKS.md T4a（PDF 缺口）· T4b
 */

import { MM_PER_PT, type BlockKind, type LayoutSpec, CAMPUS_LAYOUT } from './layout'
import { entryLines, type DocumentModel } from './model'

/**
 * 全角（宽）字符的码点区间。
 *
 * 判据是「这个字符在等宽 CJK 字体里是否占一个全宽」—— 直接从
 * Unicode 的 East Asian Width 属性取宽字符区间，而不是靠猜。
 * 落在这些区间之外的字符按 `glyphEm.latin` 计。
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = Object.freeze([
  [0x1100, 0x115f], // 谚文字母
  [0x2e80, 0x303e], // CJK 部首、标点
  [0x3041, 0x33ff], // 假名、注音、CJK 兼容
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 基本区
  [0xa000, 0xa4cf], // 彝文
  [0xac00, 0xd7a3], // 谚文音节
  [0xf900, 0xfaff], // CJK 兼容表意
  [0xfe30, 0xfe4f], // CJK 兼容形式
  [0xff00, 0xff60], // 全角形式
  [0xffe0, 0xffe6], // 全角符号
  [0x1f300, 0x1f9ff], // emoji（简历里会出现，且确实占全宽）
])

function isWide(codePoint: number): boolean {
  for (const [start, end] of WIDE_RANGES) {
    if (codePoint >= start && codePoint <= end) return true
  }
  return false
}

/** 一段文字占多少个 em。 */
export function advanceEm(text: string, layout: LayoutSpec): number {
  let em = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined) continue
    em += isWide(codePoint) ? layout.glyphEm.cjk : layout.glyphEm.latin
  }
  return em
}

/** 正文的可用宽度（pt）：页宽减去两侧页边距。 */
export function columnWidthPt(layout: LayoutSpec): number {
  return (layout.page.widthMm - 2 * layout.page.marginMm) / MM_PER_PT
}

/** 一页的可用高度（pt）。 */
export function columnHeightPt(layout: LayoutSpec): number {
  return (layout.page.heightMm - 2 * layout.page.marginMm) / MM_PER_PT
}

/** 一行正文占多高（pt）。所有块的「行」都以它为单位折算成 pt 高度。 */
export function bodyLinePt(layout: LayoutSpec): number {
  return layout.bodyFontPt * layout.lineHeight
}

/** 一块文字在这个字号 / 缩进下要占几行。**至少一行** —— 空字符串也占一行高。 */
export function wrappedLines(
  text: string,
  fontPt: number,
  layout: LayoutSpec,
  indentPt: number,
): number {
  if (fontPt <= 0) return 0
  const widthPt = columnWidthPt(layout) - indentPt
  if (widthPt <= 0) return 1
  const widthEm = widthPt / fontPt
  const em = advanceEm(text, layout)
  return Math.max(1, Math.ceil(em / widthEm))
}

export interface BlockCost {
  readonly kind: BlockKind
  /** 占几行。无文字的块（`listGap` / `entryGap`）恒为 0。 */
  readonly lines: number
  readonly heightPt: number
}

/**
 * 块的中文名。存在的唯一理由是**失败信息**：
 * 「超出 62pt」对用户没有任何指导意义，「要点 372pt / 节标题 216pt」才有。
 */
export const BLOCK_LABELS: Readonly<Record<BlockKind, string>> = Object.freeze({
  name: '姓名',
  label: '一句话定位',
  contacts: '联系方式',
  summary: '概述',
  sectionHeading: '节标题',
  entryHeading: '条目标题',
  entryMeta: '时间地点行',
  listGap: '列表间距',
  bullet: '要点',
  entryGap: '条目间距',
})

/**
 * 把一个模型摊成块清单 —— **这个函数的输出就是页数估算的全部依据**。
 *
 * 导出来是为了让「页数为什么是 2」可以被逐块核对。一条只说
 * 「超出一页」的失败信息，用户能做的只有凭感觉删东西；给出块清单之后，
 * 他知道该删哪一段。
 */
export function layoutBlocks(model: DocumentModel, layout: LayoutSpec): readonly BlockCost[] {
  const out: BlockCost[] = []

  const push = (kind: BlockKind, text: string): void => {
    const style = layout.blocks[kind]
    const lines = style.fontPt > 0 ? wrappedLines(text, style.fontPt, layout, style.indentPt) : 0
    out.push({
      kind,
      lines,
      heightPt: lines * style.fontPt * layout.lineHeight + style.marginTopPt + style.marginBottomPt,
    })
  }

  /**
   * 联系方式是**行内排列**（`.contacts li { display: inline }`），
   * 所以它不是「每条一行」，而是「所有条目加起来在正文宽度里换行」。
   * 按「一条一行」估会在有 6 个联系方式时多报 5 行 —— 那正好是「一页」
   * 这条断言的临界量级，所以这里必须按宽度累加，不能用块公式。
   */
  const pushContacts = (): void => {
    const style = layout.blocks.contacts
    const itemWidths = model.contacts.map(
      (line) => advanceEm(`${line.label}:${line.value}`, layout) * style.fontPt,
    )
    const gaps = Math.max(0, itemWidths.length - 1) * layout.contactGapPt
    const totalPt = itemWidths.reduce((sum, width) => sum + width, 0) + gaps
    const widthPt = columnWidthPt(layout)
    const lines = Math.max(1, Math.ceil(totalPt / widthPt))
    out.push({
      kind: 'contacts',
      lines,
      heightPt: lines * style.fontPt * layout.lineHeight + style.marginTopPt + style.marginBottomPt,
    })
  }

  if (model.name !== '') push('name', model.name)
  if (model.label !== '') push('label', model.label)
  if (model.contacts.length > 0) pushContacts()
  if (model.summary !== '') push('summary', model.summary)

  for (const section of model.sections) {
    push('sectionHeading', section.heading)
    for (const entry of section.entries) {
      push('entryHeading', entry.heading)
      if (entry.meta.length > 0) push('entryMeta', entry.meta.join(' · '))
      const lines = entryLines(entry)
      if (lines.length > 0) {
        push('listGap', '')
        for (const line of lines) push('bullet', line)
      }
      push('entryGap', '')
    }
  }

  return out
}

export interface PageEstimate {
  /** 内容总高度（pt） */
  readonly usedPt: number
  /**
   * **一页**能装多少（pt）。刻意不是「这些页加起来能装多少」——
   * 后者是个恒等式：`pages` 本来就是 `ceil(used / 单页)` 算出来的，
   * 于是 `used - pages × 单页` 永远 ≤ 0，「超出多少」会恒为 0。
   * 那个值看起来在报溢出，实际永远是 0 —— 一个不可能失败的判据。
   * 这里要的是「离一页这条线还有多远」，所以基准只能是单页。
   */
  readonly capacityPt: number
  /**
   * 页数。单份文档上是 `ceil` 近似（真正的分页取决于块的拆分行为），
   * **拼页时精确**（每一份从新页开始，没有跨页断点）。
   */
  readonly pages: number
  /** 只有这一条被当成闸门用。见文件头「边界」。 */
  readonly fitsOnePage: boolean
  /** 离一页的边线还空多少（pt）。超页时为 0。 */
  readonly slackPt: number
  /** 要删掉多少内容才能塞进一页（pt）。未超页时为 0。 */
  readonly overflowPt: number
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 估算一份或**多份拼页文档**的占用。
 *
 * 多份的语义是拼页（`break-before: page`），不是续排 —— 所以页数按份求和，
 * 而那正好让结果从近似变成精确。
 */
export function estimatePages(
  models: readonly DocumentModel[],
  layout: LayoutSpec = CAMPUS_LAYOUT,
): PageEstimate {
  const capacity = columnHeightPt(layout)

  let usedPt = 0
  let pages = 0
  for (const model of models) {
    const blocks = layoutBlocks(model, layout)
    const used = blocks.reduce((sum, block) => sum + block.heightPt, 0)
    usedPt += used
    pages += Math.max(1, Math.ceil(used / capacity))
  }

  const capacityPt = capacity
  return {
    usedPt: round1(usedPt),
    capacityPt: round1(capacityPt),
    pages,
    fitsOnePage: pages <= 1,
    slackPt: round1(Math.max(0, capacityPt - usedPt)),
    overflowPt: round1(Math.max(0, usedPt - capacityPt)),
  }
}
