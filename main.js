/**
 * 长期记忆 (local-memory) 插件 v1.2.0
 * 本地三层长期记忆（全局通用偏好 + 项目专属记忆 + Agent/引擎专属规范）
 * CC GUI Tier-1 单文件 ESM 插件
 */

export default function activate(ctx) {
  const { createElement: h, useState, useEffect, useCallback, useMemo } = ctx.react;

  const STORAGE_GLOBAL = "lm_global_memories_v1";
  const STORAGE_PROJECTS = "lm_projects_memories_v1";
  const STORAGE_PATHS_MAP = "lm_projects_paths_v1"; // normKey -> originalPath
  const STORAGE_AGENTS = "lm_agents_memories_v1"; // engineKey -> entries[]
  const CAPTURE_NONCE = "MEM_SYNC";

  // CC-GUI 官方完整支持的内置 Agent / CLI 引擎列表
  const CCGUI_SUPPORTED_ENGINES = [
    { key: "agy", name: "Antigravity", label: "Google Antigravity (agy)" },
    { key: "codex", name: "Codex", label: "OpenAI Codex (codex)" },
    { key: "claude", name: "Claude", label: "Claude Code (claude)" },
    { key: "omp", name: "OMP", label: "Oh-My-Pi (omp)" },
    { key: "kimi", name: "Kimi", label: "Kimi CLI (kimi)" },
    { key: "grok", name: "Grok", label: "Grok CLI (grok)" },
    { key: "dsh", name: "DeepSeek Harness", label: "DeepSeek Harness (dsh)" },
    { key: "opencode", name: "OpenCode", label: "OpenCode (opencode)" },
    { key: "qoder", name: "Qoder", label: "Qoder CLI (qoder)" },
    { key: "qoder-cn", name: "Qoder 国内版", label: "Qoder CLI 国内版 (qoder-cn)" },
    { key: "codebuddy", name: "CodeBuddy", label: "CodeBuddy CLI (codebuddy)" },
    { key: "minimax", name: "MiniMax", label: "MiniMax (minimax)" },
    { key: "pi", name: "Pi", label: "Pi CLI (pi)" },
  ];

  function normPath(p) {
    if (!p || typeof p !== "string") return "default";
    return p.replace(/\\/g, "/").toLowerCase();
  }

  function normEngine(e) {
    if (!e || typeof e !== "string") return "agy";
    return e.trim().toLowerCase();
  }

  // ── 内存缓存与发布订阅 ──────────────────────────────────────────────────────────
  const state = {
    global: [],
    projects: {}, // normPath(wsPath) -> entries[]
    projectPaths: {}, // normPath(wsPath) -> original wsPath
    agents: {}, // normEngine -> entries[]
    activeWs: "",
    activeEngine: "agy",
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

  function extractTopic(content) {
    if (!content || typeof content !== "string") return "";
    const trimmed = content.trim();
    // 匹配前置主题，支持冒号（中文：或英文:）
    const colonMatch = trimmed.match(/^([^：:\n\r]{2,25})[：:]/);
    if (colonMatch) {
      return colonMatch[1].trim().toLowerCase();
    }
    // 匹配括号标注，如 【Git规范】 或 [Git规范]
    const bracketMatch = trimmed.match(/^[【\[]([^】\]]{2,20})[】\]]/);
    if (bracketMatch) {
      return bracketMatch[1].trim().toLowerCase();
    }
    return "";
  }

  async function loadAll() {
    try {
      const g = await ctx.storage.get(STORAGE_GLOBAL);
      if (Array.isArray(g)) state.global = g;

      const p = await ctx.storage.get(STORAGE_PROJECTS);
      if (p && typeof p === "object") state.projects = p;

      const paths = await ctx.storage.get(STORAGE_PATHS_MAP);
      if (paths && typeof paths === "object") state.projectPaths = paths;

      const a = await ctx.storage.get(STORAGE_AGENTS);
      if (a && typeof a === "object") state.agents = a;

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

  async function saveAgents() {
    try {
      await ctx.storage.set(STORAGE_AGENTS, state.agents);
      notify();
    } catch (err) {
      console.error("[project-memory] failed to save agents storage:", err);
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

  function updateActiveEngine(engine) {
    if (!engine || typeof engine !== "string") return;
    const k = normEngine(engine);
    if (state.activeEngine !== k) {
      state.activeEngine = k;
      notify();
    }
  }

  function getProjectEntries(wsPath) {
    const key = normPath(wsPath);
    return state.projects[key] || [];
  }

  function getAgentEntries(engine) {
    const key = normEngine(engine);
    return state.agents[key] || [];
  }

  function findSimilarIndex(list, newContent, oldContent) {
    if (!Array.isArray(list) || list.length === 0) return -1;
    const newTrimmed = (newContent || "").trim();
    const newLower = newTrimmed.toLowerCase();

    // 1. 若显式指定了 oldContent，优先匹配
    if (oldContent && typeof oldContent === "string" && oldContent.trim()) {
      const oldLower = oldContent.trim().toLowerCase();
      const idx = list.findIndex(
        (e) =>
          e.content.toLowerCase().includes(oldLower) ||
          oldLower.includes(e.content.toLowerCase()),
      );
      if (idx !== -1) return idx;
    }

    // 2. 检查主题前缀是否相同（如“交互与工作流程习惯”、“Git 分支操作规范”）
    const newTopic = extractTopic(newTrimmed);
    if (newTopic) {
      const idx = list.findIndex((e) => extractTopic(e.content) === newTopic);
      if (idx !== -1) return idx;
    }

    // 3. 检查是否有显著公共前缀（前 12 个字匹配）
    const prefixLen = 12;
    if (newLower.length >= prefixLen) {
      const p = newLower.slice(0, prefixLen);
      const idx = list.findIndex(
        (e) => e.content.toLowerCase().slice(0, prefixLen) === p,
      );
      if (idx !== -1) return idx;
    }

    return -1;
  }

  function upsertMemory(scope, target, content, oldContent) {
    const trimmed = (content || "").trim();
    if (!trimmed) return;
    const now = Date.now();

    if (scope === "global") {
      const list = [...state.global];
      const matchIdx = findSimilarIndex(list, trimmed, oldContent);
      if (matchIdx !== -1) {
        list[matchIdx] = {
          ...list[matchIdx],
          content: trimmed,
          updatedAt: now,
        };
        const newTopic = extractTopic(trimmed);
        state.global = newTopic
          ? list.filter(
              (e, i) => i === matchIdx || extractTopic(e.content) !== newTopic,
            )
          : list;
      } else {
        const item = {
          id: "mem_" + now + "_" + Math.random().toString(36).slice(2, 6),
          content: trimmed,
          createdAt: now,
          updatedAt: now,
        };
        state.global = [item, ...list];
      }
      void saveGlobal();
    } else if (scope === "agent") {
      const eng = normEngine(target || state.activeEngine || "agy");
      const list = state.agents[eng] ? [...state.agents[eng]] : [];
      const matchIdx = findSimilarIndex(list, trimmed, oldContent);
      if (matchIdx !== -1) {
        list[matchIdx] = {
          ...list[matchIdx],
          content: trimmed,
          updatedAt: now,
        };
        const newTopic = extractTopic(trimmed);
        const filtered = newTopic
          ? list.filter(
              (e, i) => i === matchIdx || extractTopic(e.content) !== newTopic,
            )
          : list;
        state.agents = { ...state.agents, [eng]: filtered };
      } else {
        const item = {
          id: "mem_" + now + "_" + Math.random().toString(36).slice(2, 6),
          content: trimmed,
          createdAt: now,
          updatedAt: now,
        };
        state.agents = { ...state.agents, [eng]: [item, ...list] };
      }
      void saveAgents();
    } else {
      const targetWs = target || state.activeWs || "default";
      registerPath(targetWs);
      const key = normPath(targetWs);
      const list = state.projects[key] ? [...state.projects[key]] : [];
      const matchIdx = findSimilarIndex(list, trimmed, oldContent);
      if (matchIdx !== -1) {
        list[matchIdx] = {
          ...list[matchIdx],
          content: trimmed,
          updatedAt: now,
        };
        const newTopic = extractTopic(trimmed);
        const filtered = newTopic
          ? list.filter(
              (e, i) => i === matchIdx || extractTopic(e.content) !== newTopic,
            )
          : list;
        state.projects = { ...state.projects, [key]: filtered };
      } else {
        const item = {
          id: "mem_" + now + "_" + Math.random().toString(36).slice(2, 6),
          content: trimmed,
          createdAt: now,
          updatedAt: now,
        };
        state.projects = { ...state.projects, [key]: [item, ...list] };
      }
      void saveProjects();
    }
  }

  function addMemory(scope, target, content) {
    upsertMemory(scope, target, content);
  }

  function updateMemory(scope, target, id, newContent) {
    const trimmed = (newContent || "").trim();
    if (!trimmed) return;
    const now = Date.now();

    if (scope === "global") {
      state.global = state.global.map((e) =>
        e.id === id ? { ...e, content: trimmed, updatedAt: now } : e,
      );
      void saveGlobal();
    } else if (scope === "agent") {
      const eng = normEngine(target || state.activeEngine || "agy");
      const list = state.agents[eng] || [];
      state.agents = {
        ...state.agents,
        [eng]: list.map((e) =>
          e.id === id ? { ...e, content: trimmed, updatedAt: now } : e,
        ),
      };
      void saveAgents();
    } else {
      const targetWs = target || state.activeWs || "default";
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

  function deleteMemory(scope, target, id) {
    if (scope === "global") {
      state.global = state.global.filter((e) => e.id !== id);
      void saveGlobal();
    } else if (scope === "agent") {
      const eng = normEngine(target || state.activeEngine || "agy");
      const list = state.agents[eng] || [];
      state.agents = {
        ...state.agents,
        [eng]: list.filter((e) => e.id !== id),
      };
      void saveAgents();
    } else {
      const targetWs = target || state.activeWs || "default";
      const key = normPath(targetWs);
      const list = state.projects[key] || [];
      state.projects = {
        ...state.projects,
        [key]: list.filter((e) => e.id !== id),
      };
      void saveProjects();
    }
  }

  function removeMemoryByText(scope, target, text) {
    const targetText = (text || "").trim().toLowerCase();
    if (!targetText) return;

    if (scope === "global") {
      state.global = state.global.filter(
        (e) =>
          e.content.trim().toLowerCase() !== targetText &&
          !e.content.toLowerCase().includes(targetText),
      );
      void saveGlobal();
    } else if (scope === "agent") {
      const eng = normEngine(target || state.activeEngine || "agy");
      const list = state.agents[eng] || [];
      state.agents = {
        ...state.agents,
        [eng]: list.filter(
          (e) =>
            e.content.trim().toLowerCase() !== targetText &&
            !e.content.toLowerCase().includes(targetText),
        ),
      };
      void saveAgents();
    } else {
      const targetWs = target || state.activeWs || "default";
      const key = normPath(targetWs);
      const list = state.projects[key] || [];
      state.projects = {
        ...state.projects,
        [key]: list.filter(
          (e) =>
            e.content.trim().toLowerCase() !== targetText &&
            !e.content.toLowerCase().includes(targetText),
        ),
      };
      void saveProjects();
    }
  }

  function clearAllInScope(scope, target) {
    if (scope === "global") {
      state.global = [];
      void saveGlobal();
    } else if (scope === "agent") {
      const eng = normEngine(target || state.activeEngine || "agy");
      state.agents = { ...state.agents, [eng]: [] };
      void saveAgents();
    } else {
      const targetWs = target || state.activeWs || "default";
      const key = normPath(targetWs);
      state.projects = { ...state.projects, [key]: [] };
      void saveProjects();
    }
  }

  // 初始化加载
  void loadAll();

  // ── 图标定义（脑部 SVG）───────────────────────────────────────────────────────
  function BrainIcon({ className, size = 16, style }) {
    return h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: "0 0 14 14",
        width: size,
        height: size,
        className,
        style: {
          display: "inline-block",
          verticalAlign: "middle",
          flexShrink: 0,
          ...style,
        },
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        role: "img",
        "aria-label": "长期记忆",
      },
      h(
        "g",
        null,
        h("path", {
          d: "M4.62 1.438A2.38 2.38 0 0 1 7 3.818v6.47a2.724 2.724 0 1 1-5.439-.228C.994 9.45.636 8.26.636 7.265c0-1.354.665-2.67 1.617-3.189A2.38 2.38 0 0 1 4.62 1.438",
        }),
        h("path", {
          d: "M3.511 5.694c-.35-.08-1.141-.599-1.26-1.611M4.97 8.365C6.398 8.205 6.963 6.699 7 6.086M2.29 8.632c-.356.28-.64.917-.731 1.427M9.38 1.438A2.38 2.38 0 0 0 7 3.818v6.47a2.724 2.724 0 1 0 5.439-.228c.567-.61.924-1.8.924-2.795c0-1.354-.664-2.67-1.617-3.189A2.38 2.38 0 0 0 9.38 1.438",
        }),
        h("path", {
          d: "M10.489 5.694c.35-.08 1.141-.599 1.26-1.611M9.03 8.365C7.602 8.205 7.037 6.699 7 6.086m4.71 2.546c.356.28.64.917.731 1.427",
        }),
      ),
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

  // ── SessionHooks: 监听会话/工作区切换 ──────────────────────────────────────────
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

      const currentEngine = normEngine(event.engine || state.activeEngine || "agy");
      updateActiveEngine(currentEngine);

      const globalEntries = state.global;
      const projectEntries = getProjectEntries(wsPath);
      const agentEntries = getAgentEntries(currentEngine);

      let prompt = "# 本地长期记忆（全局偏好、项目专属与Agent专属规范）\n";
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

      // 仅在当前会话运行该引擎时，注入属于它的专属 Agent 记忆
      if (agentEntries.length > 0) {
        prompt += `## 🤖 当前 Agent (${currentEngine.toUpperCase()}) 专属记忆\n`;
        for (const m of agentEntries) {
          prompt += `- ${m.content}\n`;
        }
        prompt += "\n";
      }

      prompt +=
        "## 记忆读写协议指引\n" +
        "你具备本地长期记忆管理能力。\n" +
        "【触发门禁】严禁随意主动新增记忆。仅在以下两类严格场景下才允许新增（add）或修改（update）记忆：\n" +
        "1. 用户在对话中明确要求记住、修改/更新、删除偏好或项目事实（如“请记住...”、“更新...为...”、“以后都用...”、“删除/忘记...”）；\n" +
        "2. 排查或开发中反复出现、且经过多次纠错/踩坑验证的关键问题（沉淀为长期避坑规范）。\n" +
        "严禁对单次普通问答、临时调试细节或未经反复验证的偶发问题进行记忆，杜绝无意义膨胀与噪声。\n" +
        "触发记忆时的操作要求：\n" +
        "1. 先用自然语言向用户明确确认已记下、更新或删除；\n" +
        "2. 在回答文本的最末尾附带以下格式的私有协议帧（客户端会自动从聊天界面截获并隐藏，用户不可见）：\n" +
        `<CCGUI_INTERNAL_${CAPTURE_NONCE}>{"action":"add"|"update"|"remove","scope":"global"|"project"|"agent","target":"<可选，指定agent如agy/codex/claude>","oldContent":"<更新时用于定位旧条目的关键词或主题，可选>","content":"记忆内容"}</CCGUI_INTERNAL_${CAPTURE_NONCE}>\n` +
        "- action 规则：\n" +
        "  * 'update'：【推荐】针对已有偏好进行修订、升级、优化或覆盖。优先使用 update；配合 oldContent 填入旧条目的主题或关键词进行精确定位（若未传 oldContent，系统也会按新内容的主题分类智能匹配原条目就地更新替换）；\n" +
        "  * 'add'：仅用于记录全新领域或此前未曾涉及的规则与偏好；\n" +
        "  * 'remove'：用户明确要求忘记、废止或删除某条偏好（content 填要删除的关键词、主题或原条目内容）。\n" +
        "- content 格式规范：建议采用“<主题分类>：<具体规范要求>”（例如“Git 分支操作规范：……”、“交互与工作流程习惯：……”），便于跨会话归类与同主题精准检索更新；\n" +
        "- scope 规则：通用个人习惯与编码偏好使用 'global'；当前项目的包管理命令、脚本、代码架构规范使用 'project'；仅针对特定 Agent/引擎的习惯与行为规范使用 'agent'（target 指定引擎如 agy/codex/claude，省略时默认当前 Agent）。\n";

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

      const { action, scope, target, content, oldContent } = payload;
      const wsPath = event.workspace?.path || state.activeWs || "";
      const currentEngine = normEngine(event.engine || state.activeEngine || "agy");

      let targetScope = "global";
      let targetKey = "";

      if (scope === "project") {
        targetScope = "project";
        targetKey = wsPath;
      } else if (scope === "agent") {
        targetScope = "agent";
        targetKey = normEngine(target || currentEngine);
      } else {
        targetScope = "global";
      }

      if ((action === "add" || action === "update") && content) {
        upsertMemory(targetScope, targetKey, String(content), oldContent);
      } else if (action === "remove" && content) {
        removeMemoryByText(targetScope, targetKey, String(content));
      }
    },
  });

  // ── UI: 设置页中的记忆管理 ────────────────────────────────────────────────────
  function SettingsMemoryPage() {
    const [curState, setCurState] = useState(state);
    const [allWorkspaces, setAllWorkspaces] = useState([]);
    // 用户指定顺序：全局记忆 -> 项目记忆 -> Agent 记忆，默认展示 'global'
    const [activeTab, setActiveTab] = useState("global");
    const [selectedProjectKey, setSelectedProjectKey] = useState(
      normPath(state.activeWs) || "default",
    );
    const [selectedEngineKey, setSelectedEngineKey] = useState(
      normEngine(state.activeEngine) || "agy",
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
        ctx.workspaces
          .list()
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

    const projectOptions = useMemo(() => {
      const map = curState.projects;
      const paths = curState.projectPaths;
      const activeKey = normPath(curState.activeWs);
      const optionMap = new Map();

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
      list.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return a.shortName.localeCompare(b.shortName);
      });

      return list;
    }, [curState, allWorkspaces]);

    // 动态生成 CC-GUI 支持的完整 Agent 列表并统计记忆条数
    const engineOptions = useMemo(() => {
      const existingKeys = new Set(Object.keys(curState.agents));
      const activeEng = normEngine(curState.activeEngine || "agy");

      const list = CCGUI_SUPPORTED_ENGINES.map((eng) => {
        const count = (curState.agents[eng.key] || []).length;
        existingKeys.delete(eng.key);
        return {
          key: eng.key,
          label: eng.label,
          count,
          isActive: eng.key === activeEng,
        };
      });

      // 补充用户可能手动或通过历史记录定义的其他未知/扩展引擎
      for (const k of existingKeys) {
        const count = (curState.agents[k] || []).length;
        list.push({
          key: k,
          label: `${k.toUpperCase()} (${k})`,
          count,
          isActive: k === activeEng,
        });
      }

      return list;
    }, [curState]);

    useEffect(() => {
      if (
        projectOptions.length > 0 &&
        !projectOptions.some((o) => o.key === selectedProjectKey)
      ) {
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
    const agentEntries = curState.agents[selectedEngineKey] || [];

    const currentList =
      activeTab === "global"
        ? globalEntries
        : activeTab === "project"
          ? projectEntries
          : agentEntries;

    const activeTarget =
      activeTab === "global"
        ? ""
        : activeTab === "project"
          ? activeProjectTarget
          : selectedEngineKey;

    const handleAdd = () => {
      if (!draft.trim()) return;
      addMemory(activeTab, activeTarget, draft.trim());
      setDraft("");
    };

    const handleStartEdit = (item) => {
      setEditingId(item.id);
      setEditDraft(item.content);
    };

    const handleSaveEdit = (id) => {
      if (!editDraft.trim()) return;
      updateMemory(activeTab, activeTarget, id, editDraft.trim());
      setEditingId(null);
      setEditDraft("");
    };

    const handleCopyMarkdown = () => {
      const scopeTitle =
        activeTab === "global"
          ? "全局通用偏好"
          : activeTab === "project"
            ? "项目专属记忆"
            : `${selectedEngineKey.toUpperCase()} Agent 专属记忆`;
      let md = `# ${scopeTitle}\n\n`;
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
      const scopeLabel =
        activeTab === "global"
          ? "全局记忆"
          : activeTab === "project"
            ? "当前项目记忆"
            : `${selectedEngineKey.toUpperCase()} Agent 专属记忆`;
      if (confirm(`确定要清空全部「${scopeLabel}」吗？此操作不可撤销。`)) {
        clearAllInScope(activeTab, activeTarget);
      }
    };

    const selectedEngineObj = CCGUI_SUPPORTED_ENGINES.find(
      (e) => e.key === selectedEngineKey,
    );
    const selectedEngineDisplay = selectedEngineObj
      ? selectedEngineObj.label
      : selectedEngineKey.toUpperCase();

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
            h(BrainIcon, { size: 18, style: { marginRight: "8px" } }),
            "长期记忆管理",
          ),
        ),
        h(
          "p",
          { className: "pm-desc" },
          "分层管理全局通用偏好、项目专属规则以及各 Agent 引擎的独享习惯。发送消息时根据当前会话精准隔离注入。",
        ),
      ),

      // Controls Bar: Tabs & Selectors (顺序：全局通用偏好 -> 项目专属记忆 -> Agent 专属记忆)
      h(
        "div",
        { className: "pm-controls-bar" },
        h(
          "div",
          { className: "pm-tabs" },
          h(
            "button",
            {
              className: `pm-tab-btn ${activeTab === "global" ? "active" : ""}`,
              onClick: () => setActiveTab("global"),
            },
            "🌐 全局通用偏好",
            h("span", { className: "pm-tab-count" }, globalEntries.length),
          ),
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
              className: `pm-tab-btn ${activeTab === "agent" ? "active" : ""}`,
              onClick: () => setActiveTab("agent"),
            },
            "🤖 Agent 专属记忆",
            h("span", { className: "pm-tab-count" }, agentEntries.length),
          ),
        ),

        // 项目工作区选择器 (在项目 Tab 显示)
        activeTab === "project" &&
          h(
            "div",
            { className: "pm-project-selector" },
            h(
              "span",
              { style: { color: "var(--color-text-secondary, #71717a)" } },
              "选择工作区：",
            ),
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

        // Agent 引擎选择器 (在 Agent Tab 显示，汇聚 CC-GUI 全部 13 种支持的引擎)
        activeTab === "agent" &&
          h(
            "div",
            { className: "pm-project-selector" },
            h(
              "span",
              { style: { color: "var(--color-text-secondary, #71717a)" } },
              "CC-GUI 支持的 Agent / 引擎：",
            ),
            h(
              "select",
              {
                className: "pm-select",
                value: selectedEngineKey,
                onChange: (e) => setSelectedEngineKey(e.target.value),
              },
              engineOptions.map((opt) =>
                h(
                  "option",
                  { key: opt.key, value: opt.key },
                  `${opt.label} (${opt.count}条)${opt.isActive ? " ★当前激活" : ""}`,
                ),
              ),
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
              h(
                "div",
                { className: "pm-empty-icon" },
                h(BrainIcon, { size: 36 }),
              ),
              h(
                "div",
                { className: "pm-empty-title" },
                activeTab === "global"
                  ? "暂无全局通用偏好"
                  : activeTab === "project"
                    ? "暂无当前项目记忆"
                    : `暂无 ${selectedEngineDisplay} 的专属记忆`,
              ),
              h(
                "div",
                { className: "pm-empty-hint" },
                activeTab === "global"
                  ? "在对话中直接告诉 AI：“请记住：回答始终使用中文、代码优先使用 TS”，或在下方手动添加跨工作区通用的个人偏好。"
                  : activeTab === "project"
                    ? "在对话中直接告诉 AI：“请记住：本项目构建命令是 pnpm build”，或在下方添加仅在当前工作区生效的记忆。"
                    : `在此为 ${selectedEngineDisplay} 添加专有调用规范（如调用工具前说明、任务执行流程等）。该记忆仅在当前会话使用该引擎时生效，绝不影响其他 Agent。`,
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
                        className: `pm-scope-badge ${activeTab === "project" ? "project" : activeTab === "agent" ? "agent" : ""}`,
                      },
                      activeTab === "global"
                        ? "全局通用"
                        : activeTab === "project"
                          ? "项目专属"
                          : `${selectedEngineKey.toUpperCase()} 专属`,
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
                          deleteMemory(activeTab, activeTarget, item.id),
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
          activeTab === "global"
            ? "手动新增全局通用偏好"
            : activeTab === "project"
              ? "手动新增项目专属记忆"
              : `手动新增 ${selectedEngineDisplay} 专属记忆`,
        ),
        h("textarea", {
          className: "pm-textarea",
          rows: 3,
          placeholder:
            activeTab === "global"
              ? "添加全局通用偏好，如：回答始终使用中文、代码优先使用 TypeScript..."
              : activeTab === "project"
                ? "添加本项目专属记忆，如：启动命令是 pnpm dev、禁止直接在 test 分支提交..."
                : `添加仅对 ${selectedEngineDisplay} 生效的规范，如：调用工具前先简述说明、交付时附带验证结果...`,
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
    label: () => "长期记忆",
    icon: BrainIcon,
    component: SettingsMemoryPage,
  });

  // ── UI: 最底部的底栏状态栏条目 ────────────────────────────────────────────────
  function MemoryStatusBarItem() {
    const [counts, setCounts] = useState({
      global: state.global.length,
      project: getProjectEntries(state.activeWs).length,
      agent: getAgentEntries(state.activeEngine).length,
      activeWs: state.activeWs,
      activeEngine: state.activeEngine,
    });

    useEffect(() => {
      const listener = (s) => {
        setCounts({
          global: s.global.length,
          project: getProjectEntries(s.activeWs).length,
          agent: getAgentEntries(s.activeEngine).length,
          activeWs: s.activeWs,
          activeEngine: s.activeEngine,
        });
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []);

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

    const total = counts.global + counts.project + counts.agent;

    return h(
      "button",
      {
        className: `pm-status-bar-chip ${total > 0 ? "has-entries" : ""}`,
        title: `长期记忆（点击进入设置）：\n- 全局通用偏好：${counts.global} 条\n- 本项目专属记忆：${counts.project} 条\n- 当前 Agent (${counts.activeEngine.toUpperCase()}) 专属记忆：${counts.agent} 条\n- 当前工作区：${counts.activeWs || "默认"}`,
        onClick: () => {
          try {
            ctx.ui.openSettings?.("memory");
          } catch (err) {
            console.error("[project-memory] openSettings error:", err);
          }
        },
      },
      h(BrainIcon, { size: 13, style: { marginRight: "5px" } }),
      `全局 ${counts.global} · 项目 ${counts.project} · Agent ${counts.agent}`,
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
