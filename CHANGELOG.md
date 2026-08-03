---
skills_used: []
model_used: GPT-5
model_source: visible_runtime
created_at: 2026-08-03T00:00:00+08:00
updated_at: 2026-08-03T15:25:00+08:00
---

# Changelog

## Unreleased

- 修复旅行路线日期时间轴的跨日和倒序风险。
- 增加旅行计划总预算及费用分项展示。
- 增加旅行首段出发前 72 小时和 24 小时天气刷新任务。
- 设置页增加通勤模型选择、旅行固定模型说明和服务器模型接入测试；API Key 与 Base URL 保持服务端环境变量管理。
- 设置页 GitHub 署名改为 `violesea/AI-Commute`。
- 修复模型把公共交通对照耗时误写入最终路线总时长时造成的跨午夜拒绝；时间轴优先采用路线分钟与明确缓冲，并保留小范围模型缓冲修正。
