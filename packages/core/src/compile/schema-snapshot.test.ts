import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { EXPERIENCE_SYSTEM_PROMPT } from './experience'
import { JD_SYSTEM_PROMPT } from './jd'
import {
  compiledEntrySchema,
  compiledExperienceSchema,
  compiledJdSchema,
  jdRequirementSchema,
  jdSkillSchema,
} from './schemas'

describe('编译 schema', () => {
  it('CompiledJd 形状快照', () => {
    expect(z.toJSONSchema(compiledJdSchema)).toMatchSnapshot()
  })

  it('CompiledExperience 形状快照', () => {
    expect(z.toJSONSchema(compiledExperienceSchema)).toMatchSnapshot()
  })

  it('理由粒度相关子 schema 形状快照', () => {
    expect(z.toJSONSchema(jdRequirementSchema)).toMatchSnapshot()
    expect(z.toJSONSchema(jdSkillSchema)).toMatchSnapshot()
    expect(z.toJSONSchema(compiledEntrySchema)).toMatchSnapshot()
  })

  it('全部为严格模式 —— 未知字段一律报错，不静默丢弃', () => {
    const cases: [z.ZodType, unknown][] = [
      [compiledJdSchema, { title: 'a', extra: 1 }],
      [compiledExperienceSchema, { entries: [], extra: 1 }],
      [jdSkillSchema, { name: 'a', proficiency: 'expert', required: true, evidence: 'x', extra: 1 }],
    ]
    for (const [schema, value] of cases) {
      expect(schema.safeParse(value).success).toBe(false)
    }
  })

  it('register 与 language 是可枚举的封闭集合 —— 自由文本会让下游无法分支', () => {
    const shape = z.toJSONSchema(compiledJdSchema) as {
      properties: Record<string, { enum?: string[] }>
    }
    expect(shape.properties.register?.enum).toEqual(['formal', 'technical', 'business', 'casual'])
    expect(shape.properties.language?.enum).toEqual(['zh', 'en', 'mixed'])
  })

  it('**prompt 里嵌的 schema 形状与当前 schema 一致** —— 两处漂移在结构上不可能', () => {
    const jdShape = JSON.stringify(z.toJSONSchema(compiledJdSchema), null, 2)
    const experienceShape = JSON.stringify(z.toJSONSchema(compiledExperienceSchema), null, 2)
    expect(JD_SYSTEM_PROMPT).toContain(jdShape)
    expect(EXPERIENCE_SYSTEM_PROMPT).toContain(experienceShape)
  })

  it('prompt 明确要求逐字保留 sourceText —— 这是溯源链的起点', () => {
    expect(EXPERIENCE_SYSTEM_PROMPT).toContain('逐字复制')
    expect(EXPERIENCE_SYSTEM_PROMPT).toContain('sourceText')
  })

  it('prompt 里说明了 strict 与 proficiency 的判据，而不只是字段名', () => {
    expect(JD_SYSTEM_PROMPT).toContain('优先')
    expect(JD_SYSTEM_PROMPT).toContain('expert')
  })
})
