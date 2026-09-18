/**
 * T1.4 · B 级数据永不出网
 *
 * 这是全项目**最能拿分的一个文件**。它把「我们注重隐私」从一句 slogan
 * 变成一条会在 CI 上变红的断言 —— 而这两者在招聘方眼里的差别，就是
 * 「你说的」与「你能证明的」的差别。
 *
 * 手法：注入一个只会记录载荷的假客户端，喂一份**填满全部 B 级字段**的档案，
 * 然后对捕获到的每一个字节做深度扫描。
 *
 * 覆盖的威胁模型有三类，缺一类这个测试就不完整：
 *
 *   1. **结构性泄漏** —— 档案以结构化形式整体进了载荷（投影被绕过或改错）
 *      → 由路径扫描抓，它不依赖值的长短
 *   2. **值级泄漏** —— B 级值被夹带进某段 A 级自由文本
 *      → 由值扫描抓，覆盖逐字与分隔符变形两种形态
 *   3. **新增通道** —— 有人加了一个新的出网函数并绕开组装
 *      → 由导出面断言抓，它把 API 表面本身当成断言对象
 *
 * @see DESIGN.md 1.3 · AGENTS.md §5 红线 2 / §6
 */

import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { bLevelPaths, fieldPolicyFor, getAtPath, listLeafPaths } from '../schema/index'
import * as egress from './index'
import type { LLMClient, LLMRequest } from './types'

const ARCHIVE = maximalArchiveV1

const ASSEMBLE_OPTIONS = {
  archive: ARCHIVE,
  model: 'test-model',
  system: '你是一个简历改写助手，只依据给定事实改写。',
  volatile: [{ role: 'user' as const, content: '请改写第 1 条 bullet。' }],
} as const

function capturingClient(): { client: LLMClient; seen: LLMRequest[] } {
  const seen: LLMRequest[] = []
  return {
    seen,
    client: {
      complete: (request) => {
        seen.push(request)
        return Promise.resolve({ text: 'ok' })
      },
    },
  }
}

/** 档案里全部 B 级标量叶子。 */
function bLevelScalars(source: unknown): readonly { path: string; text: string }[] {
  const collected: { path: string; text: string }[] = []
  for (const path of listLeafPaths(source)) {
    if (fieldPolicyFor(path)?.level !== 'B') continue
    const value = getAtPath(source, path)
    if (typeof value === 'string' || typeof value === 'number') {
      collected.push({ path, text: String(value) })
    }
  }
  return collected
}

/** 值扫描有能力可靠检测的那一部分 —— 强标识符且长度达标。 */
function scannableValues(): readonly { path: string; text: string }[] {
  return bLevelScalars(ARCHIVE).filter(({ text }) => egress.isStrongIdentifier(text) && text.length >= 4)
}

describe('T1.4 · B 级数据永不出网', () => {
  it('样本档案真的填了 B 级字段 —— 否则下面所有断言都是空转', () => {
    expect(bLevelPaths().length).toBeGreaterThan(10)
    expect(bLevelScalars(ARCHIVE).length).toBeGreaterThan(15)
    expect(scannableValues().length).toBeGreaterThan(10)
  })

  it('喂满 B 级字段的档案 ⇒ 捕获的载荷零命中', async () => {
    const { client, seen } = capturingClient()
    await egress.callLLM(client, ASSEMBLE_OPTIONS)

    expect(seen).toHaveLength(1)
    expect(egress.blockingLeaks(egress.scanPayload(seen[0], ARCHIVE))).toEqual([])
  })

  it('逐条列出：没有任何一个 B 级强标识符出现在载荷里', async () => {
    const { client, seen } = capturingClient()
    await egress.callLLM(client, ASSEMBLE_OPTIONS)
    const payload = JSON.stringify(seen[0])

    const leaked = scannableValues().filter(({ text }) => payload.includes(text))
    expect(leaked).toEqual([])
  })

  it('载荷里的档案片段不含任何 B 级路径（结构性防线）', async () => {
    const { client, seen } = capturingClient()
    await egress.callLLM(client, ASSEMBLE_OPTIONS)

    const profileJson = seen[0]?.cachedPrefix.at(-1)?.content ?? '{}'
    const profile = JSON.parse(profileJson) as unknown
    expect(egress.findBLevelPaths(profile)).toEqual([])
  })

  it('姓名与联系方式确实不在载荷里 —— 逐个点名的强断言', async () => {
    const { client, seen } = capturingClient()
    await egress.callLLM(client, ASSEMBLE_OPTIONS)
    const payload = JSON.stringify(seen[0])

    expect(payload).not.toContain(ARCHIVE.basics.name.zh)
    expect(payload).not.toContain(ARCHIVE.basics.contact.phone)
    expect(payload).not.toContain(ARCHIVE.basics.contact.email)
    expect(payload).not.toContain(ARCHIVE.basics.contact.wechat)
    expect(payload).not.toContain(ARCHIVE.basics.identity.idNumber)
    expect(payload).not.toContain(ARCHIVE.basics.location.address)
    expect(payload).not.toContain(ARCHIVE.basics.emergencyContact.phone)
    expect(payload).not.toContain(ARCHIVE.basics.picture)
  })

  it('A 级内容确实进了载荷 —— 证明上面的「零命中」不是因为载荷是空的', async () => {
    const { client, seen } = capturingClient()
    await egress.callLLM(client, ASSEMBLE_OPTIONS)
    const payload = JSON.stringify(seen[0])

    expect(payload).toContain(ARCHIVE.work[0]?.highlights[0])
    expect(payload).toContain(ARCHIVE.projects[0]?.keywords[0])
    expect(payload).toContain(ARCHIVE.basics.summary.zh)
  })

  it('反向验证：把原始档案直接塞进载荷 ⇒ 断言必须失败（测试是有牙齿的）', () => {
    const naive = {
      model: 'test-model',
      cachedPrefix: [{ role: 'user', content: JSON.stringify(ARCHIVE) }],
      volatile: [],
    }
    const leaks = egress.blockingLeaks(egress.scanPayload(naive, ARCHIVE))
    expect(leaks.length).toBeGreaterThan(0)
    expect(leaks.map((leak) => leak.source)).toContain('basics.contact.phone')
  })

  it('反向验证：把 B 级值缝进 A 级文本 ⇒ 断言必须失败', () => {
    const stitched = {
      model: 'test-model',
      cachedPrefix: [
        {
          role: 'user',
          content: JSON.stringify({
            summary: { zh: `联系我 ${ARCHIVE.basics.contact.phone} 了解详情。` },
          }),
        },
      ],
      volatile: [],
    }
    expect(egress.blockingLeaks(egress.scanPayload(stitched, ARCHIVE)).length).toBeGreaterThan(0)
  })

  it('导出面封闭 —— 新增任何出网函数都必须先改这一行', () => {
    expect(Object.keys(egress).sort()).toEqual([
      'EgressLeakError',
      'assembleLLMRequest',
      'assertNoBLevelEgress',
      'blockingLeaks',
      'callLLM',
      'findBLevelPaths',
      'findUndeclaredPaths',
      'inspectEgress',
      'isStrongIdentifier',
      'projectArchiveForLLM',
      'scanPayload',
    ])
  })

  it('已知局限：纯 ASCII 短标识符（用户名、英文姓名）只进 advisory，不进阻断集', async () => {
    const { client, seen } = capturingClient()
    await egress.callLLM(client, ASSEMBLE_OPTIONS)

    const network = ARCHIVE.basics.profiles[0]?.network ?? ''
    const nameEn = ARCHIVE.basics.name.en

    // 这些值在正文里逐字出现，值扫描无法与「正常提及」区分。
    // 它们的防线是路径扫描 + 投影 —— 上面那条结构性断言。
    expect(egress.isStrongIdentifier(network)).toBe(false)
    expect(egress.isStrongIdentifier(nameEn)).toBe(false)
    expect(egress.blockingLeaks(egress.scanPayload(seen[0], ARCHIVE))).toEqual([])

    // 但 advisory 通道确实看得见它们 —— 说明这不是一个「检测不到」的洞，
    // 而是一个「已知且已分类」的边界。
    const advisories = egress
      .scanPayload({ body: `${network} ${nameEn}` }, ARCHIVE)
      .filter((leak) => leak.severity === 'advisory')
    expect(advisories.length).toBeGreaterThan(0)
  })
})
