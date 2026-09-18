import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { LLMClient, LLMRequest } from '../egress/index'
import { CompileError } from './errors'
import type { ParseFailure } from './parse'
import { DEFAULT_MAX_ATTEMPTS, compileStructured } from './runner'

const schema = z.strictObject({ name: z.string() })
const GOOD = '{"name":"林知远"}'

/** 按脚本依次吐回复的假客户端；脚本用尽后重复最后一条。 */
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

function base(client: LLMClient, maxAttempts?: number) {
  return {
    client,
    model: 'test-model',
    system: '你是解析器。',
    task: '请解析这段经历。',
    schema,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  }
}

describe('有限重试守门', () => {
  it('一次通过 ⇒ 只调用一次', async () => {
    const { client, seen } = scripted([GOOD])
    await expect(compileStructured(base(client))).resolves.toEqual({ name: '林知远' })
    expect(seen).toHaveLength(1)
  })

  it('坏 → 坏 → 好 ⇒ 三次调用后成功，且中途带着反馈', async () => {
    const { client, seen } = scripted(['这不是 JSON', '{"name":123}', GOOD])
    await expect(compileStructured(base(client))).resolves.toEqual({ name: '林知远' })

    expect(seen).toHaveLength(3)
    expect(seen[0]?.volatile).toHaveLength(1)
    expect(seen[1]?.volatile).toHaveLength(3)
    expect(seen[1]?.volatile[1]?.role).toBe('assistant')
    expect(seen[1]?.volatile[2]?.content).toContain('JSON')
  })

  it('重试时把上一轮的原文回显给模型（否则它不知道自己写错了什么）', async () => {
    const { client, seen } = scripted(['BROKEN OUTPUT', GOOD])
    await compileStructured(base(client))
    expect(seen[1]?.volatile[1]?.content).toContain('BROKEN OUTPUT')
  })

  it('永远失败 ⇒ 恰好调用 maxAttempts 次，然后抛 CompileError（不死循环）', async () => {
    const { client, seen } = scripted(['坏', '还是坏', '依然坏', '继续坏', '一直坏'])
    await expect(compileStructured(base(client, 3))).rejects.toBeInstanceOf(CompileError)
    expect(seen).toHaveLength(3)
  })

  it('CompileError 带得出失败原因与尝试次数', async () => {
    const { client } = scripted(['这不是 JSON'])
    try {
      await compileStructured(base(client, 2))
      throw new Error('本应失败')
    } catch (error) {
      expect(error).toBeInstanceOf(CompileError)
      const compileError = error as CompileError
      expect(compileError.code).toBe('compile_failed')
      expect(compileError.attempts).toBe(2)
      expect(compileError.failure.code).toBe('no_json_found')
    }
  })

  it('默认上限是 3 次', async () => {
    const { client, seen } = scripted(['坏'])
    await expect(compileStructured(base(client))).rejects.toBeInstanceOf(CompileError)
    expect(seen).toHaveLength(DEFAULT_MAX_ATTEMPTS)
  })

  it('maxAttempts = 1 ⇒ 不重试', async () => {
    const { client, seen } = scripted(['坏'])
    await expect(compileStructured(base(client, 1))).rejects.toBeInstanceOf(CompileError)
    expect(seen).toHaveLength(1)
  })

  it('maxAttempts = 0 / 负数 ⇒ 收敛成 1 次，而不是一次都不执行', async () => {
    for (const attempts of [0, -5]) {
      const { client, seen } = scripted(['坏'])
      await expect(compileStructured(base(client, attempts))).rejects.toBeInstanceOf(CompileError)
      expect(seen).toHaveLength(1)
    }
  })

  it('validate 通过 ⇒ 直接返回，不重试', async () => {
    const { client, seen } = scripted([GOOD])
    const value = await compileStructured({ ...base(client), validate: () => null })
    expect(value).toEqual({ name: '林知远' })
    expect(seen).toHaveLength(1)
  })

  it('validate 失败 ⇒ 进入重试，且反馈来自 validate', async () => {
    const { client, seen } = scripted([GOOD, GOOD])
    let calls = 0
    const failure: ParseFailure = {
      code: 'validation_failed',
      detail: '数字无法溯源',
      feedback: '数字 40 在原文中不存在，请修正。',
    }
    await expect(
      compileStructured({
        ...base(client, 2),
        validate: () => {
          calls += 1
          return calls === 1 ? failure : null
        },
      }),
    ).resolves.toEqual({ name: '林知远' })

    expect(seen).toHaveLength(2)
    expect(seen[1]?.volatile[2]?.content).toContain('数字 40')
  })

  it('坏 JSON 永不变成半成品 —— 一组坏样本要么成功要么抛错', async () => {
    const bad = ['', '抱歉', '{"name":1}', '{"name":"a","extra":1}', '{', '[]', '{"name":"a",}']
    for (const sample of bad) {
      const { client } = scripted([sample])
      await expect(compileStructured(base(client, 2))).rejects.toBeInstanceOf(CompileError)
    }
  })

  it('编译层的出网仍经过组装层 —— 载荷与控制流都受同一套约束', async () => {
    const { client, seen } = scripted([GOOD])
    await compileStructured(base(client))
    expect(seen[0]?.cachedPrefix[0]?.content).toBe('你是解析器。')
    expect(Object.isFrozen(seen[0]?.cachedPrefix)).toBe(true)
  })
})
