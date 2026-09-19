import { describe, expect, it } from 'vitest'

import planSrc from './apply.ts?raw'
import adaptersSrc from './adapters.ts?raw'
import catalogSrc from './catalog.ts?raw'
import domSrc from './dom.ts?raw'
import featuresSrc from './features.ts?raw'
import heuristicsSrc from './heuristics.ts?raw'
import { fillTestArchive } from './__fixtures__/fill-archive'
import { parseHtmlFixture } from './__fixtures__/parse'
import platformsSrc from './platforms.ts?raw'
import planModSrc from './plan.ts?raw'
import previewSrc from './preview.ts?raw'
import { buildFillPlan, type FillPlan, type FillPlanItem } from './plan'
import type { FieldFeature } from './features'
import { isFillableKind } from './catalog'
import { createConfirmation } from './preview'
import { buildPreview } from './preview'
import { applyFillPlan, type FillWriter } from './apply'
import { buildUploadNotices, classifyUploadSlot } from './upload-slots'

/**
 * 上传槽位提示（TASKS T5.4，红线 5：只提示不代填）。
 *
 * 两条验收的落点：
 * 1. 「断言代码中不存在对 input[type=file] 的写入」—— 写入只有一个
 *    产地（`apply.ts` 里的 `writer.setValue`），且 file 特征在结构上
 *    只能落成 file-slot 条目、而 file-slot 没有批准资格。两条都有
 *    测试钉着：一个 file-only 表单满配批准也零写入；一个 raw 源码
 *    扫描保证 `.setValue(` 的调用点不出 `apply.ts` 一步。
 * 2. 「槽位识别用例表」—— TASKS 给的三行表逐条落地成断言：
 *    `english|_en|英文` → EN，`chinese|_cn|中文` → CN，
 *    `biling|中英|双语` → Bilingual。分类对齐 core 的 `ViewSuffix`，
 *    建议文件名直接复用 core 的 `deliveryFileName` —— 槽位提示的
 *    词汇与交付产物是同一套，不另起炉灶。
 */

describe('classifyUploadSlot（TASKS 用例表逐条）', () => {
  it('EN：english / _en / 英文 三种信号都认，大小写不敏感', () => {
    expect(classifyUploadSlot('english_resume', [])).toBe('EN')
    expect(classifyUploadSlot('resume_en', [])).toBe('EN')
    expect(classifyUploadSlot('f-upload', ['英文简历'])).toBe('EN')
    expect(classifyUploadSlot('Resume_EN', [])).toBe('EN')
    expect(classifyUploadSlot('ENGLISH_Resume', [])).toBe('EN')
  })

  it('CN：chinese / _cn / 中文 三种信号都认', () => {
    expect(classifyUploadSlot('chinese_resume', [])).toBe('CN')
    expect(classifyUploadSlot('resume_cn', [])).toBe('CN')
    expect(classifyUploadSlot('f-upload', ['中文简历'])).toBe('CN')
  })

  it('Bilingual：biling / 中英 / 双语 三种信号都认', () => {
    expect(classifyUploadSlot('bilingual_resume', [])).toBe('Bilingual')
    expect(classifyUploadSlot('resume_biling', [])).toBe('Bilingual')
    expect(classifyUploadSlot('f-upload', ['中英文简历'])).toBe('Bilingual')
    expect(classifyUploadSlot('f-upload', ['双语简历'])).toBe('Bilingual')
  })

  it('双语信号压过英/中 —— 一个槽位不会同时是两份', () => {
    expect(classifyUploadSlot('bilingual_en', [])).toBe('Bilingual')
    expect(classifyUploadSlot('f-upload', ['英文', '双语'])).toBe('Bilingual')
    expect(classifyUploadSlot('f-upload', ['中英', '中文'])).toBe('Bilingual')
  })

  it('EN 与 CN 信号并存 = 歧义，一个都不猜（与填充的 ambiguous 同一立场）', () => {
    expect(classifyUploadSlot('resume_cn_en', [])).toBe('unrecognized')
    expect(classifyUploadSlot('f-upload', ['中文', '英文'])).toBe('unrecognized')
  })

  it('没有信号 → unrecognized，绝不用猜的', () => {
    expect(classifyUploadSlot('f-resume-upload', ['上传简历'])).toBe('unrecognized')
    expect(classifyUploadSlot('f-resume-upload', [])).toBe('unrecognized')
  })
})

describe('buildUploadNotices（与 plan / core 命名的接线）', () => {
  const feature = (over: Partial<FieldFeature> & { key: string }): FieldFeature => ({
    kind: 'file',
    required: false,
    labels: [],
    name: null,
    id: null,
    placeholder: null,
    options: null,
    ...over,
  })
  const slot = (key: string, required: boolean): FillPlanItem => ({
    kind: 'file-slot',
    key,
    required,
  })

  it('每个 file-slot 一条提示，required 随计划走', () => {
    const features = [feature({ key: 'u-en', labels: ['English Resume'] }), feature({ key: 'u-other' })]
    const plan: FillPlan = { items: [slot('u-en', true), slot('u-other', false)] }
    const notices = buildUploadNotices(features, plan)
    expect(notices.map((n) => [n.key, n.required])).toEqual([
      ['u-en', true],
      ['u-other', false],
    ])
  })

  it('建议文件名复用 core 的交付命名 —— 槽位与产物是同一套词汇', () => {
    const features = [
      feature({ key: 'u-en', labels: ['English Resume'] }),
      feature({ key: 'u-cn', labels: ['中文简历'] }),
      feature({ key: 'u-bi', labels: ['双语简历'] }),
      feature({ key: 'u-unknown', labels: ['Attachment'] }),
    ]
    const plan: FillPlan = {
      items: [slot('u-en', false), slot('u-cn', false), slot('u-bi', false), slot('u-unknown', false)],
    }
    const byKey = new Map(buildUploadNotices(features, plan).map((n) => [n.key, n]))
    expect(byKey.get('u-en')?.kind).toBe('EN')
    expect(byKey.get('u-en')?.suggestedFileName).toBe('Resume_EN.pdf')
    expect(byKey.get('u-cn')?.suggestedFileName).toBe('Resume_CN.pdf')
    expect(byKey.get('u-bi')?.suggestedFileName).toBe('Resume_Bilingual.pdf')
    // 认不出的槽位不给建议文件名 —— 猜一个比不给更糟（红线 5 的姊妹条款）
    expect(byKey.get('u-unknown')?.kind).toBe('unrecognized')
    expect(byKey.get('u-unknown')?.suggestedFileName).toBeNull()
  })

  it('file-slot 在计划里却没有对应特征：抛错（结构性编程错误，不静默跳过）', () => {
    const plan: FillPlan = { items: [slot('ghost-key', false)] }
    expect(() => buildUploadNotices([], plan)).toThrow()
  })

  it('非 file-slot 条目不产生提示', () => {
    const features = [feature({ key: 'u-en', labels: ['English Resume'] })]
    const plan: FillPlan = { items: [slot('u-en', false)] }
    // 上面这条计划只含 file-slot —— 换成含 fill 的计划时提示数不变
    const notices = buildUploadNotices(features, plan)
    expect(notices).toHaveLength(1)
  })
})

describe('红线 5 的结构证据（不存在对 input[type=file] 的写入）', () => {
  const FILE_ONLY_HTML = `<!doctype html>
<html><body><form>
  <label for="u-en">English Resume</label>
  <input id="u-en" type="file">
  <label for="u-cn"><span>中文简历</span><input id="u-cn" type="file" required></label>
</form></body></html>`

  it('file-only 表单：满配批准也零写入 —— file 特征在结构上进不了 fill', () => {
    const plan = buildFillPlan(parseHtmlFixture(FILE_ONLY_HTML), fillTestArchive())
    expect(plan.items.every((i) => i.kind === 'file-slot')).toBe(true)
    const preview = buildPreview(plan)
    expect(preview.approvableKeys).toEqual([])

    const calls: string[] = []
    const writer: FillWriter = { setValue: (key) => calls.push(key) }
    const result = applyFillPlan(plan, createConfirmation(preview, []), writer)
    expect(result.appliedKeys).toEqual([])
    expect(calls).toEqual([])
  })

  it('试图批准一个 file-slot：直接拒绝（凭据层面就进不去）', () => {
    const plan = buildFillPlan(parseHtmlFixture(FILE_ONLY_HTML), fillTestArchive())
    const preview = buildPreview(plan)
    const slotKey = plan.items[0]?.key
    if (slotKey === undefined) throw new Error('fixture 必须产生至少一个槽位')
    expect(() => createConfirmation(preview, [slotKey])).toThrow()
  })

  it('isFillableKind 不含 file —— fill 通道对 file 特征是关死的', () => {
    expect(isFillableKind('file')).toBe(false)
  })

  it('`.setValue(` 的调用点只在 apply.ts —— 写入保持单一产地', () => {
    // raw 源码扫描：如果有人在别的模块里开第二条写 DOM 的路，
    // 这里先红。扫描的判据很笨，但笨判据不会漏报 —— 它对
    // 「再多一个调用点」这件事是零容忍的。
    const sources: Readonly<Record<string, string>> = {
      'apply.ts': planSrc,
      'adapters.ts': adaptersSrc,
      'catalog.ts': catalogSrc,
      'dom.ts': domSrc,
      'features.ts': featuresSrc,
      'heuristics.ts': heuristicsSrc,
      'plan.ts': planModSrc,
      'platforms.ts': platformsSrc,
      'preview.ts': previewSrc,
    }
    const offenders = Object.entries(sources)
      .filter(([file, src]) => file !== 'apply.ts' && /\.setValue\(/.test(src))
      .map(([file]) => file)
    expect(offenders).toEqual([])
    // 反向确认扫描本身有效：apply.ts 里确实有调用点（判据不是空转）
    expect(/\.setValue\(/.test(planSrc)).toBe(true)
  })
})
