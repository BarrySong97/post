# 首页资产分页与滚动性能优化设计

## Summary

- 目标：支持 5 万以上资产时，首页首屏、View/Tag 切换、连续滚动都保持流畅。
- 主方案：拆分侧边栏元数据与资产列表；资产列表改为 TanStack `useInfiniteQuery` + tRPC keyset 分页。
- 统计策略：Tags/Views/summary 保持精确，但与列表请求解耦，避免阻塞第一页资产加载。

## Key Changes

- 新增 `assets.sidebarMeta(input?: { vaultId?: string })`，返回 vault、tags、views、summary、source options、conflict count，不返回 assets。
- 改造 `assets.list` 为分页接口，输入支持 tag/status/type/time/source/sort/filter，输出 `{ items, total, nextCursor }`。
- 默认分页 `limit = 80`，最大 `160`；cursor 为 `{ valueMs, id }`，排序保持现有语义：`updated_*` 用 `mtimeMs`，`created_*` 用 `ctimeMs ?? mtimeMs`。
- 首页用 `useInfiniteQuery(trpc.assets.list.infiniteQueryOptions(...))`，滚动到底部 sentinel 自动 `fetchNextPage()`。
- 详情页依赖 `assets.byId`，不要求目标资产已在当前分页列表中。

## Implementation Notes

- Repository 层将过滤、排序、分页下推到 SQLite；只对当前页 attach tags/links/thumbnail metadata。
- Tags、Views、summary counts 用独立 SQL 聚合，和列表页查询解耦。
- 增加 DB migration 索引，覆盖 vault + fileExists + 时间排序 + assetId，以及 tagId + assetId。
- 移除 `listParamsAtom` 与 filter tags 的互相同步 effect，统一从 sidebar selection + filter panel 派生 query input。
- 移除全量 `layoutSignature` 字符串；masonic positioner 只在容器宽度或 query key 变化时重建，追加页不整体重排。

## Test Plan

- 运行 `pnpm check-types` 和 `pnpm build`。
- 手动验证：首页首屏只加载第一页；View/Tag 切换立即有选中态和 loading；不会短暂显示 0 个结果。
- 手动验证：连续滚动自动加载下一页，下一页失败时保留已加载内容并提供重试。
- 手动验证：直接打开 `/assets/$assetId` 可展示详情。
- 手动验证：Tags/Views/summary 在统计完成后精确更新，且不触发全量 assets payload。

## Assumptions

- 不新增前端测试框架；本次验收以类型检查、构建、人工性能验证为主。
- UI 入口和视觉结构保持不变，只增加必要的分页加载态、底部加载/错误/无更多状态。
