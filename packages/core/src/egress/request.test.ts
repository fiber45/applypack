import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { EgressLeakError } from './errors'
import { projectArchiveForLLM } from './project'
import { assertNoBLevelEgress, assembleLLMRequest, callLLM } from './request'
import { findBLevelPaths } from './scan'
import type { LLMClient, LLMRequest, LLMResponse } from './types'

const ARCHIVE = maximalArchiveV1

const BASE = {
  archive: ARCHIVE,
  model: 'test-model',
  system: '你是一个简历改写助手。',
  volatile: [{ role: 'user' as const, content: 'JD：算法工程师，要求 Python。' }],
}

/** 只会把收到的请求记下来的假客户端 —— 评测集与 CI 用的就是它。 */
function capturingClient(): { client: LLMClient; seen: LLMRequest[] } {
  const seen: LLMRequest[] = []
  const client: LLMClient = {
    complete: (request): Promise<LLMResponse> => {
      seen.push(request)
      return Promise.resolve({ text: 'ok' })
    },
  }
  return { client, seen }
}

describe('出网组装', () => {
  it('缓存前缀的顺序是 系统提示 → 参考资料 → A 级档案', () => {
    const request = assembleLLMRequest({ ...BASE, reference: '术语表' })
    expect(request.cachedPrefix.map((message) => message.content)).toEqual([
      BASE.system,
      '术语表',
      JSON.stringify(projectArchiveForLLM(ARCHIVE)),
    ])
  })

  it('省略参考资料时前缀为两条 —— 不留下空占位', () => {
    const request = assembleLLMRequest(BASE)
    expect(request.cachedPrefix).toHaveLength(2)
  })

  it('档案落在缓存前缀末尾，易变内容全部留在断点之后', () => {
    const request = assembleLLMRequest(BASE)
    expect(request.volatile).toEqual(BASE.volatile)
    expect(request.cachedPrefix.some((message) => message.content.includes('JD：'))).toBe(false)
  })

  it('前缀中嵌入的档案是 A 级投影，不含任何 B 级路径', () => {
    const request = assembleLLMRequest(BASE)
    const profile = JSON.parse(request.cachedPrefix.at(-1)?.content ?? '{}') as unknown
    expect(findBLevelPaths(profile)).toEqual([])
  })

  it('返回的请求被冻结 —— 断言通过之后不可能再被改写', () => {
    const request = assembleLLMRequest(BASE)
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.cachedPrefix)).toBe(true)
    expect(() => {
      ;(request.cachedPrefix as unknown as unknown[]).push({ role: 'user', content: '偷偷加一条' })
    }).toThrow()
  })

  it('手工构造含 B 级值的请求 ⇒ 出口断言抛 EgressLeakError', () => {
    const smuggled = {
      model: 'test-model',
      cachedPrefix: [{ role: 'user', content: `我的手机号是 ${ARCHIVE.basics.contact.phone}` }],
      volatile: [],
    }
    expect(() => assertNoBLevelEgress(smuggled, ARCHIVE)).toThrow(EgressLeakError)
  })

  it('被阻断时错误里带得出违规字段路径，但带不出完整值', () => {
    const smuggled = { body: ARCHIVE.basics.identity.idNumber }
    try {
      assertNoBLevelEgress(smuggled, ARCHIVE)
      throw new Error('本应被阻断')
    } catch (error) {
      expect(error).toBeInstanceOf(EgressLeakError)
      const leakError = error as EgressLeakError
      expect(leakError.code).toBe('b_level_egress_blocked')
      expect(leakError.message).toContain('basics.identity.idNumber')
      expect(leakError.message).not.toContain(ARCHIVE.basics.identity.idNumber)
    }
  })

  it('callLLM 交给客户端的就是断言过的那一份载荷', async () => {
    const { client, seen } = capturingClient()
    await callLLM(client, BASE)

    expect(seen).toHaveLength(1)
    const payload = JSON.stringify(seen[0])
    expect(findBLevelPaths(JSON.parse(JSON.stringify(seen[0]?.cachedPrefix.at(-1)?.content)))).toEqual([])
    expect(payload).not.toContain(ARCHIVE.basics.contact.phone)
    expect(payload).not.toContain(ARCHIVE.basics.identity.idNumber)
    expect(payload).not.toContain(ARCHIVE.basics.name.zh)
  })

  it('callLLM 把客户端的返回值原样带出', async () => {
    const { client } = capturingClient()
    await expect(callLLM(client, BASE)).resolves.toEqual({ text: 'ok' })
  })
})
