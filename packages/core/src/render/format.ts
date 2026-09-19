/**
 * 产物形态规范 —— T4c 第二条勾（「双语为顺序拼页，断言不存在双栏布局」）的执行者。
 *
 * 两件事在这里合住，因为它们是同一个前提的两半：
 *
 * **「阅读顺序 == DOM 顺序」**（T4a 的全部验收标准都建立在它上面）。
 *
 * - 顺序拼页（`stitchReport`）保证**文本**是 EN 全部行 + CN 全部行，逐字如此；
 * - 单栏扫描（`scanForbiddenLayout`）保证**视觉**不会把这两半摆成左右两栏 ——
 *   而那是唯一一种「文本顺序对、读出来的顺序错」的情形。
 *
 * 两者缺一不可，而且要分开说：`stitchReport` 抓的是「拼错了」，
 * `scanForbiddenLayout` 抓的是「拼对了但并排摆」。T4b 已经把「拼错」
 * 的两条检查（缺行 / 顺序倒了）建好，这里补上第三条 —— 双语版里出现了
 * **中英两半都没有的行**。那在 T4b 的两条检查下是全绿的：
 * 「每一半的行都在」成立，「以英版开头」也成立，多出来的那行谁也不管。
 * 一道多出来的页眉或页码就足以让「顺序拼页」这句话不成立。
 *
 * ## 扫描为什么只扫「样式面」，不扫整个产物
 *
 * `styleSurface` 只取 `<style>` 块与 `style="…"` 属性的内容。理由是
 * **不能让用户的正文变成假阳性**：一份内容里出现字面量 `display:grid`
 * 的简历（比如一段讲前端的项目描述）不该被判成「排版不合格」。
 * 而所有可能引入分栏的路径都在样式面里 —— 产物是自包含的，
 * 唯一的样式来源就是 `<style>` 与内联 `style`。
 *
 * 标签类的禁止项（`<table` / `<link` / `<script`）扫的是整个文档，
 * 而且不必担心假阳性：**渲染层对一切内容做了转义**，正文里的 `<` 一定是
 * `&lt;`。所以「产物里出现 `<table`」只可能是一个真的标签。
 *
 * 匹配前统一做小写 + 去空白（`normalizeCss`），因为 CSS 不区分大小写，
 * 而 `DISPLAY : GRID` / `column-count : 2` 这种写法正是绕过朴素
 * `indexOf` 的方式。`format.test.ts` 里给了这三种写法各一条断言。
 *
 * @see DESIGN 10.1 · TASKS.md T4a / T4b / T4c
 */

import {
  FORBIDDEN_CSS_DECLARATIONS,
  FORBIDDEN_MARKUP,
} from './html'

// ───────────────────────────── 多重集相减 ─────────────────────────────

/**
 * 按**多重集**把 `left` 分成「`right` 里也有」与「只有 `left` 有」。
 *
 * 用多重集而不是集合：页面上同一行出现两次是可能的（两条内容相同的要点），
 * 那种情况下「另一侧也有一行」只抵消一次。集合语义会把重复行当成一次匹配，
 * 于是双语版少拼一行也不会被发现。
 *
 * 放在本文件而不是 `package.ts` 内部，是因为它现在有第二个调用方
 * （拼页判定），而两份各自的实现迟早会漂移成两种语义。
 */
export function splitTexts(
  left: readonly string[],
  right: readonly string[],
): { readonly shared: readonly string[]; readonly leftOnly: readonly string[] } {
  const pool = new Map<string, number>()
  for (const text of right) pool.set(text, (pool.get(text) ?? 0) + 1)

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

// ───────────────────────────── 顺序拼页 ─────────────────────────────

export interface StitchMismatch {
  readonly index: number
  readonly expected: string
  readonly actual: string
}

export interface StitchReport {
  /**
   * 双语版是否**逐字等于** `EN 全部行 ++ CN 全部行`。
   *
   * 这个定义比「每一半的行都在」严：它还禁止多出来的行。
   * 「顺序拼页」这四个字的含义就是逐字拼接，而不是「内容都在里面」。
   */
  readonly ok: boolean
  readonly expectedLines: number
  readonly actualLines: number
  /** 应该出现却没有的行（多重集口径）。 */
  readonly missing: readonly string[]
  /** 出现了、而中英两半都没有的行。 */
  readonly extra: readonly string[]
  /** 第一处位置对不上的地方。`null` 表示在前 `min(expected, actual)` 行里没有错位。 */
  readonly firstMismatch: StitchMismatch | null
}

/**
 * 判定双语版是不是「EN 在前、CN 在后」的逐字拼接。
 *
 * `firstMismatch` 与 `extra` / `missing` 是三个**互不蕴含**的信号，
 * 对应三种不同的处置方式：
 *
 * | 情形 | `missing` | `extra` | `firstMismatch` |
 * |---|---|---|---|
 * | 少拼了半页 | 非空 | 空 | 可能为 `null`（是严格前缀） |
 * | 顺序倒了 | 空 | 空 | `{index: 0}` |
 * | 混进了额外的一行 | 空 | 非空 | 可能为 `null` |
 * | 后半内部被改过顺序 | 空 | 空 | 非 `null`（行数相同） |
 *
 * 最后一行是这里最容易被漏掉的情形：行数对、内容对、顺序不对，
 * 于是「缺行」与「顺序倒了」两条检查都不响。它由 `firstMismatch` 单独抓住。
 */
export function stitchReport(
  bilingual: readonly string[],
  en: readonly string[],
  cn: readonly string[],
): StitchReport {
  const expected = [...en, ...cn]

  let firstMismatch: StitchMismatch | null = null
  const comparable = Math.min(expected.length, bilingual.length)
  for (let index = 0; index < comparable; index += 1) {
    const want = expected[index] ?? ''
    const got = bilingual[index] ?? ''
    if (want !== got) {
      firstMismatch = { index, expected: want, actual: got }
      break
    }
  }

  return {
    ok: bilingual.length === expected.length && firstMismatch === null,
    expectedLines: expected.length,
    actualLines: bilingual.length,
    missing: splitTexts(expected, bilingual).leftOnly,
    extra: splitTexts(bilingual, expected).leftOnly,
    firstMismatch,
  }
}

// ───────────────────────────── 单栏扫描 ─────────────────────────────

export interface LayoutViolation {
  readonly pattern: string
  /** 命中处前后的一小段原文，用来定位是哪一条规则。 */
  readonly context: string
}

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
const STYLE_ATTRIBUTE = /\sstyle\s*=\s*"([^"]*)"/gi
const STYLE_ATTRIBUTE_SINGLE = /\sstyle\s*=\s*'([^']*)'/gi

/**
 * 取出产物里所有能写 CSS 的表面：`<style>` 块的内容 + 全部 `style` 属性值。
 *
 * 不取 `<link rel="stylesheet">` 的内容 —— 那不是一个「表面」，
 * 而是产物不再自包含的证据，由标签禁止项（`<link`）单独管。
 */
export function styleSurface(html: string): string {
  const parts: string[] = []
  for (const match of html.matchAll(STYLE_BLOCK)) parts.push(match[1] ?? '')
  for (const match of html.matchAll(STYLE_ATTRIBUTE)) parts.push(match[1] ?? '')
  for (const match of html.matchAll(STYLE_ATTRIBUTE_SINGLE)) parts.push(match[1] ?? '')
  return parts.join('\n')
}

/**
 * 小写 + 去掉**全部**空白。CSS 的声明之间允许任意空白，
 * `position :\n  absolute` 与 `position:absolute` 是同一件事 ——
 * 朴素子串匹配在这上面会漏。
 */
export function normalizeCss(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '')
}

function excerpt(text: string, at: number, length: number): string {
  return text.slice(Math.max(0, at - 24), at + length + 24)
}

/**
 * 扫出一个产物里所有违反单栏纪律的写法。空数组表示产物是单栏、无绝对定位、
 * 无表格布局、自包含。
 *
 * 两类禁止项扫的范围**故意不同**：CSS 声明只扫样式面（理由见文件头），
 * 标签扫整个文档（转义保证了不会有假阳性）。
 */
export function scanForbiddenLayout(html: string): readonly LayoutViolation[] {
  const compactStyle = normalizeCss(styleSurface(html))
  const compactDocument = normalizeCss(html)
  // 报错上下文用保留下划线与空白的小写原文，读起来才是原样的代码。
  const readable = html.toLowerCase()

  const violations: LayoutViolation[] = []

  for (const pattern of FORBIDDEN_CSS_DECLARATIONS) {
    const at = compactStyle.indexOf(pattern)
    if (at >= 0) violations.push({ pattern, context: excerpt(compactStyle, at, pattern.length) })
  }

  for (const pattern of FORBIDDEN_MARKUP) {
    const at = compactDocument.indexOf(pattern)
    if (at < 0) continue
    const atReadable = readable.indexOf(pattern)
    violations.push({
      pattern,
      context: excerpt(atReadable >= 0 ? readable : compactDocument, atReadable >= 0 ? atReadable : at, pattern.length),
    })
  }

  return violations
}
