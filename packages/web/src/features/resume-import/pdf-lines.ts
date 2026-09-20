// @vitest-environment node
/**
 * T9.1b PDF → 文本行。
 *
 * ## 为什么自己写，不复用 delivery/pdf-text.ts
 *
 * T4a 的抽取器是**验证器**：它拼文本时故意不加任何字符、不重建行结构，
 * 因为「检查者不得引入第二套排版判断」—— 那里比的是归一化后的全文。
 * 导入器正好相反：**行结构是功能本体**，解析器吃的就是行。所以这里按
 * y 坐标聚类成行 —— 这不是越权的第二套判断，而是导入器的本职。
 *
 * ## 聚类口径
 *
 * - 同一页内，y（`transform[5]`）相差 ≤ 3pt 的文本项归一行（正文 10–12pt
 *   的行距是 14–18pt，3pt 余量不会串行）；
 * - 行内按 x（`transform[4]`）升序拼接，行间按 y 降序（从上到下）；
 * - 拼接不插空格 —— PDF 内容流里该有的空格在 `str` 里。
 *
 * 与 pdf-text.ts 同走 legacy 构建：默认入口的 `Promise.try` 在 Node 22
 * 会静默挂起，legacy 里 core-js 补了（见 pdf-text.ts 的详细注释）。
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** 同一行的 y 容差（pt）。 */
const LINE_TOLERANCE = 3

interface TextPiece {
  readonly str: string
  readonly x: number
  readonly y: number
}

export async function linesFromPdfBytes(bytes: Uint8Array): Promise<string[]> {
  // pdfjs 会接管传入的内存，传副本。
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
  let pdf
  try {
    pdf = await task.promise
  } catch (cause) {
    throw new Error(
      `PDF 解析失败：文件可能不是有效的 PDF（${cause instanceof Error ? cause.message : String(cause)}）`,
    )
  }

  try {
    const pieces: TextPiece[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      // 关掉 pdf.js 的文本规范化：它会把连续空格折叠成一个，而双空格 /
      // 全角空格是「token 分隔」启发式的判据 —— 解析器要原始文本。
      const content = await page.getTextContent({ disableNormalization: true })
      for (const item of content.items) {
        if (!('str' in item)) continue
        if (item.str === '') continue
        // transform = [a b c d e f]：e 是 x，f 是 y（基线）。
        pieces.push({ str: item.str, x: item.transform[4], y: item.transform[5] })
      }
    }

    // 按 y 降序聚类（PDF 的 y 向上，先出现的行 y 最大）。
    pieces.sort((p, q) => q.y - p.y || p.x - q.x)
    const lines: string[] = []
    let currentY: number | undefined
    let buffer: TextPiece[] = []
    const flush = (): void => {
      if (buffer.length === 0) return
      buffer.sort((p, q) => p.x - q.x)
      lines.push(buffer.map((p) => p.str).join('').trim())
      buffer = []
    }
    for (const piece of pieces) {
      if (currentY !== undefined && Math.abs(piece.y - currentY) > LINE_TOLERANCE) {
        flush()
      }
      currentY = piece.y
      buffer.push(piece)
    }
    flush()

    return lines.filter((line) => line !== '')
  } finally {
    await task.destroy()
  }
}
