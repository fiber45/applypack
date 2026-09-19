import { beforeEach, describe, expect, it } from 'vitest'
import manifestRaw from '../../public/manifest.json?raw'
import { resetPlatformAdaptersForTests } from '../fill/adapters'
import { registerBuiltinPlatformAdapters } from '../fill/platforms'
import { GENERIC_FORM_HTML } from '../fill/__fixtures__/form-html'
import { parseHtmlFixture } from '../fill/__fixtures__/parse'
import { BEISEN_SNAPSHOT_HTML } from '../fill/__fixtures__/snapshot-beisen'
import { boot } from './entry'
import { scanPage } from './scan'

describe('T7.1 manifest 结构 —— 隐私主张从清单开始', () => {
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>

  it('MV3 + 内容脚本指向构建产物，document_idle 装载', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.content_scripts).toEqual([
      { matches: ['<all_urls>'], js: ['content-script.js'], run_at: 'document_idle' },
    ])
  })

  it('无 permissions / host_permissions / background 键 —— 无 API 权限、无后台常驻进程', () => {
    // 结构性证明：清单里没有可申请的 API 权限，也没有 service worker。
    // 「数据不出浏览器」的第一半钉在这里（扩展侧），第二半在 web 包的 CSP。
    // 未来任何想加权限的改动，都要先改掉这条断言 —— 那是有意的门槛。
    expect('permissions' in manifest).toBe(false)
    expect('host_permissions' in manifest).toBe(false)
    expect('background' in manifest).toBe(false)
  })
})

describe('T7.1 scanPage —— 内容脚本与引擎之间那条缝', () => {
  beforeEach(() => {
    resetPlatformAdaptersForTests()
    registerBuiltinPlatformAdapters()
  })

  it('北森快照：检出适配器、特征数 > 0、版本对齐', () => {
    const scan = scanPage(parseHtmlFixture(BEISEN_SNAPSHOT_HTML))
    expect(scan.platform).toBe('beisen')
    expect(scan.pageVersion).toBe('1')
    expect(scan.adapterVersion).toBe('1')
    expect(scan.staleAdapter).toBe(false)
    expect(scan.featureCount).toBeGreaterThan(0)
  })

  it('页面自申报版本 ≠ 适配器版本 → staleAdapter（平台改版的第一现场，扫描层可见）', () => {
    const drifted = BEISEN_SNAPSHOT_HTML.replace(
      'data-platform-version="1"',
      'data-platform-version="2"',
    )
    const scan = scanPage(parseHtmlFixture(drifted))
    expect(scan.platform).toBe('beisen')
    expect(scan.pageVersion).toBe('2')
    expect(scan.adapterVersion).toBe('1')
    expect(scan.staleAdapter).toBe(true)
  })

  it('未知表单：platform null、不报版本（T7.2 起走启发式兜底）', () => {
    const scan = scanPage(parseHtmlFixture(GENERIC_FORM_HTML))
    expect(scan.platform).toBeNull()
    expect(scan.pageVersion).toBeNull()
    expect(scan.adapterVersion).toBeNull()
    expect(scan.staleAdapter).toBe(false)
  })
})

describe('T7.1 boot —— 入口接线', () => {
  it('默认注册路径：注册表清空后 boot 一次即检出（证明入口自己会注册内置适配器）', () => {
    resetPlatformAdaptersForTests()
    const scan = boot(parseHtmlFixture(BEISEN_SNAPSHOT_HTML))
    expect(scan.platform).toBe('beisen')
  })

  it('非 Document 形状 → asDomDocument 正控守卫抛 TypeError（不是等到三层后的 undefined）', () => {
    // 注册表先清空：boot 先注册再验形状，别让重复注册的错抢在守卫前面
    resetPlatformAdaptersForTests()
    expect(() => boot({})).toThrow(TypeError)
  })
})
