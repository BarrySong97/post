/**
 * @purpose Provide deterministic mock data for Post product previews and demos.
 * @role    Workspace package exporting website-safe data shaped for @post/ui preview components.
 * @deps    @post/ui presentation types.
 * @gotcha  Keep this package free of filesystem, SQLite, Electron, and post-file:// runtime values.
 */
import type {
  PostPreviewAsset,
  PostPreviewFilterOptions,
  PostPreviewFilterState,
  PostPreviewGraphData,
  PostPreviewOpenTarget,
  PostPreviewSettingsData,
  PostPreviewSidebarData,
  PostPreviewStatusData,
} from "@post/ui";

export const postPreviewSidebar: PostPreviewSidebarData = {
  summary: {
    total: 172,
    inbox: 16,
  },
  views: [
    { id: "recent", name: "近期收集", count: 48, icon: "folder" },
    { id: "product", name: "产品截图", count: 36, icon: "image" },
    { id: "dev", name: "开发资料", count: 32, icon: "code" },
    { id: "design", name: "设计参考", count: 28, icon: "folder" },
    { id: "video", name: "视频素材", count: 18, icon: "archive" },
    { id: "docs", name: "文档摘录", count: 42, icon: "archive" },
    { id: "ai", name: "AI 研究", count: 25, icon: "sparkles" },
    { id: "publish", name: "发布素材", count: 17, icon: "folder" },
  ],
  tags: [
    { id: "product-ui", name: "产品截图", count: 36, color: "#2563eb" },
    { id: "dev-env", name: "开发环境", count: 32, color: "#059669" },
    { id: "design-ref", name: "设计参考", count: 28, color: "#7c3aed" },
    { id: "data-panel", name: "数据面板", count: 22, color: "#0891b2" },
    { id: "ai-research", name: "AI 研究", count: 25, color: "#db2777" },
    { id: "writing", name: "写作素材", count: 19, color: "#d97706" },
    { id: "docs", name: "文档摘录", count: 42, color: "#0f766e" },
    { id: "video", name: "视频素材", count: 18, color: "#ea580c" },
    { id: "people", name: "人物素材", count: 12, color: "#64748b" },
  ],
};

const basePreviewAssets: PostPreviewAsset[] = [
  {
    id: "code-terminal",
    title: "终端调试工作区",
    kind: "image",
    source: "post-test-folder / screenshots",
    time: "今天 10:42",
    meta: "PNG · 16:9",
    tag: "开发环境",
    tagColor: "#059669",
    thumbnailUrl: "/product-preview/code-terminal.png",
    fileExt: "png",
    imageWidth: 1600,
    imageHeight: 900,
    height: "short",
    aspect: "16 / 9",
  },
  {
    id: "strategy-pdf",
    title: "2026-05-19_全策略候选清单",
    kind: "file",
    source: "post-test-folder / docs",
    time: "昨天 21:18",
    meta: "PDF · 2.4 MB",
    tag: "写作素材",
    tagColor: "#d97706",
    fileExt: "pdf",
    body: "用于整理候选主题、发布节奏和素材清单的 PDF 文档。",
  },
  {
    id: "campaign-dashboard",
    title: "Campaign dashboard reference",
    kind: "image",
    source: "post-test-folder / references",
    time: "周二 16:08",
    meta: "PNG · 1440 x 920",
    tag: "产品截图",
    tagColor: "#2563eb",
    thumbnailUrl: "/product-preview/campaign-dashboard.png",
    fileExt: "png",
    imageWidth: 1440,
    imageHeight: 920,
    height: "medium",
    aspect: "16 / 9",
  },
  {
    id: "video-chat",
    title: "How to video chat and screenshare",
    kind: "video",
    source: "post-test-folder / video",
    time: "5月20日",
    meta: "MP4 · 08:42",
    tag: "视频素材",
    tagColor: "#ea580c",
    thumbnailUrl: "/product-preview/video-chat.png",
    duration: "08:42",
    height: "tall",
    aspect: "4 / 5",
  },
  {
    id: "analytics-dashboard",
    title: "运营数据面板参考",
    kind: "web",
    source: "post-test-folder / product",
    time: "5月18日",
    meta: "Web capture",
    tag: "数据面板",
    tagColor: "#0891b2",
    thumbnailUrl: "/product-preview/analytics-dashboard.png",
    domain: "post.local",
    url: "https://post.local/product/analytics-dashboard",
    height: "medium",
    aspect: "16 / 9",
  },
  {
    id: "post-docs-link",
    title: "Post 本地资产整理说明",
    kind: "web",
    source: "post-test-folder / links",
    time: "5月17日",
    meta: "Web link",
    tag: "文档摘录",
    tagColor: "#0f766e",
    domain: "docs.post.local",
    url: "https://docs.post.local/assets/local-workspace",
    body: "保存应用内帮助、设计约束和资产整理流程，方便后续进入知识图谱。",
    height: "short",
  },
  {
    id: "laptop-book",
    title: "Shelf 项目灵感",
    kind: "video",
    source: "post-test-folder / inspiration",
    time: "5月16日",
    meta: "MOV · 00:32",
    tag: "设计参考",
    tagColor: "#7c3aed",
    thumbnailUrl: "/product-preview/laptop-book.png",
    duration: "00:32",
    height: "short",
    aspect: "4 / 3",
  },
  {
    id: "contact-table",
    title: "Recent contacts table",
    kind: "image",
    source: "post-test-folder / tables",
    time: "5月12日",
    meta: "PNG · dashboard",
    tag: "数据面板",
    tagColor: "#0891b2",
    thumbnailUrl: "/product-preview/contact-table.png",
    fileExt: "png",
    imageWidth: 1520,
    imageHeight: 855,
    height: "medium",
    aspect: "16 / 9",
  },
  {
    id: "camera-portrait",
    title: "创作者头像参考",
    kind: "image",
    source: "post-test-folder / portraits",
    time: "5月10日",
    meta: "JPG · portrait",
    tag: "人物素材",
    tagColor: "#64748b",
    isPrivate: true,
    thumbnailUrl: "/product-preview/camera-portrait.png",
    fileExt: "jpg",
    imageWidth: 1280,
    imageHeight: 960,
    height: "medium",
    aspect: "4 / 3",
  },
  {
    id: "note-stack",
    title: "为什么团队开始使用 Post",
    kind: "markdown",
    source: "post-test-folder / notes",
    time: "5月09日",
    meta: "Markdown",
    tag: "文档摘录",
    tagColor: "#0f766e",
    body: "新项目启动记录\n统一整理截图、参考资料和文档摘录。\n把待处理素材先放进收件箱，再按主题补充标签。\n每周复盘保存视图，清理重复文件和过期链接。",
  },
  {
    id: "release-checklist",
    title: "发布素材检查清单",
    kind: "markdown",
    source: "post-test-folder / publishing",
    time: "5月08日",
    meta: "Markdown",
    tag: "写作素材",
    tagColor: "#d97706",
    body: "封面图、演示录屏、功能截图、更新说明和发布渠道统一放入发布素材视图，发布前逐项确认。",
  },
  {
    id: "ai-notes",
    title: "AI 功能研究摘录",
    kind: "markdown",
    source: "post-test-folder / research",
    time: "5月07日",
    meta: "Markdown",
    tag: "AI 研究",
    tagColor: "#db2777",
    body: "记录模型能力边界、桌面端交互机会点，以及本地资产检索可以复用的提示词模板。",
  },
  {
    id: "design-capture",
    title: "设置页视觉参考",
    kind: "image",
    source: "post-test-folder / design",
    time: "5月06日",
    meta: "PNG · UI",
    tag: "设计参考",
    tagColor: "#7c3aed",
    thumbnailUrl: "/product-preview/analytics-dashboard.png",
    fileExt: "png",
    imageWidth: 1600,
    imageHeight: 900,
    height: "short",
    aspect: "16 / 9",
  },
  {
    id: "post-repo-shortcut",
    title: "Post 仓库快捷方式",
    kind: "link",
    source: "post-test-folder / links",
    time: "5月05日",
    meta: "URL · 快捷方式",
    tag: "开发环境",
    tagColor: "#059669",
    domain: "github.com",
    url: "https://github.com/post-local/post",
  },
];

const repeatedPreviewAssets: PostPreviewAsset[] = basePreviewAssets
  .slice(0, 10)
  .map((asset, index) => ({
    ...asset,
    id: `${asset.id}-repeat-${index + 1}`,
    title: `${asset.title} · 归档副本`,
    time: index % 2 === 0 ? "上周整理" : "本月收藏",
  }));

export const postPreviewAssets: PostPreviewAsset[] = [
  ...basePreviewAssets,
  ...repeatedPreviewAssets,
];

export const postPreviewDefaultFilters: PostPreviewFilterState = {
  match: "and",
  types: [],
  tags: [],
  sources: [],
  time: "any",
  status: "any",
  sort: "updated_desc",
};

export const postPreviewFilterOptions: PostPreviewFilterOptions = {
  types: [
    { value: "markdown", label: "文字" },
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "link", label: "链接" },
    { value: "file", label: "文件" },
  ],
  tags: postPreviewSidebar.tags.map((tag) => ({
    value: tag.name,
    label: tag.name,
    color: tag.color,
  })),
  sources: [
    { value: "资产库", label: "资产库" },
    { value: "本地文件", label: "本地文件" },
    { value: "链接", label: "链接" },
  ],
  times: [
    { value: "any", label: "不限" },
    { value: "today", label: "今天" },
    { value: "week", label: "本周" },
    { value: "m30", label: "近 30 天" },
    { value: "custom", label: "自定义" },
  ],
  statuses: [
    { value: "any", label: "不限" },
    { value: "inbox", label: "待整理" },
    { value: "draft", label: "草稿" },
    { value: "published", label: "已发布" },
  ],
  sorts: [
    { value: "updated_desc", label: "更新时间 · 降序" },
    { value: "updated_asc", label: "更新时间 · 升序" },
    { value: "created_desc", label: "创建时间 · 降序" },
    { value: "created_asc", label: "创建时间 · 升序" },
  ],
};

export const postPreviewOpenTargets: PostPreviewOpenTarget[] = [
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
  { id: "finder", label: "Finder" },
];

// Graph nodes reference real preview asset ids so node clicks can open the matching asset
// detail, mirroring the desktop graph's navigate-to-asset behavior. Node colors come from the
// shared kind palette; edge colors come from the relationType palette.
export const postPreviewGraph: PostPreviewGraphData = {
  title: "知识图谱",
  nodes: [
    { id: "note-stack", label: "为什么团队开始使用 Post", kind: "markdown" },
    { id: "release-checklist", label: "发布素材检查清单", kind: "markdown" },
    { id: "ai-notes", label: "AI 功能研究摘录", kind: "markdown" },
    { id: "strategy-pdf", label: "2026-05-19_全策略候选清单", kind: "file" },
    { id: "code-terminal", label: "终端调试工作区", kind: "image" },
    { id: "campaign-dashboard", label: "Campaign dashboard reference", kind: "image" },
    { id: "contact-table", label: "Recent contacts table", kind: "image" },
    { id: "design-capture", label: "设置页视觉参考", kind: "image" },
    { id: "camera-portrait", label: "创作者头像参考", kind: "image" },
    { id: "video-chat", label: "How to video chat and screenshare", kind: "video" },
    { id: "laptop-book", label: "Shelf 项目灵感", kind: "video" },
    { id: "analytics-dashboard", label: "运营数据面板参考", kind: "web" },
    { id: "post-docs-link", label: "Post 本地资产整理说明", kind: "web" },
    { id: "post-repo-shortcut", label: "Post 仓库快捷方式", kind: "link" },
  ],
  edges: [
    { source: "note-stack", target: "release-checklist", relationType: "wiki_link" },
    { source: "note-stack", target: "ai-notes", relationType: "wiki_link" },
    { source: "note-stack", target: "code-terminal", relationType: "markdown_image" },
    { source: "note-stack", target: "design-capture", relationType: "markdown_image" },
    { source: "release-checklist", target: "campaign-dashboard", relationType: "markdown_image" },
    { source: "release-checklist", target: "contact-table", relationType: "markdown_image" },
    { source: "release-checklist", target: "video-chat", relationType: "embed" },
    { source: "release-checklist", target: "strategy-pdf", relationType: "markdown_link" },
    { source: "ai-notes", target: "camera-portrait", relationType: "markdown_image" },
    { source: "ai-notes", target: "laptop-book", relationType: "embed" },
    { source: "ai-notes", target: "analytics-dashboard", relationType: "external_url" },
    { source: "ai-notes", target: "post-docs-link", relationType: "external_url" },
    { source: "ai-notes", target: "post-repo-shortcut", relationType: "external_url" },
  ],
};

// Mirrors the desktop settings surface exactly: it currently exposes a single "通用" section
// with only the interface-language select.
export const postPreviewSettings: PostPreviewSettingsData = {
  sections: [
    {
      title: "通用",
      rows: [{ title: "语言", description: "界面显示语言", value: "跟随系统" }],
    },
  ],
};

export const postPreviewStatus: PostPreviewStatusData = {
  appVersion: "0.1.0",
  vaultName: "post-test-folder",
  syncState: "已同步完成",
  staleState: "近期完成",
  tasks: [
    {
      id: "task-index-recent",
      title: "索引最近截图",
      detail: "已更新 24 个缩略图和 9 条文件关系。",
      type: "indexing",
      state: "completed",
    },
    {
      id: "task-sync-tags",
      title: "同步标签摘要",
      detail: "Views、Tags 和知识图谱状态已写入本地缓存。",
      type: "sync",
      state: "completed",
    },
    {
      id: "task-publish-pack",
      title: "发布素材检查",
      detail: "检查封面图、演示录屏和更新说明。",
      type: "publish",
      state: "queued",
    },
  ],
};

export function getPostPreviewAssetById(id: string): PostPreviewAsset | undefined {
  return postPreviewAssets.find((asset) => asset.id === id);
}
