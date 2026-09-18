import { describe, expect, it } from 'vitest'

import { archiveV1Schema } from './archive'
import { CURRENT_SCHEMA_VERSION, MigrationError, migrateArchive } from './migrate'
import { fieldPolicyFor } from './policy'
import { maximalArchiveV1 } from './__fixtures__/maximal-archive'
import archiveV0Sample from './__fixtures__/archive-v0.sample.json'

/**
 * 历史版本样例来自 `__fixtures__/archive-v0.sample.json`：
 * 单语言、扁平结构、无 schemaVersion / customFields —— 即项目最早期的存档形态。
 * 其中姓名、身份证号、手机号均为虚构值。
 */
const v0 = archiveV0Sample

describe('迁移 · v0 → v1', () => {
  it('迁移结果通过 v1 schema 校验', () => {
    expect(() => archiveV1Schema.parse(migrateArchive(v0))).not.toThrow()
  })

  it('写入 schemaVersion = 1', () => {
    expect(migrateArchive(v0).schemaVersion).toBe(1)
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
  })

  it('单语言字符串落到 i18n 的中文槽位', () => {
    const result = migrateArchive(v0)
    expect(result.basics.name?.zh).toBe('林知远')
    expect(result.basics.label?.zh).toBe('算法工程师')
    expect(result.basics.summary?.zh).toBe(
      '计算机科学与技术专业本科应届生，专注推荐系统与特征工程。',
    )
  })

  it('迁移绝不编造英文 —— en 留空，由缺口闭环在生成时提示用户补充', () => {
    const result = migrateArchive(v0)
    expect(result.basics.name?.en).toBeUndefined()
    expect(result.basics.label?.en).toBeUndefined()
    expect(result.work[0]?.position.en).toBeUndefined()
    expect(result.education[0]?.area?.en).toBeUndefined()
    // 整份迁移结果里不应出现任何 en 槽位有值的情况
    expect(JSON.stringify(result)).not.toMatch(/"en":"/)
  })

  it('联系方式落到 B 级位置', () => {
    const result = migrateArchive(v0)
    expect(result.basics.contact.phone).toBe('13800138000')
    expect(result.basics.contact.email).toBe('linzhiyuan@example.com')
    expect(fieldPolicyFor('basics.contact.phone')?.level).toBe('B')
    expect(fieldPolicyFor('basics.contact.phone')?.neverSendToLLM).toBe(true)
  })

  it('身份与籍贯信息落到 B 级位置', () => {
    const result = migrateArchive(v0)
    expect(result.basics.identity).toEqual({
      idNumber: '330106200205140011',
      politicalStatus: '共青团员',
      nativePlace: '浙江宁波',
      birthDate: '2002-05-14',
      gender: '男',
    })
    expect(fieldPolicyFor('basics.identity.idNumber')?.level).toBe('B')
  })

  it('城市落到 location，个人网站与 GitHub 分别落到 url 与 profiles', () => {
    const result = migrateArchive(v0)
    expect(result.basics.location?.city).toBe('杭州')
    expect(result.basics.url).toBe('https://linzhiyuan.dev')
    expect(result.basics.profiles).toEqual([
      {
        network: 'GitHub',
        username: 'linzhiyuan',
        url: 'https://github.com/linzhiyuan',
      },
    ])
  })

  it('experiences → work，role → position.zh，bullets → highlights（内容逐字保留）', () => {
    const result = migrateArchive(v0)
    expect(result.work).toHaveLength(1)
    const job = result.work[0]
    expect(job?.company).toBe('杭州某某科技有限公司')
    expect(job?.position.zh).toBe('算法工程实习生')
    expect(job?.startDate).toBe('2025-06')
    expect(job?.endDate).toBe('2025-09')
    expect(job?.location).toBe('杭州')
    expect(job?.highlights).toEqual([
      '负责召回通道的特征工程，累计上线 12 个特征',
      '将离线特征回填耗时从 4.2 小时降至 38 分钟',
    ])
  })

  it('迁移不得丢内容：v0 里每条 bullet 都必须逐字出现在结果中', () => {
    const result = migrateArchive(v0)
    const allHighlights = [
      ...result.work.flatMap((w) => w.highlights),
      ...result.education.flatMap((e) => e.highlights ?? []),
      ...result.projects.flatMap((p) => p.highlights),
    ]
    for (const source of v0.experiences) {
      for (const bullet of source.bullets) {
        expect(allHighlights).toContain(bullet)
      }
    }
  })

  it('educations → education，school / major / degree 各自映射', () => {
    const result = migrateArchive(v0)
    expect(result.education).toHaveLength(1)
    const edu = result.education[0]
    expect(edu?.institution).toBe('某某大学')
    expect(edu?.area?.zh).toBe('计算机科学与技术')
    expect(edu?.studyType?.zh).toBe('本科')
    expect(edu?.startDate).toBe('2022-09')
    expect(edu?.endDate).toBe('2026-06')
    expect(edu?.gpa).toBe('3.7/4.0')
    expect(edu?.highlights).toEqual(['专业排名前 8%'])
  })

  it('字符串数组形式的 skills 升级为对象数组', () => {
    const result = migrateArchive(v0)
    expect(result.skills).toHaveLength(4)
    expect(result.skills[0]?.name.zh).toBe('Python')
    expect(result.skills.map((s) => s.name.zh)).toEqual(['Python', 'PyTorch', 'Spark', 'SQL'])
  })

  it('projects / certificates / awards 结构升级但内容不变', () => {
    const result = migrateArchive(v0)
    expect(result.projects[0]?.name.zh).toBe('校园二手交易推荐系统')
    expect(result.projects[0]?.highlights).toEqual(['召回率相比热门榜提升 27%'])
    expect(result.projects[0]?.keywords).toEqual([])
    expect(result.certificates[0]?.name.zh).toBe('全国大学英语六级考试')
    expect(result.certificates[0]?.score).toBe('562')
    expect(result.awards[0]?.title.zh).toBe('全国大学生数学建模竞赛省级二等奖')
    expect(result.awards[0]?.awarder).toBe('浙江省教育厅')
  })

  it('补齐 customFields 空槽位', () => {
    expect(migrateArchive(v0).customFields).toEqual({})
  })
})

describe('迁移 · 边界与幂等', () => {
  it('已是 v1 的档案原样通过（幂等）', () => {
    expect(migrateArchive(maximalArchiveV1)).toEqual(maximalArchiveV1)
  })

  it('迁移两次与迁移一次结果相同', () => {
    const once = migrateArchive(v0)
    expect(migrateArchive(once)).toEqual(once)
  })

  it('未知版本抛 MigrationError，不猜也不静默丢弃', () => {
    expect(() => migrateArchive({ schemaVersion: 99 })).toThrow(MigrationError)
    expect(() => migrateArchive({ version: 42 })).toThrow(MigrationError)
  })

  it('既无 version 也无 schemaVersion 抛 MigrationError', () => {
    expect(() => migrateArchive({ name: '无版本号' })).toThrow(MigrationError)
  })

  it('非对象输入抛 MigrationError', () => {
    expect(() => migrateArchive('字符串')).toThrow(MigrationError)
    expect(() => migrateArchive(null)).toThrow(MigrationError)
  })

  it('v0 数据缺必需字段时抛 MigrationError，而不是产出半份档案', () => {
    const broken = { ...v0, experiences: [{ company: '只有公司名' }] }
    expect(() => migrateArchive(broken)).toThrow(MigrationError)
  })
})
