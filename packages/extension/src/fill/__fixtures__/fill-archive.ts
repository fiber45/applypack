import { archiveV1Schema, type ArchiveV1 } from '../../../../core/src/schema/index'

/**
 * 填充测试用的档案 —— 与 core 的 `maximal-archive` 刻意不同源：
 * 那份服务于渲染断言（数字/跨语言一致），这份服务于表单字段
 * （手机号、微信、期望薪资……都是渲染不进简历的 B 级字段）。
 *
 * 「期望工作城市 = 成都」是刻意的坏案例：generic 表单的城市下拉里
 * 没有成都 —— 档案有值但选项不认，这条缝由 plan 的 `option-mismatch` 兜住。
 */
export function fillTestArchive(): ArchiveV1 {
  return archiveV1Schema.parse({
    schemaVersion: 1,
    basics: {
      name: { zh: '张智远' },
      label: { zh: '前端开发工程师' },
      summary: { zh: '五年前端经验，主攻工程化与性能。' },
      location: { city: '成都' },
      contact: {
        email: 'zhang@example.com',
        phone: '13800138000',
        wechat: 'zhangzy_1988',
      },
      identity: { gender: '男', birthDate: '2001-06-15' },
      desiredSalary: { amount: 25000, currency: 'CNY' },
    },
    education: [
      {
        institution: '电子科技大学',
        studyType: { zh: '本科' },
        area: { zh: '软件工程' },
        endDate: '2024-06',
      },
    ],
  })
}
