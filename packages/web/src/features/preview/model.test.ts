// @vitest-environment node
/**
 * T8.3 预览模型 —— 档案 → 简历 HTML + 自述文本。
 *
 * ## 零 DOM，所以跑 node（同 vault-session 的理由）
 *
 * `buildDeliveryPackage` / `buildIntroViews` 都是 core 的纯函数；
 * 预览模型的职责只是**取材合法**：页面上的每个字都要能溯源到档案，
 * 占位符（「TODO」「undefined」「NaN」）一旦出现在渲染产物里就是事故。
 * React 组件怎么画是另一层（jsdom 组件测试的事），这里钉数据。
 */

import { describe, expect, it } from 'vitest'

import { archiveV1Schema } from '../../../../core/src/schema/index'
import { buildPreviewModel } from './model'

function sample() {
  return archiveV1Schema.parse({
    schemaVersion: 1,
    basics: {
      name: { zh: '张三' },
      location: { city: '成都' },
      contact: { phone: '13800138000', email: 'zhang@example.com' },
    },
    work: [
      {
        company: '成都某某科技有限公司',
        position: { zh: '算法工程实习生' },
        startDate: '2025-06',
        endDate: '2025-09',
        highlights: ['推荐系统排序优化，离线 AUC 提升 3.2%'],
      },
    ],
  })
}

describe('T8.3 预览模型 —— 每个字都溯源到档案', () => {
  it('双语 HTML 含档案事实（姓名 / 城市 / 经历要点）；两视图语言标记各归其位', () => {
    const preview = buildPreviewModel(sample())
    expect(preview.cnHtml).toContain('张三')
    expect(preview.cnHtml).toContain('成都')
    expect(preview.cnHtml).toContain('3.2%')
    // 经历要点（含数字）原样在页面上 —— 这是可解释性的最低要求
    // 语言标记钉死两个视图的归属（html lang 属性由渲染层产出）
    expect(preview.cnHtml).toContain('lang="zh-CN"')
    expect(preview.enHtml).toContain('lang="en"')
    expect(preview.enHtml).not.toContain('lang="zh-CN"')
  })

  it('渲染产物里没有占位符类事故文本', () => {
    const preview = buildPreviewModel(sample())
    for (const html of [preview.cnHtml, preview.enHtml]) {
      expect(html).not.toContain('undefined')
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('TODO')
      expect(html).not.toContain('[object')
    }
  })

  it('自述文本非空且带档位信息；同一档案两次构建逐字节一致（确定性）', () => {
    const preview = buildPreviewModel(sample())
    expect(preview.intros.length).toBeGreaterThan(0)
    for (const intro of preview.intros) {
      expect(intro.text.length).toBeGreaterThan(0)
      expect(intro.skipped.every((s) => s.reason !== undefined)).toBe(true)
    }
    const again = buildPreviewModel(sample())
    expect(again.cnHtml).toBe(preview.cnHtml)
    expect(again.enHtml).toBe(preview.enHtml)
    expect(again.intros.map((v) => v.text)).toEqual(preview.intros.map((v) => v.text))
  })
})
