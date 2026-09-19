// @vitest-environment node
/**
 * T8.4 导出交付 —— 文件名走 core 的 `deliveryFileName`，内容可溯源。
 *
 * ## PDF 渲染是注入的，不是直调的
 *
 * `renderViewToBlob`（features/delivery）依赖 @react-pdf/renderer 与
 * 字体资源 —— 那是浏览器的事。本模块只负责「交付哪些文件、文件名
 * 是什么、内容从哪来」：注入 `renderPdf` 接缝后，纯逻辑可以在 node
 * 里验，UI 接线时把真渲染器递进来即可（与 T7.4 保存胶水同一形状）。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  DELIVERY_FILE_NAME_PATTERN,
  deliveryFileName,
  DEFAULT_FILE_STEM,
} from '../../../../core/src/render/index'
import { archiveV1Schema } from '../../../../core/src/schema/index'
import { buildPreviewModel } from './model'
import { deliverAll } from './deliver'

function sample() {
  return archiveV1Schema.parse({
    schemaVersion: 1,
    basics: {
      name: { zh: '张三' },
      location: { city: '成都' },
      contact: { phone: '13800138000', email: 'zhang@example.com' },
    },
  })
}

describe('T8.4 导出交付 —— 文件名与内容', () => {
  it('交付 4 个文件：两份 PDF（名字过交付文件名模式）+ 两份自述文本（内容 = 预览的自述）', async () => {
    const sink = vi.fn<(name: string, content: string | Blob) => void>()
    const renderPdf = vi.fn<(html: string) => Promise<Blob>>().mockResolvedValue(new Blob(['pdf']))
    const delivered = await deliverAll(sample(), sink, renderPdf)

    expect(delivered).toHaveLength(4)
    // PDF 文件名必须出自 core 的 deliveryFileName（单一产地，不许这里手拼）
    expect(delivered).toContain(deliveryFileName(DEFAULT_FILE_STEM, 'CN'))
    expect(delivered).toContain(deliveryFileName(DEFAULT_FILE_STEM, 'EN'))
    for (const name of delivered) {
      if (name.endsWith('.pdf')) expect(name).toMatch(DELIVERY_FILE_NAME_PATTERN)
    }
    // renderPdf 收到的是预览 HTML（同一产地 buildDeliveryPackage）
    expect(renderPdf).toHaveBeenCalledTimes(2)

    const introFiles = delivered.filter((n) => n.endsWith('.txt'))
    expect(introFiles).toHaveLength(2)
    const preview = buildPreviewModel(sample())
    const introTexts = preview.intros.map((v) => v.text)
    for (const [, content] of sink.mock.calls.filter(([n]) => n.endsWith('.txt'))) {
      expect(introTexts).toContain(content)
    }
  })

  it('PDF 渲染失败 → 整次交付上抛，不让「下了一半」看起来像成功', async () => {
    const sink = vi.fn<(name: string, content: string | Blob) => void>()
    // 第一次渲染就失败：失败即停，后续文件一个都不许写
    const renderPdf = vi.fn<(html: string) => Promise<Blob>>().mockRejectedValueOnce(new Error('字体缺失'))
    await expect(deliverAll(sample(), sink, renderPdf)).rejects.toThrow('字体缺失')
    expect(sink).not.toHaveBeenCalled()
  })
})
