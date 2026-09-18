import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from './__fixtures__/maximal-archive'
import {
  aLevelPaths,
  bLevelPaths,
  fieldPolicies,
  fieldPolicyFor,
  getAtPath,
  listLeafPaths,
} from './policy'

/**
 * B 级路径快照。
 *
 * 这是本文件里最重要的一条断言：**任何人调整某个字段的分级，都会让这条测试失败。**
 * 不是靠 code review 发现「有人把手机号改成 A 级了」，而是靠 CI 直接拦住。
 */
const EXPECTED_B_LEVEL_PATHS = [
  'basics.contact',
  'basics.desiredSalary',
  'basics.emergencyContact',
  'basics.family',
  'basics.health',
  'basics.identity',
  'basics.location',
  'basics.name',
  'basics.picture',
  'basics.profiles',
  'basics.url',
  'customFields',
]

const EXPECTED_A_LEVEL_PATHS = [
  'awards',
  'basics.label',
  'basics.summary',
  'certificates',
  'education',
  'languages',
  'projects',
  'schemaVersion',
  'skills',
  'work',
]

describe('A / B 分级策略表', () => {
  it('neverSendToLLM 由 level 唯一决定，B 级恒为 true', () => {
    for (const policy of fieldPolicies()) {
      expect(policy.neverSendToLLM, `${policy.path} 的 neverSendToLLM 与 level 不一致`).toBe(
        policy.level === 'B',
      )
    }
  })

  it('路径唯一，无重复声明', () => {
    const paths = fieldPolicies().map((p) => p.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('策略总数为 22，A / B 两级之和等于总数', () => {
    expect(fieldPolicies()).toHaveLength(22)
    expect(aLevelPaths().length + bLevelPaths().length).toBe(22)
  })

  it('B 级路径快照 —— 改动任何字段的分级都会让这条失败', () => {
    expect([...bLevelPaths()]).toEqual(EXPECTED_B_LEVEL_PATHS)
  })

  it('A 级路径快照', () => {
    expect([...aLevelPaths()]).toEqual(EXPECTED_A_LEVEL_PATHS)
  })

  it('A 级与 B 级不相交', () => {
    const a = new Set(aLevelPaths())
    for (const path of bLevelPaths()) {
      expect(a.has(path), `${path} 同时出现在 A 级和 B 级`).toBe(false)
    }
  })

  it('customFields 默认 B 级 —— 语义未知的字段不得默认出端', () => {
    const policy = fieldPolicyFor('customFields')
    expect(policy).toBeDefined()
    expect(policy?.level).toBe('B')
    // 用户自定义字段的子键同样落在 customFields 这条策略下
    expect(fieldPolicyFor('customFields.drivingLicense')?.level).toBe('B')
  })

  it('身份与联系类字段全部为 B 级', () => {
    const mustBeB = [
      'basics.name',
      'basics.contact.email',
      'basics.contact.phone',
      'basics.location.address',
      'basics.identity.idNumber',
      'basics.emergencyContact.phone',
      'basics.picture',
    ]
    for (const path of mustBeB) {
      expect(fieldPolicyFor(path)?.level, `${path} 必须是 B 级`).toBe('B')
    }
  })

  it('经历与能力叙事类字段全部为 A 级', () => {
    const mustBeA = [
      'basics.label',
      'basics.summary',
      'work.0.company',
      'work.0.highlights.1',
      'education.0.institution',
      'projects.0.name',
      'skills.0.keywords.0',
      'languages.0.score',
      'awards.0.title',
    ]
    for (const path of mustBeA) {
      expect(fieldPolicyFor(path)?.level, `${path} 必须是 A 级`).toBe('A')
    }
  })

  it('fieldPolicyFor 按最长前缀匹配，数组下标不参与匹配', () => {
    expect(fieldPolicyFor('work.0.highlights.1')?.path).toBe('work')
    expect(fieldPolicyFor('basics.contact.phone')?.path).toBe('basics.contact')
    expect(fieldPolicyFor('basics')?.path).toBeUndefined()
    expect(fieldPolicyFor('nope.nope')).toBeUndefined()
  })

  it('策略表与真实档案双向覆盖（漏标字段 / 幽灵字段都会在这里暴露）', () => {
    for (const leafPath of listLeafPaths(maximalArchiveV1)) {
      expect(fieldPolicyFor(leafPath), `叶子路径 ${leafPath} 没有任何策略覆盖`).toBeDefined()
    }
    for (const policy of fieldPolicies()) {
      expect(
        getAtPath(maximalArchiveV1, policy.path),
        `策略路径 ${policy.path} 在档案样本中不存在（幽灵字段）`,
      ).toBeDefined()
    }
  })
})
