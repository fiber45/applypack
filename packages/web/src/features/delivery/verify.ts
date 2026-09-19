/**
 * 文本层比对 —— T4a 那个空勾（「PDF 生成与 pdfjs 反向抽取」）的判据本体。
 *
 * ## 判据是什么，以及**为什么是这个**
 *
 * 逐字符比 PDF 抽出的文本与 HTML 的 ATS 文本，**忽略全部空白**：
 *
 * ```
 * strip(pdf) === strip(html)          其中 strip = 去掉所有空白 + 去掉已声明的装饰
 * ```
 *
 * 不按行比、不按空格比，理由是实测出来的，不是审美：
 * 排版引擎在**空格处断行时会吞掉那个空格**。同一段中文里
 * `窗口压缩到 38 分钟` 被排成两行，抽回来是 `窗口压缩到` + `38 分钟` ——
 * 中间那个空格两个 item 里都没有。按空格比会把它报成失败，
 * 而它是排版引擎的正常行为；一条会因自身口径失败的断言，最后一定会被人为放宽，
 * 放宽之后就再也守不住真正该守的东西。
 *
 * 忽略空白之后，这条判据守的是**真正灾难性的那几种**：
 *
 * | 守得住 | 怎么表现 |
 * |---|---|
 * | 丢块（某段经历没被渲染） | 字符流里少一截 |
 * | 乱序（中英两半颠倒、节顺序错） | 字符流对不上 |
 * | 重复（复制粘贴式的模板错误） | 多一截 |
 * | **编码搞乱**（中文变乱码 / 方框） | 这是字体与 CMap 问题上最常见的产物，字符流直接崩 |
 * | 渲染器把文本转成图形 | 字符流几乎为空 |
 *
 * **它守不住**的是：断行处被吞掉的那个空格。这一条被明确写在这里，
 * 因为它是个真缺口而不是理论缺口 —— 换句话说，一份把 `Campus Marketplace`
 * 渲染成 `CampusMarketplace` 的 PDF 能通过本判据。补偿手段在 HTML 那一侧：
 * core 的文本是空格正确的，而 core 的断言保证它齐全、有序。
 *
 * ## 装饰：多出来的字符不许超出声明
 *
 * PDF 模板会画 HTML 文本里没有的东西（要点的 `•`）。这类字符如果直接从
 * 字符流里删掉，就等于给「模板悄悄多渲染一段字」开了一个静默通道。
 * 所以它走两步：
 *
 * 1. 只删**声明过**的装饰（`DELIVERY_DECORATIONS`）
 * 2. 剩下的多余字符必须为空 —— 多一个没声明的字符就红
 *
 * 第二步让第一步无法被滥用：声明集一旦被用来藏东西，第二步就会响。
 */

/**
 * PDF 模板会画、而 HTML 的 ATS 文本里没有的字符。
 *
 * 目前只有一个：`●`（U+25CF）。HTML 靠 `list-style` 让浏览器画要点标记，
 * 而 `extractLines` 是纯字符串处理，看不见 CSS 生成的内容 ——
 * 这不是谁的错，是「HTML 文本」与「屏幕上的样子」本来就有一层差异。
 * PDF 里那个 `●` 是**真实字符**，所以必须被显式声明。
 *
 * 为什么不是更常规的 `•`（U+2022）：Noto Sans SC 把 `•`、`·`（U+00B7）、
 * `･`（U+30FB）编成同一个字形（glyph 1375），字体子集化后 ToUnicode 只能
 * 把这个字形映射回一个码点 —— 正文里真 `·` 一出现（meta 行的分隔符），
 * 标记抽回来就成了 `·`，判据把它报成未声明的多余字符。`●` 有独占字形，
 * 抽回来还是它自己。选标记字符前先查 `glyphForCodePoint` 的反向映射是否唯一。
 *
 * 加新字符之前先问两句：它能不能改成从模板里删掉？它在字体里有没有
 * 独占字形？装饰越多，这条判据能看见的东西越少。
 */
export const DELIVERY_DECORATIONS: readonly string[] = Object.freeze(['●'])

const WHITESPACE = /\s+/gu

/** 去掉所有空白。包含 `\t`、`\n`、全角空格 —— `\s` 在 JS 里覆盖它们。 */
export function stripWhitespace(text: string): string {
  return text.replace(WHITESPACE, '')
}

/** 去掉所有已声明的装饰字符。 */
export function removeDecorations(text: string): string {
  let result = text
  for (const decoration of DELIVERY_DECORATIONS) {
    result = result.split(decoration).join('')
  }
  return result
}

/** 归一化后的比对形态：去空白、去装饰。 */
export function normalizeForCompare(text: string): string {
  return removeDecorations(stripWhitespace(text))
}

/** 非空白字符的计数表，用于「多余字符」判定。 */
export function nonSpaceCounts(text: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const char of stripWhitespace(text)) {
    counts.set(char, (counts.get(char) ?? 0) + 1)
  }
  return counts
}

export interface TextLayerComparison {
  /** 判据本体：归一化后完全相等，且没有未声明的多余字符。 */
  readonly pass: boolean
  readonly normalizedHtml: string
  readonly normalizedPdf: string
  /** 两个归一化串第一处不同的下标；完全相等时为 `null`。 */
  readonly firstDivergence: number | null
  /** 产物里出现、而 HTML 文本里没有、且**不在声明集里**的字符（已去重排序）。 */
  readonly undeclared: readonly string[]
  /** 声明集里的字符在产物里各出现了几次。用来验证声明不是废的。 */
  readonly decorationCounts: ReadonlyMap<string, number>
  /** 已声明的装饰在 HTML 文本里也出现 —— 此时「删掉它」会同时删掉真实内容。 */
  readonly conflicts: readonly string[]
  readonly detail: string
}

function firstDivergence(left: string, right: string): number | null {
  const limit = Math.min(left.length, right.length)
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return left.length === right.length ? null : limit
}

function context(text: string, at: number): string {
  const from = Math.max(0, at - 24)
  const to = Math.min(text.length, at + 24)
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`
}

/**
 * 比对一条产物的文本层。
 *
 * `htmlText` 与 `pdfText` 都是**多行文本**：前者来自 `PackageView.texts`
 * （由 `extractLines` 从 HTML 抽出的行，用 `\n` 连接），后者由
 * `pdf-text.ts` 把 pdfjs 的 item 按阅读顺序拼起来。
 */
export function compareTextLayers(
  htmlText: string,
  pdfText: string,
): TextLayerComparison {
  const conflicts = DELIVERY_DECORATIONS.filter((decoration) =>
    stripWhitespace(htmlText).includes(decoration),
  )

  const normalizedHtml = normalizeForCompare(htmlText)
  const normalizedPdf = normalizeForCompare(pdfText)
  const divergence = firstDivergence(normalizedHtml, normalizedPdf)

  const htmlCounts = nonSpaceCounts(normalizedHtml)
  const pdfCounts = nonSpaceCounts(normalizedPdf)
  const undeclared: string[] = []
  for (const [char, count] of pdfCounts) {
    if (count > (htmlCounts.get(char) ?? 0)) undeclared.push(char)
  }
  undeclared.sort()

  const rawPdf = stripWhitespace(pdfText)
  const decorationCounts = new Map<string, number>()
  for (const decoration of DELIVERY_DECORATIONS) {
    decorationCounts.set(decoration, rawPdf.split(decoration).length - 1)
  }

  const pass = divergence === null && undeclared.length === 0 && conflicts.length === 0

  const problems: string[] = []
  if (conflicts.length > 0) {
    problems.push(
      `装饰字符 ${conflicts.map((c) => `「${c}」`).join('')} 也出现在 HTML 文本里，` +
        '此时「删掉装饰」会同时删掉真实内容，本判据不再可靠',
    )
  }
  if (divergence !== null) {
    const htmlSide = normalizedHtml[divergence] ?? '（已结束）'
    const pdfSide = normalizedPdf[divergence] ?? '（已结束）'
    problems.push(
      `第 ${divergence} 个字符起不一致：HTML 是「${htmlSide}」，PDF 是「${pdfSide}」\n` +
        `  HTML：${context(normalizedHtml, divergence)}\n` +
        `  PDF ：${context(normalizedPdf, divergence)}`,
    )
  }
  if (undeclared.length > 0) {
    problems.push(
      `PDF 里有 ${undeclared.length} 个未声明的多余字符：${undeclared.map((c) => `「${c}」`).join('')}` +
        '（要加装饰就加进 DELIVERY_DECORATIONS，并在测试里确认它真的被渲染）',
    )
  }

  return {
    pass,
    normalizedHtml,
    normalizedPdf,
    firstDivergence: divergence,
    undeclared,
    decorationCounts,
    conflicts,
    detail:
      problems.length === 0
        ? `一致：${normalizedHtml.length} 个字符（已忽略 ${pdfText.length - normalizedPdf.length} 个空白与装饰）`
        : problems.join('\n'),
  }
}
