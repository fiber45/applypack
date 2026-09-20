/**
 * 生成 PDF 文本抽取的测试夹具 `text-resume.pdf`。
 *
 * 为什么手工拼 PDF 而不是用生成库：夹具只需要「每行一个文本块」的最小
 * 结构，手工拼的 PDF 每个字节都可解释，行结构与 y 坐标完全可控 ——
 * 这正是抽取器要重建的东西，夹具不能引入第二套排版判断。
 *
 * 运行：`node make-fixture.mjs`（在 test-data 目录下）。重新生成后提交，
 * 让 CI 与本地用同一份字节。
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const LINES = [
  'Zhiyuan Lin',
  'Email: zhiyuan.lin@example.com | Phone: 13800138000',
  'EDUCATION',
  'Tsinghua University | Computer Science and Technology | Bachelor | 2021-09 - 2025-06',
  'GPA 3.8/4.0',
  'INTERNSHIP EXPERIENCE',
  'ByteDance | Software Engineer Intern | 2024-06 - 2024-09',
  'Built internal recruitment tools',
  'Tencent | Backend Developer Intern | 2023-07 - 2023-10',
  'Maintained messaging services',
  'SKILLS',
  'JavaScript, TypeScript, Go, SQL',
  'AWARDS',
  'National Scholarship 2023-10',
]

const escape = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

let stream = 'BT\n/F1 11 Tf\n16 TL\n48 780 Td\n'
for (const line of LINES) {
  stream += `(${escape(line)}) Tj T*\n`
}
stream += 'ET'

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
]

let pdf = '%PDF-1.4\n'
const offsets = [0]
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf, 'latin1'))
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
}
const xrefStart = Buffer.byteLength(pdf, 'latin1')
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

const here = dirname(fileURLToPath(import.meta.url))
const bytes = Buffer.from(pdf, 'latin1')
writeFileSync(join(here, 'text-resume.pdf'), bytes)

// 同步生成一份 base64 的 TS 模块：测试环境（types: [] 的 typecheck）没有
// @types/node，测试代码不允许 import node:fs —— 让测试从模块里拿字节。
const ts = `/**
 * 由 make-fixture.mjs 生成（不要手改）：text-resume.pdf 的 base64。
 * 重新生成：node make-fixture.mjs
 */
export const FIXTURE_PDF_BYTES: Uint8Array = Uint8Array.from(
  atob('${bytes.toString('base64')}'),
  (c) => c.charCodeAt(0),
)
`
writeFileSync(join(here, 'fixture.ts'), ts)
console.log(`written: text-resume.pdf + fixture.ts (${LINES.length} lines, ${bytes.length} bytes)`)
