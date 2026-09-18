import { describe, expect, it } from 'vitest'

import { blockingLeaks, scanPayload, type LLMClient, type LLMRequest } from '../egress/index'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { compileExperience } from './experience'
import { compileJd } from './jd'
import { CompileError } from './errors'

function scripted(responses: readonly string[]): { client: LLMClient; seen: LLMRequest[] } {
  const seen: LLMRequest[] = []
  let index = 0
  return {
    seen,
    client: {
      complete: (request) => {
        seen.push(request)
        const text = responses[Math.min(index, responses.length - 1)] ?? ''
        index += 1
        return Promise.resolve({ text })
      },
    },
  }
}

const JD_TEXT = `算法工程师（校招）
岗位要求：
1. 计算机相关专业本科及以上学历，2026 届毕业生；
2. 熟悉 Python 与 PyTorch，有推荐系统相关项目经验者优先；
3. 具备良好的英文读写能力。
加分项：有大规模数据处理经验。`

const JD_JSON = JSON.stringify({
  title: '算法工程师',
  company: null,
  hardRequirements: [
    { kind: 'degree', text: '计算机相关专业本科及以上学历', strict: true },
    { kind: 'graduation', text: '2026 届毕业生', strict: true },
  ],
  skills: [
    { name: 'Python', proficiency: 'proficient', required: true, evidence: '熟悉 Python 与 PyTorch' },
    { name: '推荐系统', proficiency: 'familiar', required: false, evidence: '有推荐系统相关项目经验者优先' },
  ],
  responsibilities: ['负责推荐系统相关算法的开发与优化'],
  register: 'technical',
  language: 'zh',
})

const RAW_EXPERIENCE = `某某科技有限公司 · 算法工程实习生 · 2025.06 - 2025.09
负责推荐系统召回通道的特征工程，累计上线 12 个特征，将离线特征回填耗时从 4.2 小时降至 38 分钟。`

const SOURCE_SENTENCE = '负责推荐系统召回通道的特征工程，累计上线 12 个特征，将离线特征回填耗时从 4.2 小时降至 38 分钟。'

function entryJson(sourceText: string, numbers: readonly string[]): string {
  return JSON.stringify({
    entries: [
      {
        kind: 'work',
        title: '算法工程实习生',
        organization: '某某科技有限公司',
        startDate: '2025-06',
        endDate: '2025-09',
        sourceText,
        numbers,
      },
    ],
  })
}

describe('JD 编译', () => {
  it('正常编译出结构化 JD', async () => {
    const { client } = scripted([JD_JSON])
    const jd = await compileJd({ client, model: 'm', jdText: JD_TEXT })
    expect(jd.title).toBe('算法工程师')
    expect(jd.register).toBe('technical')
    expect(jd.skills).toHaveLength(2)
  })

  it('JD 编译的上下文里没有任何用户数据 —— 缓存前缀只有系统提示', async () => {
    const { client, seen } = scripted([JD_JSON])
    await compileJd({ client, model: 'm', jdText: JD_TEXT })

    expect(seen[0]?.cachedPrefix).toHaveLength(1)
    const payload = JSON.stringify(seen[0])
    expect(payload).not.toContain(maximalArchiveV1.basics.name.zh)
    expect(payload).not.toContain(maximalArchiveV1.basics.contact.phone)
  })

  it('JD 原文落在易变段（缓存断点之后）', async () => {
    const { client, seen } = scripted([JD_JSON])
    await compileJd({ client, model: 'm', jdText: JD_TEXT })
    expect(seen[0]?.volatile).toHaveLength(1)
    expect(seen[0]?.volatile[0]?.content).toContain('2026 届毕业生')
  })

  it('结构不符 ⇒ 重试，耗尽后抛 CompileError', async () => {
    const { client } = scripted(['{"title":"x"}'])
    await expect(compileJd({ client, model: 'm', jdText: JD_TEXT, maxAttempts: 2 })).rejects.toBeInstanceOf(
      CompileError,
    )
  })
})

describe('经历编译', () => {
  it('正常编译，且 sourceText 逐字保留', async () => {
    const { client } = scripted([entryJson(SOURCE_SENTENCE, ['12', '4.2', '38'])])
    const compiled = await compileExperience({ client, model: 'm', rawText: RAW_EXPERIENCE })
    expect(compiled.entries[0]?.sourceText).toBe(SOURCE_SENTENCE)
    expect(compiled.entries[0]?.numbers).toEqual(['12', '4.2', '38'])
  })

  it('**sourceText 被改写 ⇒ 重试**（否则溯源链静默失效）', async () => {
    const { client, seen } = scripted([
      entryJson('负责特征工程相关工作，上线了十二个特征。', []),
      entryJson(SOURCE_SENTENCE, ['12', '4.2', '38']),
    ])
    const compiled = await compileExperience({ client, model: 'm', rawText: RAW_EXPERIENCE })

    expect(seen).toHaveLength(2)
    expect(seen[1]?.volatile[2]?.content).toContain('sourceText')
    expect(compiled.entries[0]?.sourceText).toBe(SOURCE_SENTENCE)
  })

  it('**numbers 里出现原文没有的数字 ⇒ 重试**', async () => {
    const { client, seen } = scripted([
      entryJson(SOURCE_SENTENCE, ['12', '4.2', '38', '40']),
      entryJson(SOURCE_SENTENCE, ['12', '4.2', '38']),
    ])
    const compiled = await compileExperience({ client, model: 'm', rawText: RAW_EXPERIENCE })

    expect(seen).toHaveLength(2)
    expect(seen[1]?.volatile[2]?.content).toContain('40')
    expect(compiled.entries[0]?.numbers).toEqual(['12', '4.2', '38'])
  })

  it('始终无法溯源 ⇒ 抛错而不是返回一个「看起来很干净」的产物', async () => {
    const { client } = scripted([entryJson('凭空写的一句话。', [])])
    await expect(
      compileExperience({ client, model: 'm', rawText: RAW_EXPERIENCE, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(CompileError)
  })

  it('带档案时仍不出网任何 B 级数据 —— 编译层复用了组装层，没有另开通道', async () => {
    const { client, seen } = scripted([entryJson(SOURCE_SENTENCE, ['12', '4.2', '38'])])
    await compileExperience({
      client,
      model: 'm',
      rawText: RAW_EXPERIENCE,
      archive: maximalArchiveV1,
    })

    expect(blockingLeaks(scanPayload(seen[0], maximalArchiveV1))).toEqual([])
    const payload = JSON.stringify(seen[0])
    expect(payload).not.toContain(maximalArchiveV1.basics.contact.phone)
    expect(payload).not.toContain(maximalArchiveV1.basics.identity.idNumber)
    expect(payload).toContain(maximalArchiveV1.work[0]?.highlights[0])
  })

  it('不传档案时上下文里就没有档案 —— 省略不是「传个空的」', async () => {
    const { client, seen } = scripted([entryJson(SOURCE_SENTENCE, ['12', '4.2', '38'])])
    await compileExperience({ client, model: 'm', rawText: RAW_EXPERIENCE })
    expect(seen[0]?.cachedPrefix).toHaveLength(1)
  })
})
