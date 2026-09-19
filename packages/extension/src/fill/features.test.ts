import { describe, expect, it } from 'vitest'

import { parseHtmlFixture } from './__fixtures__/parse'
import { GENERIC_FORM_HTML } from './__fixtures__/form-html'
import { extractFieldFeatures } from './features'

/**
 * 页面特征提取 —— 内容脚本的第一段（DESIGN 3.4）。
 *
 * 判据对着保存的 HTML fixture 跑，不依赖真实站点（TASKS T5.1）。
 * 特征提取只回答「页面上有什么字段、每个字段有哪些文案线索」，
 * 「该填什么」是 plan 层的事 —— 两件事分开，才各自可断言。
 */
describe('extractFieldFeatures（generic form）', () => {
  const doc = parseHtmlFixture(GENERIC_FORM_HTML)
  const features = extractFieldFeatures(doc)
  const byKey = new Map(features.map((f) => [f.key, f]))

  it('输入控件齐全：hidden 与 submit 被排除，checkbox/file 保留待后续分层', () => {
    // 表单里写了 22 个 input/select/textarea：20 个可见字段
    // + 1 个 hidden（csrf）+ 1 个 submit（button 不算）。
    // hidden 不是用户要填的东西，提取阶段就该丢掉 —— 留着它，
    // plan 层就多一条「永远不会填的缺口」，噪音里藏真缺口。
    expect(features).toHaveLength(20)
  })

  it('key 唯一 —— ground truth 断言靠它寻址', () => {
    const keys = features.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('label[for] 关联 + 标签中的 * 识别必填（`*` 保留在文案里，匹配时再剥）', () => {
    const name = byKey.get('f-name')
    expect(name).toBeDefined()
    expect(name?.kind).toBe('text')
    expect(name?.labels).toEqual(['姓名 *'])
    expect(name?.required).toBe(true)
  })

  it('input type 推断字段类型：tel / email / date / month', () => {
    expect(byKey.get('f-phone')?.kind).toBe('tel')
    expect(byKey.get('f-email')?.kind).toBe('email')
    expect(byKey.get('f-birth')?.kind).toBe('date')
    expect(byKey.get('f-graduate')?.kind).toBe('month')
  })

  it('select 的选项提取：value 与文本分开存 —— 匹配用文本，回填用 value', () => {
    const gender = byKey.get('f-gender')
    expect(gender?.kind).toBe('select')
    expect(gender?.options).toEqual([
      { value: '', text: '请选择' },
      { value: 'M', text: '男' },
      { value: 'F', text: '女' },
    ])
  })

  it('required 属性是必填的第二种来源（captcha 没写 *）', () => {
    expect(byKey.get('f-captcha')?.required).toBe(true)
    // 对照组：城市下拉没有 required，也没有 *
    expect(byKey.get('f-city')?.required).toBe(false)
  })

  it('aria-label 是文案线索的合法来源（f-intent 没有 label 标签）', () => {
    const intent = byKey.get('f-intent')
    expect(intent?.labels).toContain('求职意向')
    expect(intent?.labels).not.toContain('求职意向X') // 防「测试在数数组长度」的假断言
  })

  it('placeholder 被采集为独立线索', () => {
    expect(byKey.get('f-major')?.placeholder).toBe('如：计算机科学与技术')
  })

  it('file 与 checkbox 保留在特征里 —— 排除是 plan 层的决策，不是提取层的遗忘', () => {
    expect(byKey.get('f-resume-upload')?.kind).toBe('file')
    expect(byKey.get('agreement')?.kind).toBe('checkbox')
  })
})
