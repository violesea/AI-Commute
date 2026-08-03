---
skills_used:
  - github:github
  - github:yeet
  - browser:control-in-app-browser
model_used: GPT-5
model_source: visible_runtime
created_at: 2026-08-03T00:00:00+08:00
updated_at: 2026-08-03T21:07:34+08:00
updated_by: codex
---

# Roadmap

## Now

- 旅行天气联动：首段 72/24 小时、每段出发前 1 小时刷新，以及详情页天气新鲜度。
- 自驾/公共交通比较、自然与人文景点推荐，以及推荐来源和待核实状态。
- 用户级通勤模型选择；旅行规划固定使用 `deepseek-v4-flash`。
- 设置页模型接入状态与最小请求测试。
- 首页显式展示模型与接入设置入口。
- 修复旅行日程时间轴、费用预算和出发前天气刷新任务。

## Next

- 让用户在旅行规划页显式编辑出发时间、节奏和预算上限。
- 将天气、道路封闭和景区开放状态合并为可解释的风险决策卡。
- 降低复杂旅行请求的 `create_trip` 重试次数和端到端响应时间。

## Later

- 更细粒度的油车/纯电补能规划和沿途充电站可用性验证。
- 多人出行偏好和可共享的结构化旅行计划。
