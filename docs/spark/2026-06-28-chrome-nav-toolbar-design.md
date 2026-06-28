# 设计:窗口级常驻导航工具条(Chrome Nav Toolbar)

- 日期:2026-06-28
- 状态:已批准设计,待实现
- 修订:2026-06-28 增补「收起态 Header 标题让位 + traffic light 两态常显」(§7.4),应用户评审反馈
- 范围:桌面端渲染层(`apps/desktop/src/renderer`)

## 1. 背景与问题

主应用外壳(`AppLayout`)左上角 traffic light 旁有一个侧栏折叠/展开的 toggle 按钮。该按钮目前写在 `Sidebar` 组件**内部**的 chrome row(`components/layout/sidebar/sidebar.tsx:892–904`)。因此:

- 侧栏收起后,toggle 跟着侧栏一起滑走/隐藏,只有当鼠标 hover 到窗口左边缘、浮出侧栏预览时才重新出现。
- 用户无法在收起状态下稳定看到/点击这个按钮。

## 2. 目标

1. 把侧栏 toggle 从侧栏内部提到一个**窗口级常驻工具条**,固定在 traffic light 右侧;展开和收起两种状态下,按钮都在**同一个位置**且始终可见。
2. 在同一工具条新增**后退(←)**与**前进(→)**两个图标按钮,操作路由历史。
3. 后退/前进具备**准确的禁用态**(到最早一条时 ← 置灰,到最新一条时 → 置灰),与参考图一致。

## 3. 非目标 / 明确保留

- **保留** 侧栏收起后"鼠标 hover 到左边缘 → 浮出整个侧栏预览"的行为(用户确认保留)。
- **不纳入** 设置页(`/settings`,独立路由、自带布局与自己的 `←返回应用` 按钮)。
- 不新增键盘快捷键(`⌘[` / `⌘]` 等)——见 §10 延后项。
- traffic light:本次把可见性改为「两态常显」(§7.4),仅改调用入参,不动 `syncWindowControlsWithSidebar` 实现本身。

## 4. 选定方案:窗口级覆盖层工具条(Approach A)

在 `AppLayout` 外壳里渲染**一个** `WindowChromeNav`,绝对定位在窗口左上角、traffic light 安全区之后,`z-index` 盖在侧栏与主面板之上。它的位置只跟窗口走,与侧栏展开/收起完全解耦 → 两种状态下位置绝对稳定。侧栏内部的 toggle 删除,由该工具条统一负责。

已评估并否决的备选:
- **B 双处渲染**(展开放侧栏顶部、收起放主面板 `PageChrome`):两处渲染 + 条件分支,两种状态需分别对齐像素,本质是把"会消失"问题换个写法。
- **C 整条窗口顶栏**(类浏览器,贯穿整窗):改版过大,侧栏与主内容会整体下移,超出"放在 traffic light 旁"的最小诉求。

## 5. 组件与文件拆分

| 类型 | 路径 | 职责 |
| --- | --- | --- |
| 改造 | `renderer/src/lib/router.ts`(新建) | 把 `createRouter` 从 `main.tsx` 抽出,`export const router` 单例 + `declare module` 注册 |
| 改造 | `renderer/src/main.tsx` | 改为 `import { router } from "@/lib/router"`,去掉内联创建 |
| 新增 | `renderer/src/store/history-nav-atoms.ts` | jotai atom:订阅 router history,派生 `canGoBack` / `canGoForward` |
| 新增 | `renderer/src/hooks/use-history-navigation.ts` | 薄 hook:聚合 atom 值 + `goBack` / `goForward` |
| 新增 | `renderer/src/components/layout/window-chrome-nav.tsx` | 常驻工具条 `[toggle] [←] [→]` |
| 改造 | `renderer/src/components/layout/app-layout.tsx` | 渲染 `WindowChromeNav`;`handleToggleSidebar` 改接到它 |
| 改造 | `renderer/src/components/layout/sidebar/sidebar.tsx` | 删除内部 toggle 按钮、相关 props 与未用 import |
| 改造 | `renderer/src/components/layout/app-layout-context.ts` | `AppLayoutContextValue` 增加 `sidebarCollapsed`,供 Header 计算让位宽度 |
| 改造 | `renderer/src/pages/asset-manager/asset-manager-page.tsx` 等 `_app` 顶部 Header | 收起态插入「让位 spacer」把标题推到工具条右侧(含 `AssetBoardHeader` 的「全部资产」、详情/图谱页 Header) |

### 设计原则:单一职责 / 可独立理解

- `history-nav-atoms.ts`:只负责"把 router history 的前进后退可用性桥接成 jotai 可读状态"。输入是 router 单例,输出是两个布尔派生 atom。可独立测试(见 §9)。
- `WindowChromeNav`:只负责"渲染工具条 + 把点击连到 toggle / 路由动作"。不持有历史逻辑。
- `Sidebar`:回归"只渲染侧栏内容",不再承担 toggle 职责。

## 6. 前进/后退状态(jotai + `__TSR_index`)

### 6.1 依据的 TanStack history API(`@tanstack/history@1.162.0`)

- `router.history.subscribe(cb)`:`cb({ location, action })`;`action.type ∈ {"PUSH","REPLACE","BACK","FORWARD","GO"}`。返回退订函数。
- `router.history.location.state.__TSR_index: number`:当前**绝对**导航索引(`ParsedHistoryState`)。
- `router.history.back()` / `forward()` / `canGoBack()`。

### 6.2 atom 实现(`store/history-nav-atoms.ts`)

```ts
import { atom } from "jotai";
import { router } from "@/lib/router";

// index = 当前绝对索引;top = 当前前进链的最高索引
const historyNavAtom = atom({ index: 0, top: 0 });

historyNavAtom.onMount = (set) => {
  const sync = (type?: string) => {
    const index =
      (router.history.location.state as { __TSR_index?: number }).__TSR_index ?? 0;
    // PUSH 截断前进记录 → top 重置为当前索引;其余导航 top 取最大值保持不变
    set((prev) => ({ index, top: type === "PUSH" ? index : Math.max(prev.top, index) }));
  };
  sync();                                       // 初始同步
  return router.history.subscribe(({ action }) => sync(action.type));
};

export const canGoBackAtom = atom((get) => get(historyNavAtom).index > 0);
export const canGoForwardAtom = atom((get) => {
  const { index, top } = get(historyNavAtom);
  return index < top;
});
```

要点:
- `canGoBack`:`index > 0`,等价于 `history.canGoBack()`(其实现即 `state index !== 0`),且对应用启动前已有的历史也准确。
- `canGoForward`:`index < top`。`PUSH` 时 `top` 重置 → 立刻变为不可前进;`BACK` 后 `index < top` → 变为可前进。
- `REPLACE` 不改 `index`、不进 PUSH 分支 → **不影响**前进后退(项目里滚动位置 `?i/o` 用的就是 `replace`,因此不会污染历史)。
- `atom.onMount` 自带订阅生命周期(有组件读取时订阅、全部卸载时退订),无需手写 `useEffect` 桥接组件。
- 启动时 `top = index`(假定无前进记录);即便存在浏览器级前进项也无法得知,可接受。

### 6.3 hook(`hooks/use-history-navigation.ts`)

```ts
import { useAtomValue } from "jotai";
import { router } from "@/lib/router";
import { canGoBackAtom, canGoForwardAtom } from "@/store/history-nav-atoms";

export function useHistoryNavigation() {
  return {
    canGoBack: useAtomValue(canGoBackAtom),
    canGoForward: useAtomValue(canGoForwardAtom),
    goBack: () => router.history.back(),
    goForward: () => router.history.forward(),
  };
}
```

## 7. WindowChromeNav 组件与放置

### 7.1 结构

```
[ toggle ] [ ← back ] [ → forward ]
```

- Props:`{ sidebarCollapsed: boolean; onToggleSidebar: () => void }`。
- Toggle 图标沿用现逻辑:`sidebarCollapsed ? PanelLeftOpen : PanelLeftClose`(`size 19`),`aria-label` 同步为"展开/收起左侧栏"。
- 后退/前进:用 `useHistoryNavigation()`;图标 `ArrowLeft` / `ArrowRight`(`size ~18`)。
  - 禁用态:`disabled` + `text-zinc-300` + `pointer-events-none`;启用态 `text-zinc-500 hover:bg-black/5`(与现有图标按钮一致)。

### 7.2 放置与拖拽(在 `AppLayout` 内)

- 容器绝对定位:`absolute top-0 left-0`,`mt-[10.5px] h-12`,`pl-[100px]`(mac;非 mac `pl-3`)安全区,与现有侧栏/设置 chrome row 完全一致,保证与 traffic light 垂直对齐。
- `z-[80]`,盖在侧栏(`z-[75]`)与主面板之上。
- 拖拽穿透:容器 `pointer-events-none`;每个按钮 `pointer-events-auto window-no-drag` → 只有按钮拦截事件,按钮之间/周围留白仍可拖动窗口。
- 渲染一次,展开/收起都不重挂载。

### 7.3 与折叠 / hover 浮出的协作

- 展开态:工具条覆盖在侧栏顶部 chrome row 区域之上。侧栏 chrome row 保留为**空白占位 + 拖拽区**(让侧栏内容仍从工具条下方开始)。
- 收起态:工具条覆盖在主面板顶部之上。
- hover 浮出侧栏预览时:浮出的 `Sidebar`(`floating`)同样不再有自己的 toggle;工具条 `z-[80]` 始终在其之上,位置不变。

### 7.4 收起态:Header 标题让位(避免与工具条重叠)

**问题**:收起后工具条覆盖在主面板顶部左上角,会与页面 Header 的标题(如 `全部资产`,`asset-manager-page.tsx:815`)**水平重叠**。展开态工具条压在侧栏顶部空白占位区、不碰主 Header,因此无需让位。

**traffic light 两态常显(前置变更)**:为让工具条"两态都紧贴 traffic light 且位置一致",把 `syncWindowControlsWithSidebar(...)` 入参从 `!sidebarCollapsed || sidebarPreviewOpen` 改为**恒 `true`**(展开、收起都显示 traffic light)。理由:

- 与参考图一致(两张图都含 traffic light)。
- 让 `pl-[100px]` 安全区在两态都被 traffic light 占用 → 工具条绝对位置完全不变(满足"同一位置")。
- 否则收起态 traffic light 隐藏,要么工具条左侧空出 100px 很怪,要么把工具条左移 → 两态位置不一致。

**让位实现**:

- `AppLayoutContextValue` 增加 `sidebarCollapsed: boolean`(Provider 已持有该 state,只是没下发)。
- 新增共享常量 `CHROME_NAV_WIDTH_PX` = 工具条从窗口左缘起占用的总宽度(mac:安全区 100 + 三个按钮 + 间距;非 mac 以 `pl-3` 起算)。作为**唯一真源**,同时供工具条自身布局与 Header 让位复用。
- 每个 `_app` 顶部 Header 行首插入一个**让位 spacer**:
  - 宽度 = `sidebarCollapsed ? max(0, CHROME_NAV_WIDTH_PX − Header 现有左 padding) : 0`。
  - 收起 → 撑出工具条宽度,把标题推到其右侧;展开 → 收为 0,标题回原位。
  - 动画:CSS `transition-[width] duration-200 ease-out` 即可实现"顶过去"的过渡(用户也认可不一定要用 motion);需要更顺滑可改 `motion` 的 `animate`,接口不变。
- 仅作用于 Header 那一行(`h-14`),不影响下方 body(body 两态都用满宽)。标题的 `mr-auto` 仍把右侧操作按钮顶到最右。
- 应用于:`AssetBoardHeader`(资产列表「全部资产」)、资产详情顶部 Header(`asset-manager-page.tsx:2360`)、知识图谱页 Header。

## 8. Sidebar / AppLayout 改动细节

- **Sidebar**:
  - 删除 chrome row 内的 toggle `<Button>`(`sidebar.tsx:892–904`),docked 与 floating 两种渲染都不再有 toggle。
  - chrome row 容器保留(空白占位 + 拖拽区)。
  - 清理不再使用的 props `onToggleSidebar` / `toggleMode` 及调用点;移除变为未使用的 `PanelLeftOpen` / `PanelLeftClose` import。
- **AppLayout**:
  - 在 shell 顶层渲染 `<WindowChromeNav sidebarCollapsed={sidebarCollapsed} onToggleSidebar={handleToggleSidebar} />`(位于 `ResizablePanelGroup` 之上的覆盖层)。
  - `handleToggleSidebar` 现有逻辑不变,只是改由工具条触发。
  - 通过 `AppLayoutContext` 额外下发 `sidebarCollapsed`,供各 Header 计算让位 spacer 宽度(§7.4)。
  - `syncWindowControlsWithSidebar` 入参改为恒 `true`(traffic light 两态常显,§7.4)。

## 9. 作用范围

- 工具条在 `AppLayout` 内 → 出现在所有 `_app/*` 页面(资产列表、知识图谱、资产详情)。
- 前进/后退作用于**全局** router history,跨页面均生效(包括进出设置页的导航)。
- 设置页保留自带的 `←返回应用` 按钮,本次不纳入工具条。

## 10. 验证

- 手测(dev 重启后 / `package:install` prod):
  - 展开↔收起:工具条稳定停在 traffic light 右侧、同一位置、始终可见。
  - 收起后工具条**不与** Header 标题(`全部资产`)重叠:标题被平滑顶到工具条右侧;展开后标题回原位。
  - traffic light 在展开与收起两态均显示。
  - toggle 双向有效;收起后 hover 左边缘仍能浮出侧栏预览。
  - 前进后退随历史置灰:停在最早一条 ← 灰;`PUSH` 新页后 → 灰;`BACK` 后 → 亮且可前进。
  - 跨页面(列表 ↔ 详情 ↔ 图谱 ↔ 设置)导航正常;滚动位置 `?i/o` 的 `replace` 写入不会让 → 误亮。
- `pnpm -C apps/desktop run check-types` + `oxlint` 全绿。
- 可选单测:`history-nav-atoms` 的 reducer 逻辑(PUSH 截断 / BACK-FORWARD / REPLACE 不变),用 `createMemoryHistory` 驱动。

## 11. 边界情况

- **REPLACE**:不改 index/top → 前进后退状态不变(关键,保护滚动位置写入)。
- **GO(跳多步)**:`sync` 直接读 `__TSR_index` 重算,`top` 取 `max`,天然正确。
- **收起↔展开过渡**:Header 让位 spacer 用 CSS width 过渡(200ms)平滑顶出/收回;body 不参与,无横向抖动。
- **应用启动**:`index = top` → 初始不可前进;`canGoBack` 仍按真实 index 判定。
- **StrictMode 双挂载**:`atom.onMount` 退订/重订幂等;`sync()` 每次从 `location.state` 重读,无累积误差。

## 12. 延后项(本次不做,记录备查)

- `⌘[` / `⌘]` 快捷键:`⌘[` 在设置页快捷键列表中现表示"切换侧边栏",与浏览器"后退"语义冲突,需单独决策。
- 资产详情页自带的 `window.history.back()` 返回按钮:与工具条后退功能重叠,后续可考虑统一/移除。
- 设置页是否纳入同款工具条。
