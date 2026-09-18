import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { extractJsonCandidate, parseStructured } from './parse'

const schema = z.strictObject({ name: z.string(), count: z.number() })
const GOOD = '{"name":"a","count":1}'

describe('JSON 候选提取', () => {
  it('纯 JSON 原样通过', () => {
    expect(extractJsonCandidate(GOOD)).toBe(GOOD)
  })

  it('剥掉 markdown 代码围栏', () => {
    expect(extractJsonCandidate('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJsonCandidate('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('前后带解释文字时取花括号区间', () => {
    expect(extractJsonCandidate('好的，结果是：{"a":1} 希望对你有帮助')).toBe('{"a":1}')
  })

  it('剥掉 BOM', () => {
    expect(extractJsonCandidate('\uFEFF{"a":1}')).toBe('{"a":1}')
  })

  it('找不到 JSON 时返回 null', () => {
    expect(extractJsonCandidate('我无法完成这个任务。')).toBeNull()
    expect(extractJsonCandidate('   ')).toBeNull()
    expect(extractJsonCandidate('}{')).toBeNull()
  })
})

describe('结构化解析闸门', () => {
  it('合法输入 ⇒ ok', () => {
    const result = parseStructured(GOOD, schema)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ name: 'a', count: 1 })
  })

  it('空回复 ⇒ empty_response', () => {
    const result = parseStructured('   ', schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('empty_response')
  })

  it('没有 JSON ⇒ no_json_found', () => {
    const result = parseStructured('抱歉，我需要更多信息。', schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('no_json_found')
  })

  it('JSON 语法错误 ⇒ invalid_json，且不尝试修复', () => {
    const result = parseStructured('{"name":"a","count":1,}', schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('invalid_json')
  })

  it('缺字段 ⇒ schema_mismatch，且指出路径', () => {
    const result = parseStructured('{"name":"a"}', schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.code).toBe('schema_mismatch')
      expect(result.failure.detail).toContain('count')
    }
  })

  it('**多**字段也报错 —— strict 模式，未知字段没有级别', () => {
    const result = parseStructured('{"name":"a","count":1,"contacts_backup":"x"}', schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('schema_mismatch')
  })

  it('类型不符 ⇒ schema_mismatch', () => {
    const result = parseStructured('{"name":123,"count":"1"}', schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('schema_mismatch')
  })

  it('数组不当作对象接受', () => {
    const result = parseStructured('[{"name":"a","count":1}]', schema)
    expect(result.ok).toBe(false)
  })

  it('feedback 让模型知道错在哪个字段（否则它只会换个说法再错一次）', () => {
    const result = parseStructured('{"name":"a"}', schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.feedback).toContain('count')
  })

  it('feedback 不包含模型原文 —— 重试提示不能变成数据回灌通道', () => {
    const leaky = '{"name":"13800138000","count":"x"}'
    const result = parseStructured(leaky, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.feedback).not.toContain('13800138000')
      expect(result.failure.feedback).not.toContain(leaky)
    }
  })

  it('解析器永不抛错 —— 失败是返回值', () => {
    for (const input of ['', '{', 'null', '真', '```\n```', '{}']) {
      expect(() => parseStructured(input, schema)).not.toThrow()
    }
  })
})
