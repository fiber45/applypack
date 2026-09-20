// @vitest-environment node
/**
 * 浏览器侧 PDF 导入入口：`File` → 文本行。
 *
 * pdf.js 的 worker 初始化**只走这条路径**：
 * - node 测试直接调 `pdf-lines.ts`（fake worker，无 workerSrc 依赖）；
 * - UI 测试把本模块整个 mock 掉（vi.mock 拦截后下面的副作用不会执行）；
 * - 浏览器运行时才需要真的 worker —— vite 把 worker 产物作为同源资源
 *   发出去，`?url` 给出它的地址。CSP 的 `script-src 'self'` 允许同源
 *   worker，`connect-src 'none'` 的零网络承诺不受影响。
 */

import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

import { linesFromPdfBytes } from './pdf-lines'

GlobalWorkerOptions.workerSrc = workerUrl

export async function readPdfFile(file: File): Promise<string[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return linesFromPdfBytes(bytes)
}
