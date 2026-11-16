/**
 * 项目记忆 (local-memory) 插件
 * 本地分层长期记忆（全局偏好 + 项目专属记忆）
 * CC GUI Tier-1 单文件 ESM 插件
 */

export default function activate(ctx) {
  const { createElement: h, useState, useEffect, useCallback, useMemo } = ctx.react;

  const STORAGE_GLOBAL = "lm_global_memories_v1";
  const STORAGE_PROJECTS = "lm_projects_memories_v1";
  const STORAGE_PATHS_MAP = "lm_projects_paths_v1"; // normKey -> originalPath
  const CAPTURE_NONCE = "MEM_SYNC";

  function normPath(p) {
    if (!p || typeof p !== "string") return "default";
    return p.replace(/\\/g, "/").toLowerCase();
  }

  // ── 内存缓存与发布订阅 ──────────────────────────────────────────────────────────
  const state = {
    global: [],
    projects: {}, // normPath(wsPath) -> entries[]
    projectPaths: {}, // normPath(wsPath) -> original wsPath
    activeWs: "",
  };

  const listeners = new Set();
  function notify() {
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (err) {
        console.error("[project-memory] listener notify error:", err);
      }
    }
  }

  async function loadAll() {
    try {
      const g = await ctx.storage.get(STORAGE_GLOBAL);
      if (Array.isArray(g)) state.global = g;

      const p = await ctx.storage.get(STORAGE_PROJECTS);
      if (p && typeof p === "object") state.projects = p;

      const paths = await ctx.storage.get(STORAGE_PATHS_MAP);
      if (paths && typeof paths === "object") state.projectPaths = paths;

      notify();
    } catch (err) {
      console.error("[project-memory] failed to load storage:", err);
    }
  }

  async function saveGlobal() {
    try {
      await ctx.storage.set(STORAGE_GLOBAL, state.global);
      notify();
    } catch (err) {
      console.error("[project-memory] failed to save global storage:", err);
    }
  }

  async function saveProjects() {
    try {
      await ctx.storage.set(STORAGE_PROJECTS, state.projects);
      await ctx.storage.set(STORAGE_PATHS_MAP, state.projectPaths);
      notify();
    } catch (err) {
      console.error("[project-memory] failed to save project storage:", err);
    }
  }

  function registerPath(wsPath) {
    if (!wsPath || typeof wsPath !== "string") return;
    const key = normPath(wsPath);
    if (!state.projectPaths[key] || state.projectPaths[key] !== wsPath) {
      state.projectPaths = { ...state.projectPaths, [key]: wsPath };
      void ctx.storage.set(STORAGE_PATHS_MAP, state.projectPaths);
    }
  }

  function updateActiveWs(wsPath) {
    if (!wsPath || typeof wsPath !== "string") return;
    if (state.activeWs !== wsPath) {
      state.activeWs = wsPath;
      registerPath(wsPath);
      notify();
    }
  }

  function getProjectEntries(wsPath) {
    const key = normPath(wsPath);
    return state.projects[key] || [];
  }

  function addMemory(scope, wsPath, content) {
    const trimmed = (content || "").trim();
    if (!trimmed) return;
    const now = Date.now();
    const item = {
      id: "mem_" + now + "_" + Math.random().toString(36).slice(2, 6),
      content: trimmed,
      createdAt: now,
      updatedAt: now,
    };

    if (scope === "global") {
      if (!state.global.some((e) => e.content === trimmed)) {
        state.global = [item, ...state.global];
        void saveGlobal();
      }
    } else {
      const targetWs = wsPath || state.activeWs || "default";
      registerPath(targetWs);
      const key = normPath(targetWs);
      const list = state.projects[key] ? [...state.projects[key]] : [];
      if (!list.some((e) => e.content === trimmed)) {
        list.unshift(item);
        state.projects = { ...state.projects, [key]: list };
        void saveProjects();
      }
    }
  }

  function updateMemory(scope, wsPath, id, newContent) {
    const trimmed = (newContent || "").trim();
    if (!trimmed) return;
    const now = Date.now();

    if (scope === "global") {
      state.global = state.global.map((e) =>
        e.id === id ? { ...e, content: trimmed, updatedAt: now } : e,
      );
      void saveGlobal();
    } else {
      const targetWs = wsPath || state.activeWs || "default";
      const key = normPath(targetWs);
      const list = state.projects[key] || [];
      state.projects = {
        ...state.projects,
        [key]: list.map((e) =>
          e.id === id ? { ...e, content: trimmed, updatedAt: now } : e,
        ),
      };
      void saveProjects();
    }
  }

  function deleteMemory(scope, wsPath, id) {
    if (scope === "global") {
      state.global = state.global.filter((e) => e.id !== id);
      void saveGlobal();
    } else {
      const targetWs = wsPath || state.activeWs || "default";
      const key = normPath(targetWs);
      const list = state.projects[key] || [];
      state.projects = {
        ...state.projects,
        [key]: list.filter((e) => e.id !== id),
      };
      void saveProjects();
    }
  }

  function removeMemoryByText(scope, wsPath, text) {
    const target = (text || "").trim().toLowerCase();
    if (!target) return;

    if (scope === "global") {
      state.global = state.global.filter(
        (e) =>
          e.content.trim().toLowerCase() !== target &&
          !e.content.toLowerCase().includes(target),
      );
      void saveGlobal();
    } else {
      const targetWs = wsPath || state.activeWs || "default";
      const key = normPath(targetWs);
      const list = state.projects[key] || [];
      state.projects = {
        ...state.projects,
        [key]: list.filter(
          (e) =>
            e.content.trim().toLowerCase() !== target &&
            !e.content.toLowerCase().includes(target),
        ),
      };
      void saveProjects();
    }
  }

  function clearAllInScope(scope, wsPath) {
    if (scope === "global") {
      state.global = [];
      void saveGlobal();
    } else {
      const targetWs = wsPath || state.activeWs || "default";
      const key = normPath(targetWs);
      state.projects = { ...state.projects, [key]: [] };
      void saveProjects();
    }
  }

  // 初始化加载
  void loadAll();

  // ── 图标定义（🧠）─────────────────────────────────────────────────────────────
  function BrainIcon({ className }) {
    return h(
      "span",
      {
        className,
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
          lineHeight: "1",
        },
        role: "img",
        "aria-label": "记忆",
      },
      "🧠",
    );
  }

  function EditIcon() {
    return h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: "13",
        height: "13",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
      h("path", {
        d: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
      }),
    );
  }

  function TrashIcon() {
    return h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: "13",
        height: "13",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
      h("path", { d: "M3 6h18" }),
      h("path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }),
      h("path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }),
    );
  }

  // ── SessionHooks: 监听会话/工作区切换，实时更新当前活跃工作区 ──────────────────
  ctx.hooks.registerSessionHooks({
    onCreated(event) {
      if (event.workspace && event.workspace.path) {
        updateActiveWs(event.workspace.path);
      }
    },
    onRestored(event) {
      if (event.workspace && event.workspace.path) {
        updateActiveWs(event.workspace.path);
      }
    },
  });

  // ── TurnHooks: 自动注入与协议帧捕获 ──────────────────────────────────────────
  ctx.hooks.registerTurnHooks({
    beforeTurn(event) {
      const wsPath = event.workspace?.path || state.activeWs || "";
      if (wsPath) {
        updateActiveWs(wsPath);
      }

      const globalEntries = state.global;
      const projectEntries = getProjectEntries(wsPath);

      let prompt = "# 本地长期记忆（项目记忆与通用偏好）\n";
      prompt += "以下记忆已从记忆库直接加载：\n\n";

      if (globalEntries.length > 0) {
        prompt += "## 🌐 全局偏好与习惯 (跨项目通用)\n";
        for (const m of globalEntries) {
          prompt += `- ${m.content}\n`;
        }
        prompt += "\n";
      }

      if (projectEntries.length > 0) {
        prompt += "## 📁 当前项目专属记忆\n";
        for (const m of projectEntries) {
          prompt += `- ${m.content}\n`;
        }
        prompt += "\n";
      }

      prompt +=
        "## 记忆读写协议指引\n" +
        "你具备本地长期记忆管理能力。\n" +
        "当用户在对话中明确要求记住、更新、删除偏好或项目事实时（如“请记住...”、“记住...”、“以后都用...”、“忘记/删除关于...”），或者双方在对话中达成了重要的项目规范/避坑结论：\n" +
        "1. 正常用自然语言向用户确认已记下/更新/删除；\n" +
        "2. 在回答文本的最末尾附带以下格式的私有协议帧（客户端会自动从聊天界面截获并隐藏，用户不可见）：\n" +
        `<CCGUI_INTERNAL_${CAPTURE_NONCE}>{"action":"add"|"remove","scope":"global"|"project","content":"记忆内容"}</CCGUI_INTERNAL_${CAPTURE_NONCE}>\n` +
        "- scope 规则：通用个人习惯、偏好语言、编程风格使用 'global'；当前项目的包管理命令、脚本、代码架构、业务规范使用 'project'。\n" +
        "- action 规则：添加记忆使用 'add'；用户要求忘记或删除某条偏好时使用 'remove'。\n";

      return {
        promptContributions: [
          {
            id: "local-memory-prompt-contribution",
            content: prompt,
            placement: "system-tail",
            persistence: "turn",
            visibility: "internal",
          },
        ],
        internalMessageCapture: {
          channel: "memory-sync",
          nonce: CAPTURE_NONCE,
          maxBytes: 8192,
          validate: (payload) => typeof payload === "object" && payload !== null,
        },
      };
    },

    onInternalMessage(event) {
      if (event.channel !== "memory-sync" && event.nonce !== CAPTURE_NONCE) return;
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;

      const { action, scope, content } = payload;
      const wsPath = event.workspace?.path || state.activeWs || "";
      const targetScope = scope === "project" ? "project" : "global";

      if (action === "add" && content) {
        addMemory(targetScope, wsPath, String(content));
      } else if (action === "remove" && content) {
        removeMemoryByText(targetScope, wsPath, String(content));
      }
    },
  });

  // ── UI: 设置页中的记忆管理 ────────────────────────────────────────────────────
  function SettingsMemoryPage() {
    const [curState, setCurState] = useState(state);
    const [allWorkspaces, setAllWorkspaces] = useState([]);
    const [activeTab, setActiveTab] = useState("project"); // 默认展示'project'
    const [selectedProjectKey, setSelectedProjectKey] = useState(
      normPath(state.activeWs) || "default",
    );
    const [draft, setDraft] = useState("");
    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState("");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
      const listener = (s) => setCurState({ ...s });
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []);

    // 动态获取 CC-GUI 中添加的全部工作区
    useEffect(() => {
      let alive = true;
      if (ctx.workspaces && typeof ctx.workspaces.list === "function") {
        ctx.workspaces.list()
          .then((list) => {
            if (alive && Array.isArray(list)) {
              setAllWorkspaces(list);
              for (const ws of list) {
                if (ws && ws.path) registerPath(ws.path);
              }
            }
          })
          .catch((err) => {
            console.error("[project-memory] list workspaces error:", err);
          });
      }
      return () => {
        alive = false;
      };
    }, []);

    // 汇总 CC-GUI 全部工作区与历史记录的工作区
    const projectOptions = useMemo(() => {
      const map = curState.projects;
      const paths = curState.projectPaths;
      const activeKey = normPath(curState.activeWs);
      const optionMap = new Map();

      // 1. 先加入 CC-GUI 中添加的全部工作区
      for (const ws of allWorkspaces) {
        if (!ws || !ws.path) continue;
        const k = normPath(ws.path);
        const count = (map[k] || []).length;
        const displayName = ws.name ? ws.name : ws.path;
        optionMap.set(k, {
          key: k,
          path: ws.path,
          label: `${displayName} (${ws.path})`,
          shortName: displayName,
          count,
          isActive: k === activeKey,
        });
      }

      // 2. 确保当前活跃工作区在列表中
      if (curState.activeWs) {
        const k = activeKey;
        if (!optionMap.has(k)) {
          const count = (map[k] || []).length;
          optionMap.set(k, {
            key: k,
            path: curState.activeWs,
            label: curState.activeWs,
            shortName: curState.activeWs,
            count,
            isActive: true,
          });
        } else {
          optionMap.get(k).isActive = true;
        }
      }

      // 3. 补充已有记忆但未在侧栏当前列表里的历史工作区
      for (const k of Object.keys(map)) {
        if (!optionMap.has(k)) {
          const p = paths[k] || k;
          const count = (map[k] || []).length;
          optionMap.set(k, {
            key: k,
            path: p,
            label: p,
            shortName: p,
            count,
            isActive: k === activeKey,
          });
        }
      }

      const list = Array.from(optionMap.values());
      // 排序：当前活跃工作区优先排首位，其余按显示名排序
      list.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return a.shortName.localeCompare(b.shortName);
      });

      return list;
    }, [curState, allWorkspaces]);

    useEffect(() => {
      if (projectOptions.length > 0 && !projectOptions.some((o) => o.key === selectedProjectKey)) {
        const activeOpt = projectOptions.find((o) => o.isActive);
        setSelectedProjectKey(activeOpt ? activeOpt.key : projectOptions[0].key);
      }
    }, [projectOptions, selectedProjectKey]);

    const selectedOpt = projectOptions.find((o) => o.key === selectedProjectKey);
    const activeProjectTarget = selectedOpt
      ? selectedOpt.path
      : curState.projectPaths[selectedProjectKey] || selectedProjectKey;

    const projectEntries = curState.projects[selectedProjectKey] || [];
    const globalEntries = curState.global;
    const currentList = activeTab === "global" ? globalEntries : projectEntries;

    const handleAdd = () => {
      if (!draft.trim()) return;
      addMemory(activeTab, activeProjectTarget, draft.trim());
      setDraft("");
    };

    const handleStartEdit = (item) => {
      setEditingId(item.id);
      setEditDraft(item.content);
    };

    const handleSaveEdit = (id) => {
      if (!editDraft.trim()) return;
      updateMemory(activeTab, activeProjectTarget, id, editDraft.trim());
      setEditingId(null);
      setEditDraft("");
    };

    const handleCopyMarkdown = () => {
      let md = `# ${activeTab === "global" ? "全局通用偏好" : "项目专属记忆"}\n\n`;
      for (const item of currentList) {
        md += `- ${item.content}\n`;
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(md).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }
    };

    const handleClearAll = () => {
      const scopeLabel = activeTab === "global" ? "全局记忆" : "当前项目记忆";
      if (confirm(`确定要清空全部「${scopeLabel}」吗？此操作不可撤销。`)) {
        clearAllInScope(activeTab, activeProjectTarget);
      }
    };

    return h(
      "div",
      { className: "pm-settings-container" },

      // Header
      h(
        "div",
        { className: "pm-header" },
        h(
          "div",
          { className: "pm-title-row" },
          h(
            "h2",
            { className: "pm-title" },
            h(BrainIcon, null),
            "项目记忆管理",
          ),
        ),
        h(
          "p",
          { className: "pm-desc" },
          "跨会话管理项目专属规则与全局通用偏好。在对话中直接对 AI 说“请记住...”即可自动记录，发送消息时自动注入 Prompt。",
        ),
      ),

      // Controls Bar: Tabs & Project Selector
      h(
        "div",
        { className: "pm-controls-bar" },
        h(
          "div",
          { className: "pm-tabs" },
          h(
            "button",
            {
              className: `pm-tab-btn ${activeTab === "project" ? "active" : ""}`,
              onClick: () => setActiveTab("project"),
            },
            "📁 项目专属记忆",
            h("span", { className: "pm-tab-count" }, projectEntries.length),
          ),
          h(
            "button",
            {
              className: `pm-tab-btn ${activeTab === "global" ? "active" : ""}`,
              onClick: () => setActiveTab("global"),
            },
            "🌐 全局通用偏好",
            h("span", { className: "pm-tab-count" }, globalEntries.length),
          ),
        ),

        // 项目工作区选择器
        activeTab === "project" &&
          h(
            "div",
            { className: "pm-project-selector" },
            h("span", { style: { color: "var(--color-text-secondary, #71717a)" } }, "选择工作区："),
            projectOptions.length > 0
              ? h(
                  "select",
                  {
                    className: "pm-select",
                    value: selectedProjectKey,
                    onChange: (e) => setSelectedProjectKey(e.target.value),
                  },
                  projectOptions.map((opt) =>
                    h(
                      "option",
                      { key: opt.key, value: opt.key },
                      `${opt.label} (${opt.count}条)${opt.isActive ? " ★当前" : ""}`,
                    ),
                  ),
                )
              : h(
                  "span",
                  { style: { color: "var(--color-text-tertiary, #a1a1aa)" } },
                  curState.activeWs || "默认工作区",
                ),
          ),
      ),

      // Memory List
      h(
        "div",
        { className: "pm-list" },
        currentList.length === 0
          ? h(
              "div",
              { className: "pm-empty" },
              h("div", { className: "pm-empty-icon" }, "🧠"),
              h(
                "div",
                { className: "pm-empty-title" },
                `暂无${activeTab === "global" ? "全局" : "当前项目"}记忆`,
              ),
              h(
                "div",
                { className: "pm-empty-hint" },
                '在对话中直接告诉 AI：“请记住：本项目构建命令是 pnpm build”，或在下方直接手动添加。',
              ),
            )
          : currentList.map((item) =>
              h(
                "div",
                { key: item.id, className: "pm-card" },
                h(
                  "div",
                  { className: "pm-card-top" },
                  h(
                    "div",
                    { className: "pm-card-meta" },
                    h(
                      "span",
                      {
                        className: `pm-scope-badge ${activeTab === "project" ? "project" : ""}`,
                      },
                      activeTab === "global" ? "全局通用" : "项目专属",
                    ),
                    h(
                      "span",
                      null,
                      new Date(item.createdAt).toLocaleDateString() +
                        " " +
                        new Date(item.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                    ),
                  ),
                  h(
                    "div",
                    { className: "pm-card-actions" },
                    h(
                      "button",
                      {
                        className: "pm-icon-btn",
                        title: "编辑",
                        onClick: () => handleStartEdit(item),
                      },
                      h(EditIcon, null),
                      "编辑",
                    ),
                    h(
                      "button",
                      {
                        className: "pm-icon-btn danger",
                        title: "删除",
                        onClick: () =>
                          deleteMemory(activeTab, activeProjectTarget, item.id),
                      },
                      h(TrashIcon, null),
                      "删除",
                    ),
                  ),
                ),
                editingId === item.id
                  ? h(
                      "div",
                      { className: "pm-card-edit" },
                      h("textarea", {
                        className: "pm-edit-textarea",
                        rows: 3,
                        value: editDraft,
                        onChange: (e) => setEditDraft(e.target.value),
                      }),
                      h(
                        "div",
                        { className: "pm-edit-actions" },
                        h(
                          "button",
                          {
                            className: "pm-btn-sm pm-btn-cancel",
                            onClick: () => setEditingId(null),
                          },
                          "取消",
                        ),
                        h(
                          "button",
                          {
                            className: "pm-btn-sm pm-btn-save",
                            onClick: () => handleSaveEdit(item.id),
                          },
                          "保存修改",
                        ),
                      ),
                    )
                  : h("p", { className: "pm-card-text" }, item.content),
              ),
            ),
      ),

      // Add Memory Section
      h(
        "div",
        { className: "pm-add-section" },
        h(
          "h4",
          { className: "pm-add-title" },
          `手动新增${activeTab === "global" ? "全局通用" : "项目专属"}记忆`,
        ),
        h("textarea", {
          className: "pm-textarea",
          rows: 3,
          placeholder:
            activeTab === "global"
              ? "添加全局通用偏好，如：回答始终使用中文、代码优先使用 TypeScript..."
              : "添加本项目专属记忆，如：启动命令是 pnpm dev、禁止修改 .env 文件...",
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleAdd();
            }
          },
        }),
        h(
          "div",
          { className: "pm-add-actions" },
          h(
            "div",
            { className: "pm-quick-links" },
            currentList.length > 0 &&
              h(
                "button",
                {
                  className: "pm-link-btn",
                  onClick: handleCopyMarkdown,
                },
                copied ? "已复制 ✓" : "复制为 Markdown",
              ),
            currentList.length > 0 &&
              h(
                "button",
                {
                  className: "pm-link-btn",
                  onClick: handleClearAll,
                },
                "清空当前列表",
              ),
          ),
          h(
            "button",
            {
              className: "pm-btn-add",
              disabled: !draft.trim(),
              onClick: handleAdd,
            },
            "添加记忆 (Ctrl+Enter)",
          ),
        ),
      ),
    );
  }

  // 注册设置页中的记忆管理
  ctx.ui.registerSettingsSection({
    key: "memory",
    label: () => "项目记忆",
    icon: BrainIcon,
    component: SettingsMemoryPage,
  });

  // ── UI: 最底部的底栏状态栏条目 ────────────────────────────────────────────────
  function MemoryStatusBarItem() {
    const [counts, setCounts] = useState({
      global: state.global.length,
      project: getProjectEntries(state.activeWs).length,
      activeWs: state.activeWs,
    });

    useEffect(() => {
      const listener = (s) => {
        setCounts({
          global: s.global.length,
          project: getProjectEntries(s.activeWs).length,
          activeWs: s.activeWs,
        });
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []);

    // 监听与轮询活跃工作区，确保切换侧边栏工作区时底栏即时响应更新
    useEffect(() => {
      let alive = true;
      const syncActive = async () => {
        try {
          if (ctx.workspace && typeof ctx.workspace.getMetadata === "function") {
            const meta = await ctx.workspace.getMetadata();
            if (alive && meta && meta.path) {
              updateActiveWs(meta.path);
            }
          }
        } catch {}
      };
      void syncActive();
      const timer = setInterval(syncActive, 1000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);

    const total = counts.global + counts.project;

    return h(
      "button",
      {
        className: `pm-status-bar-chip ${total > 0 ? "has-entries" : ""}`,
        title: `项目记忆（点击进入设置）：\n- 当前工作区：${counts.activeWs || "默认"}\n- 全局通用偏好：${counts.global} 条\n- 本项目专属记忆：${counts.project} 条`,
        onClick: () => {
          try {
            ctx.ui.openSettings?.("memory");
          } catch (err) {
            console.error("[project-memory] openSettings error:", err);
          }
        },
      },
      h("span", { style: { marginRight: "4px" } }, "🧠"),
      `记忆: 全局 ${counts.global} · 项目 ${counts.project}`,
    );
  }

  // 注册在最底部的应用状态栏上
  ctx.ui.registerStatusBarItem({
    key: "project-memory-status",
    order: 10,
    zone: "end",
    component: MemoryStatusBarItem,
  });
}
