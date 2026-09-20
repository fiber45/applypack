// @vitest-environment node
/**
 * T9.1b PDF 文本行抽取 —— 断言先行。
 *
 * 与 delivery/pdf-text.ts（T4a 的验证器）的分工：那是「检查印了什么」，
 * 故意不做几何重建；这里是「给解析器喂行」，**行结构本身就是功能** ——
 * 按 y 坐标聚类成行是导入器的本职判断，不是检查者越权。
 *
 * 夹具是手工拼的最小 PDF（每行一个文本块，y 坐标完全可控），由
 * `test-data/make-fixture.mjs` 生成并随仓库提交。
 */

import { describe, expect, it } from 'vitest'

import { parseResumeText } from './parse'
import { linesFromPdfBytes } from './pdf-lines'
import { FIXTURE_PDF_BYTES } from './test-data/fixture'

// 夹具由 make-fixture.mjs 生成（fixture.ts 是它的 base64 镜像），
// 不经 node:fs 读取 —— typecheck 的 types: [] 不允许测试碰 node API。
const fixtureBytes = (): Uint8Array => new Uint8Array(FIXTURE_PDF_BYTES)

describe('linesFromPdfBytes：fixture PDF', () => {
  const lines = async (): Promise<string[]> => linesFromPdfBytes(fixtureBytes())

  it('行数与夹具一致（14 行，无空行混入）', async () => {
    expect(await lines()).toHaveLength(14)
  })

  it('顺序保真：从上到下，第一行姓名、最后一行奖项', async () => {
    const all = await lines()
    expect(all[0]).toBe('Zhiyuan Lin')
    expect(all[all.length - 1]).toBe('National Scholarship 2023-10')
  })

  it('文本完整：教育行一个字符不少（分隔符穿越抽取层存活）', async () => {
    expect(await lines()).toContain(
      'Tsinghua University | Computer Science and Technology | Bachelor | 2021-09 - 2025-06',
    )
  })

  it('端到端：抽取的行喂给解析器，两段实习 / 学历 / 技能 / 奖项全识别', async () => {
    const parsed = parseResumeText((await lines()).join('\n'))
    expect(parsed.name).toEqual({ en: 'Zhiyuan Lin' })
    expect(parsed.email).toBe('zhiyuan.lin@example.com')
    expect(parsed.education).toHaveLength(1)
    expect(parsed.education[0]!.institution).toBe('Tsinghua University')
    expect(parsed.education[0]!.studyType).toBe('Bachelor')
    expect(parsed.work).toHaveLength(2)
    expect(parsed.work[0]!.company).toBe('ByteDance')
    expect(parsed.work[1]!.company).toBe('Tencent')
    expect(parsed.skills).toEqual(['JavaScript', 'TypeScript', 'Go', 'SQL'])
    expect(parsed.awards).toContain('National Scholarship')
  })

  it('非 PDF 字节：报可读错误而不是挂起', async () => {
    await expect(linesFromPdfBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})
