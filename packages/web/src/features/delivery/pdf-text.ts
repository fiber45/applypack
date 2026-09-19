/**
 * pdfjs 反向抽取 —— 把生成的 PDF 字节读回文本。
 *
 * ## 为什么这件事值得单独一层
 *
 * 它是**唯一一处真正经过「成品」而不是「模型」的检查**。上游所有的断言
 * （T4a 的 21 条、T4b 的跨语言一致、T4c 的形态）看的都是 HTML 字符串或
 * 文档模型 —— 它们能证明「我们打算印什么」，不能证明「印出来是什么」。
 * 中间隔着字体子集、CMap、文本定位、分页，而中文恰好是这四项一起出问题
 * 的地方（最常见的失败形态是抽出一串乱码或一串方框，两种都不会在
 * HTML 层有任何症状）。
 *
 * ## 抽取口径：只按阅读顺序拼 item，不做几何重建
 *
 * `getTextContent()` 给的是**文本块**（item），不是行。把 item 拼成行需要
 * 按 y 坐标聚类，而那是**检查者自己引入的第二套排版判断** —— 一旦它和
 * 排版引擎的判断不一致，红的就是检查者而不是产物。所以这里不做聚类：
 *
 * - 按页序、页内按 pdfjs 返回的顺序拼 `str`
 * - **不插入任何字符**（既不加空格，也不把换行换算成空格）
 *
 * 换行与空格的处理全部交给 `verify.ts` 的归一化（那里忽略所有空白），
 * 于是「断行吞掉空格」这类排版行为不会被误报。这样做丢掉的诊断能力
 * （「第几行不一致」）由 `verify.ts` 的字符下标与上下文片段补回来。
 *
 * `useSystemFonts: false` 是刻意的：抽取结果必须只依赖**文档内嵌的字体**
 * 与它自带的 CMap。允许回退到系统字体的话，同一份 PDF 在 CI 上抽得出来、
 * 在缺字体的机器上抽不出来，而判据会因此变成「跑在什么机器上」的函数。
 *
 * ## 为什么走 legacy 构建，而不是默认入口
 *
 * 默认入口的 `MessageHandler.#onMessage` 直接调用 `Promise.try`（ES2025 API），
 * 而 Node 22 没有它 —— 症状不是报错，是**抽取的 Promise 永远挂起**，
 * 直到测试超时，跟「渲染慢」分不清。legacy 构建里 core-js 自己补了
 * `Promise.try`（`pdf.mjs` 的 `// \`Promise.try\` method` 一节），
 * 所以切过去就自愈，不需要我们在全局上打补丁。类型也一样能用：
 * legacy 目录里有配套的 `pdf.d.mts`。
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PdfTextLayer {
  /** 实测页数。T4b 的页数估算从此可以被实测替换。 */
  readonly pageCount: number
  /** 每一页各自拼出的文本，按页序。 */
  readonly pageTexts: readonly string[]
  /** 全部页面按顺序拼起来的文本。 */
  readonly text: string
}

export interface ExtractOptions {
  /**
   * 逐页文本的拼接分隔符。默认 `\n`。
   *
   * 默认值只是为了让失败信息可读 —— 判据会忽略所有空白，
   * 所以改成什么都不影响结论。
   */
  readonly pageSeparator?: string
}

export async function extractPdfText(
  bytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<PdfTextLayer> {
  const separator = options.pageSeparator ?? '\n'

  // pdfjs 会接管并可能转移这块内存，传副本以免调用方手里的字节被抽空。
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  })
  const pdf = await task.promise

  try {
    const pageTexts: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        // `items` 里既有 TextItem 也有 TextMarkedContent，后者没有 `str`。
        if ('str' in item) text += item.str
      }
      pageTexts.push(text)
    }

    return {
      pageCount: pdf.numPages,
      pageTexts,
      text: pageTexts.join(separator),
    }
  } finally {
    // pdfjs 6.x 起文档代理上只有 `cleanup()`；`destroy()` 在 loading task 上
    // （它才是持有 worker 的那个）。旧教程里的 `pdf.destroy()` 在这一版会
    // 直接 TypeError，而且发生在 finally 里 —— 会把本已成功的抽取结果
    // 顶成一次失败，所以这里必须是对的对象。
    await task.destroy()
  }
}
