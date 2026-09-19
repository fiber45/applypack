/**
 * 版式常量 —— 排版层的**唯一真相源**。
 *
 * ## 这个文件为什么必须存在
 *
 * T3.3 当时拒绝接受「目标页数」这个输入，理由写得很清楚：
 *
 * > 页数 → 条数的换算取决于版式（字号、行距、栏数），属于渲染层（T4）。
 * > 在这里接受「页数」等于逼 core 猜一个版式假设，而那个假设在 T4 一定会变。
 *
 * T4b 勾着「EN 版页数 == 1（超页判失败）」，所以那个版式假设现在到期了 ——
 * 它必须有地方住。放这里，而不是散在 `paginate.ts` 的算式里，因为
 * **混在算式里的常量没法被断言**：把 10.5pt 改成 11pt 会让所有页数估算一起漂移，
 * 而没有任何一条断言会红。
 *
 * ## 与 `html.ts` 的关系：手工 CSS + 漂移断言，不是代码生成
 *
 * 这里**不**生成 CSS。生成式写法（常量 → CSS 字符串）看起来更「单一真相」，
 * 代价是把样式表变成一段不可读的模板代码，而读 CSS 的人会开始怀疑
 * 自己看到的数字到底从哪来。这里采用项目里已经用过的另一种做法
 * （见 T2.1 的 `schema-snapshot.test.ts`：prompt 手写，断言它与 schema 同步）：
 *
 *   **CSS 手写，常量手写，`paginate.test.ts` 里用断言把两者的数字钉在一起。**
 *
 * 改字号只改一处会失败，改两处能通过 —— 与快照测试的取舍完全相同。
 * 而失败信息会直接指出是哪个数字对不上。
 *
 * ## 一个必须写下来的近似
 *
 * `glyphEm` 是**字形宽度的近似**，不是字体度量表。真正的排版引擎用字体的
 * advance width 表算出每一行的断点，而 core 里没有字体（也不该有）。
 *
 * 这个近似的误差方向是**两侧都会错**，所以页数估算不能被当成测量值。
 * 它的用途只有一个：在**边界附近**回答「这一页塞不塞得下」。
 * 真正的页数在 Web 端用 pdfjs 数出来（T4a 的缺口），届时那条断言
 * 必须由「估算 ≤ 1」换成「实测 == 1」—— 在本文件里改一个常量是不够的。
 *
 * @see DESIGN 10.1（各 target 的规范约束集）· TASKS.md T4b · T4c
 */

/**
 * mm → pt。`pt` 是打印世界的单位，1pt = 1/72 inch。
 * 版式常量用 mm（人对纸张的直觉），算式用 pt（字号与行距的单位），
 * 所以这个换算只在一个地方出现。
 */
export const MM_PER_PT = 25.4 / 72

/**
 * 参与高度估算的块。**这个枚举必须与 `html.ts` 渲染出的块一一对应** ——
 * 多一个块意味着算出来的高度偏小（低估页数），少一个块意味着偏大。
 * 两个方向都会让「一页」这条断言说错话，所以它由 `paginate.test.ts`
 * 里的块清单断言守着。
 */
export type BlockKind =
  /** `<h1>` 姓名 */
  | 'name'
  /** `.label` 一句话定位 */
  | 'label'
  /** `.contacts` 联系方式（行内排列，会换行但不换段） */
  | 'contacts'
  /** `.summary` 概述 */
  | 'summary'
  /** `<h2>` 节标题 */
  | 'sectionHeading'
  /** `.entry h3` 条目标题 */
  | 'entryHeading'
  /** `.meta` 条目的时间 / 地点行 */
  | 'entryMeta'
  /** `<ul>` 自身的外边距（无文字） */
  | 'listGap'
  /** `<li>` 要点 */
  | 'bullet'
  /** `.entry` 自身的下边距（无文字） */
  | 'entryGap'

export interface BlockStyle {
  /** 字号（pt）。**0 表示这个块没有文字**，只有外边距 —— 它的「行数」恒为 0。 */
  readonly fontPt: number
  readonly marginTopPt: number
  readonly marginBottomPt: number
  /** 缩进占掉的可用宽度（pt）。列表的 `padding-left` 靠它表达。 */
  readonly indentPt: number
}

export interface PageSpec {
  readonly widthMm: number
  readonly heightMm: number
  /** 四边相同的页边距。用 `@page { margin: }` 表达，于是**每一页**都有边距。 */
  readonly marginMm: number
}

export interface LayoutSpec {
  readonly name: string
  readonly page: PageSpec
  readonly lineHeight: number
  /** `body` 声明的字号。`li` 等块继承它，所以它同时是「正文行」的基准。 */
  readonly bodyFontPt: number
  /**
   * 每个字符占多少个 em。近似值，见文件头「一个必须写下来的近似」。
   *
   * 取值依据：Helvetica / Arial 的小写平均字宽约 0.50 em、数字 0.556 em、
   * 大写 0.7 em，混排下来 0.55 是一个偏保守（偏宽）的值。
   * 偏宽的选择是有意的：字宽估大了 ⇒ 行数估多 ⇒ 页数估多 ⇒
   * 「超页」会更早报警。误报的修法是删一两个要点，几秒钟；
   * 漏报的后果是一份两页的简历投出去，而用户以为它是一页。
   */
  readonly glyphEm: { readonly latin: number; readonly cjk: number }
  /** 联系方式之间的间隔（`.contacts li { margin-right }`）。 */
  readonly contactGapPt: number
  readonly blocks: Readonly<Record<BlockKind, BlockStyle>>
}

const BODY_PT = 10.5
const ARTICLE_MARGIN_MM = 14

/**
 * A4 单栏，14mm 页边距 —— 外企校招投递包使用的版式。
 *
 * 数字全部来自 `html.ts` 的 `RESUME_STYLES`，一一对应关系在
 * `paginate.test.ts` 的「漂移」一组里被断言。这里记一下取值理由：
 *
 * - **正文 10.5pt / 行距 1.5**：打印出来后是 12pt 视觉行高，是简历的常见档位。
 *   再小会在低分辨率扫描 / 转 PDF 时掉字，再大则一页塞不下三段经历。
 * - **14mm 页边距**：A4 四边各 14mm 后正文宽 182mm，这是「一页简历」的通行做法；
 *   同时所有主流打印机的最小不可打印边距都在 10mm 以内，14mm 留了余量。
 * - **`h2` 上边距 12pt**：节之间的呼吸靠它，不靠空行 ——
 *   空行会被 ATS 当成条目分隔，把归属关系切错。
 * - **`li` 的 1pt 上下边距**：看起来可有可无，但它让要点之间有了可测的间隔；
 *   0 边距时连续几行要点在打印稿上会粘成一段。
 */
export const CAMPUS_LAYOUT: LayoutSpec = Object.freeze({
  name: 'a4-single-column-campus',
  page: Object.freeze({
    widthMm: 210,
    heightMm: 297,
    marginMm: ARTICLE_MARGIN_MM,
  }),
  lineHeight: 1.5,
  bodyFontPt: BODY_PT,
  glyphEm: Object.freeze({ latin: 0.55, cjk: 1 }),
  contactGapPt: 10,
  blocks: Object.freeze({
    name: { fontPt: 18, marginTopPt: 0, marginBottomPt: 2, indentPt: 0 },
    label: { fontPt: 11, marginTopPt: 0, marginBottomPt: 6, indentPt: 0 },
    contacts: { fontPt: 10, marginTopPt: 0, marginBottomPt: 10, indentPt: 0 },
    summary: { fontPt: BODY_PT, marginTopPt: 6, marginBottomPt: 6, indentPt: 0 },
    sectionHeading: { fontPt: 12, marginTopPt: 12, marginBottomPt: 6, indentPt: 0 },
    entryHeading: { fontPt: 11, marginTopPt: 0, marginBottomPt: 0, indentPt: 0 },
    entryMeta: { fontPt: 10, marginTopPt: 1, marginBottomPt: 0, indentPt: 0 },
    listGap: { fontPt: 0, marginTopPt: 2, marginBottomPt: 0, indentPt: 0 },
    bullet: { fontPt: BODY_PT, marginTopPt: 1, marginBottomPt: 1, indentPt: 14 },
    entryGap: { fontPt: 0, marginTopPt: 0, marginBottomPt: 8, indentPt: 0 },
  }),
})
