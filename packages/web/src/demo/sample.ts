/**
 * 演示用样本：一份校招档案 + 一份 JD。
 *
 * ## 为什么不直接 import `core` 的 `__fixtures__`
 *
 * 那些样本是**验收样本**，它们的取值、条目数、甚至「故意填满每个字段」这件事，
 * 都是为了钉住某一条断言。把它们引进产物会形成一条反向依赖：
 * 改了验收样本就会改动 Demo 的展示，而维护 Demo 的人不知道自己在动测试。
 *
 * 所以这里单独写一份，取值**刻意不对称**：
 *
 * | 条目 | 特征 | 在报告里应当 |
 * |---|---|---|
 * | `work.0` 算法工程实习生 | 命中三个技能、新鲜、有量化 | 入选 |
 * | `work.1` 数据分析实习生 | 只命中 Python、两年多以前 | 淘汰，短板明确 |
 * | `work.2` 运营实习生 | 一个相关技能都没命中、要点无数字 | 淘汰，量化率 **0** |
 * | `projects.0` 推荐系统 | 命中「推荐系统」加分项 | 视分数入选或淘汰 |
 * | `projects.1` 简易编译器 | 与 JD 无关 | 淘汰 |
 * | `education.0` | 无要点 | 量化率 **0**，全维度低分 |
 *
 * `work.2` 与 `education.0` 是刻意留的：**它们是「四项构成里出现 0 分」的唯一来源**。
 * 没有零分项，界面上「得 0 分的维度也照样列出来」这件事就演示不出来。
 *
 * 所有值均为虚构，手机号是满足格式的编造值，不对应任何真实个人。
 */

import type { CompiledJd } from '../../../core/src/compile/index'
import type { ArchiveV1 } from '../../../core/src/schema/index'

/** 参照时间。**显式常量**，不取系统时间 —— 否则演示结果每天都不同。 */
export const SAMPLE_NOW = '2026-09'

/** 一页简历的量级：入选 3 条。 */
export const SAMPLE_LIMIT = 3

export const sampleJd: CompiledJd = {
  title: '算法工程师（校招）',
  company: null,
  hardRequirements: [],
  skills: [
    { name: 'Python', proficiency: 'proficient', required: true, evidence: '熟悉 Python' },
    { name: 'PyTorch', proficiency: 'expert', required: true, evidence: '精通 PyTorch' },
    { name: '推荐系统', proficiency: 'familiar', required: false, evidence: '有推荐系统经验者优先' },
    { name: 'SQL', proficiency: 'familiar', required: false, evidence: '了解 SQL 者优先' },
  ],
  responsibilities: [],
  register: 'technical',
  language: 'zh',
}

export const sampleArchive = {
  schemaVersion: 1,
  basics: {
    name: { zh: '林知远', en: 'Lin Zhiyuan' },
    label: { zh: '算法工程应届生', en: 'Algorithm Engineer, New Grad' },
    summary: {
      zh: '计算机科学本科应届生，一段推荐系统实习加一个完整项目。',
      en: 'CS undergraduate with a recommender-system internship and a full project.',
    },
    location: { city: '杭州' },
    contact: { email: 'linzhiyuan@example.com', phone: '+8613800138000' },
    identity: {},
    profiles: [],
  },
  work: [
    {
      company: '杭州某某科技有限公司',
      position: { zh: '算法工程实习生', en: 'Algorithm Engineering Intern' },
      startDate: '2025-06',
      endDate: '2025-09',
      location: '杭州',
      highlights: [
        '负责召回通道的特征工程，累计上线 12 个特征',
        '把离线特征回填耗时从 4.2 小时降至 38 分钟',
      ],
    },
    {
      company: '某某银行',
      position: { zh: '数据分析实习生', en: 'Data Analysis Intern' },
      startDate: '2022-07',
      endDate: '2022-09',
      location: '上海',
      highlights: ['用 Python 做业务报表'],
    },
    {
      company: '某某教育',
      position: { zh: '运营实习生', en: 'Operations Intern' },
      startDate: '2023-07',
      endDate: '2023-08',
      location: '杭州',
      highlights: ['协助社群日常运营与内容排期'],
    },
  ],
  education: [
    {
      institution: '某某大学',
      area: { zh: '计算机科学与技术', en: 'Computer Science' },
      studyType: { zh: '本科', en: "Bachelor's Degree" },
      startDate: '2022-09',
      endDate: '2026-06',
      gpa: '3.7/4.0',
      highlights: [],
    },
  ],
  projects: [
    {
      name: { zh: '校园二手交易推荐系统', en: 'Campus Marketplace Recommender' },
      description: {
        zh: '协同过滤与内容特征混合的推荐服务。',
        en: 'Hybrid recommender combining collaborative filtering and content features.',
      },
      highlights: ['用 PyTorch 实现双塔召回，把首页点击率从 18% 提到 27%'],
      keywords: ['推荐系统', '协同过滤'],
      startDate: '2025-03',
      endDate: '2025-05',
    },
    {
      name: { zh: '编译原理课程作业', en: 'Compiler Coursework' },
      description: { zh: '一个支持子集的简易编译器。', en: 'A small compiler for a language subset.' },
      highlights: ['实现了词法分析与递归下降语法分析'],
      keywords: ['C++'],
      startDate: '2024-03',
      endDate: '2024-06',
    },
  ],
  skills: [
    { name: { zh: '编程语言', en: 'Languages' }, keywords: ['Python', 'SQL', 'C++'] },
    { name: { zh: '机器学习', en: 'Machine Learning' }, keywords: ['PyTorch', 'LightGBM'] },
  ],
  languages: [
    { language: { zh: '英语', en: 'English' }, fluency: 'CET-6', score: '562' },
    { language: { zh: '普通话', en: 'Mandarin' }, fluency: '母语' },
  ],
  certificates: [],
  awards: [],
  customFields: {},
} satisfies ArchiveV1
