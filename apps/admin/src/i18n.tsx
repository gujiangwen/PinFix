import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Locale = "en" | "zh-CN";

const STORAGE_KEY = "sightloop.admin.locale";

const en = {
  "nav.aria": "Admin sections",
  "nav.knowledge": "Knowledge",
  "daemon.retry": "Retry",
  "notice.dismiss": "Dismiss",
  "settings.title": "Settings",
  "settings.close": "Close settings",
  "settings.section.pi": "Pi / models",
  "settings.section.projects": "Projects",
  "settings.section.extension": "Extension",
  "settings.section.appearance": "Appearance",
  "settings.section.audit": "Audit",
  "settings.section.metrics": "Metrics",
  "chrome.lang": "Language",
  "chrome.theme": "Theme",
  "chrome.theme.light": "Light",
  "chrome.theme.dark": "Dark",
  "status.connected": "Connected to {url} (v{version})",
  "status.unreachable": "Cannot reach daemon at {url}: {message}",

  "projects.modeDoc.hmr":
    "HMR — Accept keeps the local temp commit for hot reload preview; no remote push.",
  "projects.modeDoc.pr":
    "PR — Accept additionally runs gh pr create (requires gh authenticated for the repo). Failures are recorded in Audit without failing the Accept/distill path.",
  "projects.form.edit": "Edit project",
  "projects.form.register": "Register project",
  "projects.form.name": "Name",
  "projects.form.repo": "Repo path (absolute)",
  "projects.form.origin": "Origin pattern",
  "projects.form.verify": "Verify command (optional)",
  "projects.form.whitelist":
    "File whitelist (include AGENTS.md for Knowledge sync)",
  "projects.form.mode": "Mode",
  "projects.form.branch": "Default branch",
  "projects.form.save": "Save changes",
  "projects.form.create": "Create project",
  "projects.form.cancel": "Cancel",
  "projects.list.title": "Projects",
  "projects.list.empty": "No projects registered yet.",
  "projects.col.name": "Name",
  "projects.col.mode": "Mode",
  "projects.col.repo": "Repo",
  "projects.col.origin": "Origin",
  "projects.btn.edit": "Edit",
  "projects.btn.hmr": "HMR",
  "projects.btn.pr": "PR",
  "projects.status.updated": "Updated project {id} (mode={mode})",
  "projects.status.created": "Created project {id}",
  "projects.status.prMode":
    "Project {name} → PR mode (Accept runs gh pr create)",
  "projects.status.hmrMode":
    "Project {name} → HMR mode (Accept keeps local commit)",

  "sessions.title": "Sessions",
  "sessions.refresh": "Refresh",
  "sessions.project": "Project",
  "sessions.all": "All",
  "sessions.empty": "No sessions yet.",
  "sessions.steps": "steps {count}",
  "sessions.timeline": "Timeline & diff",
  "sessions.select":
    "Select a session to inspect steps, recall hits, and patch.",
  "sessions.status": "Status",
  "sessions.page": "Page",
  "sessions.baseTemp": "Base → temp",
  "sessions.stepTimeline": "Step timeline",
  "sessions.reviews": "Reviews",
  "sessions.diff": "Diff viewer",
  "sessions.diffEmpty": "(empty patch)",
  "sessions.diffUnavailable": "(diff unavailable)",
  "sessions.recallNone": "No knowledge recall hits.",
  "sessions.recallTitle": "Knowledge recall (preferred before markup)",
  "sessions.untitled": "(untitled)",

  "knowledge.title": "Knowledge Hub",
  "knowledge.previewAgents": "Preview AGENTS.md",
  "knowledge.syncAgents": "Sync AGENTS.md",
  "knowledge.project": "Project",
  "knowledge.all": "All",
  "knowledge.stack": "Stack",
  "knowledge.tag": "Tag",
  "knowledge.search": "Search",
  "knowledge.includeArchived": "Include archived",
  "knowledge.filter": "Filter",
  "knowledge.cards": "Cards ({count})",
  "knowledge.empty": "No knowledge cards.",
  "knowledge.pinned": "Pinned",
  "knowledge.edit": "Edit",
  "knowledge.pin": "Pin",
  "knowledge.unpin": "Unpin",
  "knowledge.archive": "Archive",
  "knowledge.unarchive": "Unarchive",
  "knowledge.export": "Export",
  "knowledge.editor": "Editor",
  "knowledge.editCard": "Edit card",
  "knowledge.selectEdit": "Select Edit on a card.",
  "knowledge.titleField": "Title",
  "knowledge.kind": "Kind",
  "knowledge.tags": "Tags (comma-separated)",
  "knowledge.body": "Body (Markdown)",
  "knowledge.save": "Save",
  "knowledge.cancel": "Cancel",
  "knowledge.status.updated": "Updated knowledge {id}",
  "knowledge.status.preview":
    "Preview AGENTS.md ({bytes} bytes) → {path}",
  "knowledge.status.wrote": "Wrote AGENTS.md ({bytes} bytes) → {path}",
  "knowledge.err.selectProject": "Select a project to sync AGENTS.md",

  "audit.title": "Security audit log",
  "audit.refresh": "Refresh",
  "audit.project": "Project",
  "audit.all": "All",
  "audit.empty": "No audit events.",
  "audit.col.when": "When",
  "audit.col.event": "Event",
  "audit.col.project": "Project",
  "audit.col.session": "Session",
  "audit.col.detail": "Detail",

  "metrics.loading": "Loading metrics…",
  "metrics.title": "Basic metrics",
  "metrics.sessions": "Sessions",
  "metrics.failureRate": "Failure rate",
  "metrics.avgSteps": "Avg steps",
  "metrics.knowledge": "Knowledge",
  "metrics.pinned": "Pinned",
  "metrics.auditEvents": "Audit events",
  "metrics.vec": "sqlite-vec",
  "metrics.vecReady": "ready · {count} indexed",
  "metrics.vecUnavailable": "unavailable",
  "metrics.byStatus": "Sessions by status",
  "metrics.byDecision": "Reviews by decision",


  "ext.title": "Chrome extension (MV3)",
  "ext.lede":
    "Chrome cannot silently force-install extensions from a web page. This helper builds the unpacked MV3 bundle, downloads a ZIP, and copies the Load unpacked path.",
  "ext.build": "Build extension",
  "ext.download": "Download ZIP",
  "ext.copyPath": "Copy folder path",
  "ext.refresh": "Refresh status",
  "ext.built": "Built",
  "ext.notBuilt": "Not built yet",
  "ext.hostPath": "Host Load unpacked path",
  "ext.containerPath": "Container dist path",
  "ext.steps": "Install steps",
  "ext.limits": "What Chrome allows",
  "ext.limit.silent": "Silent force-install without enterprise policy: no",
  "ext.limit.load": "Load unpacked (Developer mode): yes",
  "ext.limit.chromeUrl": "Web pages opening chrome://extensions: blocked",
  "ext.limit.crx": "Installing CRX from http(s) Admin: not supported",
  "ext.copied": "Path copied to clipboard",
  "ext.copyFail": "Could not copy path",
  "ext.builtOk": "Extension build succeeded",
  "ext.downloaded": "ZIP download started",

  "models.title": "Pi / models",
  "models.lede":
    "One Pi credential for all roles. Planner, Implementer, Reviewer, and Judge only pick models. Key is masked after save (data/llm-settings.env, not committed).",
  "models.piSection": "Pi connection",
  "models.rolesSection": "Role models",
  "models.dualLoop": "Enable dual-loop",
  "models.dualMock": "Mock Planner/Reviewer",
  "models.crossJudge": "Cross-model judge (M12e)",
  "models.role.planner": "Planner",
  "models.role.implementer": "Implementer (Pi act)",
  "models.role.reviewer": "Reviewer",
  "models.role.judge": "Judge",
  "models.provider": "Provider",
  "models.defaultModel": "Default model",
  "models.model": "Model",
  "models.baseUrl": "Base URL (optional)",
  "models.apiKey": "Pi API key",
  "models.apiKeyPlaceholder": "Leave blank to keep existing",
  "models.clearKey": "Clear key",
  "models.keySet": "Key set {hint}",
  "models.keyMissing": "No key",
  "models.save": "Save settings",
  "models.saved": "Pi settings saved (applied live)",
  "models.path": "Settings file",
} as const;

type MessageKey = keyof typeof en;

const zhCN: Record<MessageKey, string> = {
  "nav.aria": "管理分区",
  "nav.knowledge": "知识库",
  "daemon.retry": "重试",
  "notice.dismiss": "关闭提示",
  "settings.title": "设置",
  "settings.close": "关闭设置",
  "settings.section.pi": "Pi / 模型",
  "settings.section.projects": "项目",
  "settings.section.extension": "扩展",
  "settings.section.appearance": "界面",
  "settings.section.audit": "审计",
  "settings.section.metrics": "指标",
  "chrome.lang": "语言",
  "chrome.theme": "主题",
  "chrome.theme.light": "浅色",
  "chrome.theme.dark": "深色",
  "status.connected": "已连接 {url}（v{version}）",
  "status.unreachable": "无法连接 Daemon {url}：{message}",

  "projects.modeDoc.hmr":
    "HMR — Accept 保留本地临时提交以便热更新预览；不推远程。",
  "projects.modeDoc.pr":
    "PR — Accept 额外执行 gh pr create（需仓库已登录 gh）。失败记入审计，不影响 Accept/蒸馏主路径。",
  "projects.form.edit": "编辑项目",
  "projects.form.register": "登记项目",
  "projects.form.name": "名称",
  "projects.form.repo": "仓库路径（绝对路径）",
  "projects.form.origin": "来源 Origin 模式",
  "projects.form.verify": "校验命令（可选）",
  "projects.form.whitelist":
    "文件白名单（知识同步请包含 AGENTS.md）",
  "projects.form.mode": "模式",
  "projects.form.branch": "默认分支",
  "projects.form.save": "保存更改",
  "projects.form.create": "创建项目",
  "projects.form.cancel": "取消",
  "projects.list.title": "项目",
  "projects.list.empty": "尚未登记任何项目。",
  "projects.col.name": "名称",
  "projects.col.mode": "模式",
  "projects.col.repo": "仓库",
  "projects.col.origin": "Origin",
  "projects.btn.edit": "编辑",
  "projects.btn.hmr": "HMR",
  "projects.btn.pr": "PR",
  "projects.status.updated": "已更新项目 {id}（mode={mode}）",
  "projects.status.created": "已创建项目 {id}",
  "projects.status.prMode":
    "项目 {name} → PR 模式（Accept 会执行 gh pr create）",
  "projects.status.hmrMode":
    "项目 {name} → HMR 模式（Accept 保留本地提交）",

  "sessions.title": "会话",
  "sessions.refresh": "刷新",
  "sessions.project": "项目",
  "sessions.all": "全部",
  "sessions.empty": "暂无会话。",
  "sessions.steps": "步数 {count}",
  "sessions.timeline": "时间线与 Diff",
  "sessions.select": "选择会话以查看步骤、召回命中与补丁。",
  "sessions.status": "状态",
  "sessions.page": "页面",
  "sessions.baseTemp": "Base → temp",
  "sessions.stepTimeline": "步骤时间线",
  "sessions.reviews": "评审",
  "sessions.diff": "Diff 查看器",
  "sessions.diffEmpty": "（空补丁）",
  "sessions.diffUnavailable": "（无法获取 diff）",
  "sessions.recallNone": "无知识召回命中。",
  "sessions.recallTitle": "知识召回（优先于 markup）",
  "sessions.untitled": "（无标题）",

  "knowledge.title": "知识中心",
  "knowledge.previewAgents": "预览 AGENTS.md",
  "knowledge.syncAgents": "同步 AGENTS.md",
  "knowledge.project": "项目",
  "knowledge.all": "全部",
  "knowledge.stack": "技术栈",
  "knowledge.tag": "标签",
  "knowledge.search": "搜索",
  "knowledge.includeArchived": "包含已归档",
  "knowledge.filter": "筛选",
  "knowledge.cards": "卡片（{count}）",
  "knowledge.empty": "暂无知识卡片。",
  "knowledge.pinned": "已置顶",
  "knowledge.edit": "编辑",
  "knowledge.pin": "置顶",
  "knowledge.unpin": "取消置顶",
  "knowledge.archive": "归档",
  "knowledge.unarchive": "取消归档",
  "knowledge.export": "导出",
  "knowledge.editor": "编辑器",
  "knowledge.editCard": "编辑卡片",
  "knowledge.selectEdit": "在卡片上点击「编辑」。",
  "knowledge.titleField": "标题",
  "knowledge.kind": "类型",
  "knowledge.tags": "标签（逗号分隔）",
  "knowledge.body": "正文（Markdown）",
  "knowledge.save": "保存",
  "knowledge.cancel": "取消",
  "knowledge.status.updated": "已更新知识 {id}",
  "knowledge.status.preview":
    "预览 AGENTS.md（{bytes} 字节）→ {path}",
  "knowledge.status.wrote": "已写入 AGENTS.md（{bytes} 字节）→ {path}",
  "knowledge.err.selectProject": "请先选择项目以同步 AGENTS.md",

  "audit.title": "安全审计日志",
  "audit.refresh": "刷新",
  "audit.project": "项目",
  "audit.all": "全部",
  "audit.empty": "暂无审计事件。",
  "audit.col.when": "时间",
  "audit.col.event": "事件",
  "audit.col.project": "项目",
  "audit.col.session": "会话",
  "audit.col.detail": "详情",

  "metrics.loading": "正在加载指标…",
  "metrics.title": "基础指标",
  "metrics.sessions": "会话数",
  "metrics.failureRate": "失败率",
  "metrics.avgSteps": "平均步数",
  "metrics.knowledge": "知识卡片",
  "metrics.pinned": "置顶",
  "metrics.auditEvents": "审计事件",
  "metrics.vec": "sqlite-vec",
  "metrics.vecReady": "就绪 · 已索引 {count}",
  "metrics.vecUnavailable": "不可用",
  "metrics.byStatus": "按状态的会话",
  "metrics.byDecision": "按决策的评审",


  "ext.title": "Chrome 扩展（MV3）",
  "ext.lede":
    "Chrome 不允许网页静默强制安装扩展。此处可构建解压版 MV3、下载 ZIP，并复制「加载已解压的扩展程序」路径。",
  "ext.build": "构建扩展",
  "ext.download": "下载 ZIP",
  "ext.copyPath": "复制文件夹路径",
  "ext.refresh": "刷新状态",
  "ext.built": "已构建",
  "ext.notBuilt": "尚未构建",
  "ext.hostPath": "本机 Load unpacked 路径",
  "ext.containerPath": "容器内 dist 路径",
  "ext.steps": "安装步骤",
  "ext.limits": "Chrome 能力边界",
  "ext.limit.silent": "无企业策略时静默强制安装：否",
  "ext.limit.load": "开发者模式加载已解压扩展：是",
  "ext.limit.chromeUrl": "网页打开 chrome://extensions：被拦截",
  "ext.limit.crx": "从 Admin 的 http(s) 安装 CRX：不支持",
  "ext.copied": "路径已复制到剪贴板",
  "ext.copyFail": "无法复制路径",
  "ext.builtOk": "扩展构建成功",
  "ext.downloaded": "已开始下载 ZIP",

  "models.title": "Pi / 模型",
  "models.lede":
    "统一配置一套 Pi 凭据；Planner / Implementer / Reviewer / Judge 只选模型。保存后密钥仅显示掩码（data/llm-settings.env，不入库）。",
  "models.piSection": "Pi 连接",
  "models.rolesSection": "各角色模型",
  "models.dualLoop": "启用双环",
  "models.dualMock": "Mock Planner/Reviewer",
  "models.crossJudge": "跨模型 Judge（M12e）",
  "models.role.planner": "Planner",
  "models.role.implementer": "Implementer（Pi 执行）",
  "models.role.reviewer": "Reviewer",
  "models.role.judge": "Judge",
  "models.provider": "Provider",
  "models.defaultModel": "默认模型",
  "models.model": "模型",
  "models.baseUrl": "Base URL（可选）",
  "models.apiKey": "Pi API Key",
  "models.apiKeyPlaceholder": "留空则保留原密钥",
  "models.clearKey": "清除密钥",
  "models.keySet": "已配置 {hint}",
  "models.keyMissing": "未配置",
  "models.save": "保存设置",
  "models.saved": "Pi 设置已保存（已热更新到进程）",
  "models.path": "设置文件",
};

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  en: en as Record<MessageKey, string>,
  "zh-CN": zhCN,
};

export type TranslateFn = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

function format(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] != null ? String(vars[name]) : `{${name}}`,
  );
}

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || "en").toLowerCase();
  return nav.startsWith("zh") ? "zh-CN" : "en";
}

type I18nCtx = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === "en" || e.newValue === "zh-CN") {
        setLocaleState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const t = useCallback<TranslateFn>(
    (key, vars) => format(catalogs[locale][key] ?? catalogs.en[key] ?? key, vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n requires I18nProvider");
  return ctx;
}
