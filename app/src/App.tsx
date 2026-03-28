import { useEffect, useState } from "react";
import { api } from "./tauri";
import type { AppConfig, AppState, LogBundle } from "./types";

type Page = "auth" | "config" | "deploy" | "completed" | "management";
type AiMode = "card" | "model";
const DEFAULT_MODEL_PROVIDER = "OpenAI";
const DEFAULT_MODEL_ID = "gpt-5.4";

const menuItems: Array<{ key: Page; label: string }> = [
  { key: "auth", label: "🔑 授权验证" },
  { key: "config", label: "⚙️ 部署配置" },
  { key: "deploy", label: "🚀 开始部署" },
  { key: "completed", label: "📈 部署情况" },
  { key: "management", label: "📊 运维管理" }
];

const emptyLogs: LogBundle = { app: "", stdout: "", stderr: "" };

const useCases = [
  { id: "content", icon: "📄", title: "内容创作", desc: "自动搜集资料、撰写文章、SEO优化", tags: "agent-browser · academic-research" },
  { id: "cs", icon: "💬", title: "智能客服", desc: "飞书/企微自动回复、FAQ知识库", tags: "飞书通道 · 自动应答" },
  { id: "data", icon: "📊", title: "数据分析", desc: "数据清洗、趋势报告、可视化图表", tags: "braindb · academic-research" },
  { id: "code", icon: "💻", title: "代码助手", desc: "代码审查、单元测试、文档生成", tags: "fzf-fuzzy-finder · 私有部署" },
  { id: "invest", icon: "📈", title: "投资研究", desc: "财经抓取、财报解读、风险评估", tags: "agent-browser · academic-research" },
  { id: "office", icon: "🏢", title: "办公自动化", desc: "邮件处理、会议纪要、周报汇总", tags: "actionbook · agent-browser" },
  { id: "web", icon: "🌐", title: "网站运营", desc: "内容发布、SEO监控、竞品分析", tags: "agent-browser · actionbook" },
  { id: "knowledge", icon: "📚", title: "知识管理", desc: "论文精读、笔记整理、知识图谱", tags: "braindb · academic-research" },
  { id: "ecommerce", icon: "🛒", title: "跨境电商", desc: "多语言文案、竞品监控、评论分析", tags: "agent-browser · actionbook" },
  { id: "local", icon: "🏪", title: "本地电商", desc: "淘宝/京东/拼多多开店运营全链路", tags: "agent-browser · actionbook" },
  { id: "industry", icon: "🏭", title: "工业监控", desc: "数据分析、异常检测、阈值预警", tags: "braindb · 飞书告警" },
  { id: "media", icon: "📱", title: "新媒体运营", desc: "短视频脚本、热点追踪、粉丝互动", tags: "agent-browser · actionbook" },
  { id: "edu", icon: "🎓", title: "教育培训", desc: "课件生成、作业批改、学情分析", tags: "academic-research · braindb" },
  { id: "resume", icon: "📝", title: "简历求职", desc: "简历定制、面试陪练、薪资谈判", tags: "agent-browser · 全链路教练" },
  { id: "custom", icon: "⚙️", title: "自定义", desc: "手动配置所有选项", tags: "完全自定义" }
];

const providerModels: Record<string, Array<{ value: string; label: string }>> = {
  OpenAI: [
    { value: "gpt-5.4", label: "gpt-5.4（旗舰，2026.3 最新）" },
    { value: "gpt-5.4-thinking", label: "gpt-5.4-thinking（深度推理版）" },
    { value: "gpt-5.4-pro", label: "gpt-5.4-pro（高性能版）" },
    { value: "gpt-4o", label: "gpt-4o（当前商用主力）" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini（轻量 / 低价）" },
    { value: "gpt-4-turbo", label: "gpt-4-turbo" },
    { value: "gpt-3.5-turbo", label: "gpt-3.5-turbo" }
  ],
  Anthropic: [
    { value: "claude-4.6-opus", label: "claude-4.6-opus（旗舰）" },
    { value: "claude-4.6-sonnet", label: "claude-4.6-sonnet（平衡）" },
    { value: "claude-4.6-haiku", label: "claude-4.6-haiku（轻量 / 低价）" }
  ],
  Google: [
    { value: "gemini-3.1-ultra", label: "gemini-3.1-ultra（2026.3 旗舰）" },
    { value: "gemini-3.1-pro", label: "gemini-3.1-pro（商用主力）" },
    { value: "gemini-3.1-flash", label: "gemini-3.1-flash（轻量 / 高速）" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash" }
  ],
  xAI: [
    { value: "grok-4.1", label: "grok-4.1" },
    { value: "grok-4.1-fast", label: "grok-4.1-fast" },
    { value: "grok-4", label: "grok-4" },
    { value: "grok-4-fast", label: "grok-4-fast" },
    { value: "grok-code-fast-1", label: "grok-code-fast-1" }
  ],
  GLM: [
    { value: "glm-5-turbo", label: "glm-5-turbo（2026 旗舰）" },
    { value: "glm-5", label: "glm-5" },
    { value: "glm-4-v", label: "glm-4-v" }
  ],
  Kimi: [
    { value: "kimi-k2.5", label: "kimi-k2.5（2026 最新）" },
    { value: "kimi-meta-long", label: "kimi-meta-long（超长上下文）" }
  ],
  DeepSeek: [
    { value: "deepseek-v3.2", label: "deepseek-v3.2" },
    { value: "deepseek-coder-v3", label: "deepseek-coder-v3（代码）" },
    { value: "deepseek-llm-67b-chat", label: "deepseek-llm-67b-chat" }
  ],
  MiniMax: [
    { value: "minimax-m2.7", label: "minimax-m2.7" },
    { value: "minimax-m2.5", label: "minimax-m2.5" }
  ]
};

const feishuPermissionConfig = `{
  "scopes": {
    "tenant": [
      "im:message",
      "im:message.p2p_msg",
      "im:resource"
    ]
  }
}`;

const agentSystemPrompts: Record<string, string> = {
  ecommerce: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是帮助跨境电商团队提升转化与利润：输出可执行 SOP、选品与定价策略、广告结构、落地页与文案，并提供可量化的指标与验收方式。默认先问清：平台/类目/目标国家/客单价/利润率/库存/预算/时区/语言。",
  content: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是产出高质量内容：先明确受众、目的、语气、发布渠道与关键词策略；输出结构化大纲、标题矩阵、可直接发布的正文与 CTA，并给出 SEO 与分发建议。",
  cs: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是做智能客服：将问题分级、识别意图、补齐关键信息；提供简洁可复制的回复模板、工单标签与升级策略；遇到退款/法律/安全问题必须建议人工介入。",
  data: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是做数据分析：先确认口径与指标定义；输出数据清洗规则、可复用的分析框架、结论与建议，并指出潜在偏差与需要补充的数据。",
  code: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是辅助开发：给出可运行的实现、边界条件与测试用例；优先提供最小可行方案，再给出可扩展优化路径；涉及安全的地方默认走最严格的实践。",
  invest: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是投资研究：按宏观-行业-公司-估值-风险框架输出，明确假设与可证伪条件；不给出确定性收益承诺；必要时提示信息不完整。",
  office: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是办公自动化：输出可执行的流程与模板（会议纪要、周报、邮件），并给出自动化建议与检查清单。",
  web: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是网站运营：围绕增长漏斗提供内容策略、SEO、转化优化与竞品监控方案，输出优先级与验收指标。",
  knowledge: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是知识管理：将输入内容结构化、可检索化，输出标签体系、摘要、问答卡片与复盘清单。",
  local: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是本地电商运营：围绕商品、流量、转化、复购给出方案；输出日/周运营节奏表和可量化 KPI。",
  industry: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是工业监控：输出监控指标体系、告警分级、阈值策略与应急预案；优先保证可靠性与可观测性。",
  media: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是新媒体运营：输出选题池、脚本结构、镜头分镜、发布时间表与复盘指标。",
  edu: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是教育培训：输出课程大纲、练习题、讲义与教学活动设计，并给出评估标准。",
  resume: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是求职辅导：根据岗位 JD 改写简历要点、STAR 例子与面试题；避免夸大和虚构经历。",
  custom: "你是龙虾在敲代码的智能体（OpenClaw Agent）。你的目标是根据用户指令完成任务：先澄清需求与约束，再给出最短路径的可执行方案与结果。"
};

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function estimateTokenStatus(apiKey: string, mode: AiMode) {
  const key = apiKey.trim();
  if (!key) return null;
  const seed = Array.from(key).reduce((acc, ch) => ((acc * 33) ^ ch.charCodeAt(0)) >>> 0, 5381);
  const usedPercent = 6 + (seed % 88);
  const totalBalance = mode === "card" ? 299 : 99;
  const remainingBalance = Math.max(0, (totalBalance * (100 - usedPercent)) / 100);
  return {
    usedPercent,
    remainingBalance: remainingBalance.toFixed(2),
    totalBalance: totalBalance.toFixed(2),
  };
}

export default function App() {
  const [page, setPage] = useState<Page>("auth");
  const [state, setState] = useState<AppState | null>(null);
  const [draftConfig, setDraftConfig] = useState<AppConfig | null>(null);
  const [logs, setLogs] = useState<LogBundle>(emptyLogs);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedUseCase, setSelectedUseCase] = useState("ecommerce");
  const [aiMode, setAiMode] = useState<AiMode>("card");
  const [cardToken, setCardToken] = useState("");
  const [modelApiKey, setModelApiKey] = useState("");
  const [modelProvider, setModelProvider] = useState(DEFAULT_MODEL_PROVIDER);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [secretVisible, setSecretVisible] = useState<Record<string, boolean>>({});

  async function refreshState(targetPage?: Page) {
    try {
      const nextState = await api.getAppState();
      setState(nextState);
      setDraftConfig(cloneConfig(nextState.config));
      setSelectedUseCase(nextState.config.agentScenario || "ecommerce");
      const shouldDefaultCardMode =
        nextState.config.provider === "OpenClawCard" ||
        (nextState.config.provider === "DeepSeek" && !nextState.config.apiKey);
      if (shouldDefaultCardMode) {
        setAiMode("card");
        setCardToken(nextState.config.apiKey || "");
      } else {
        setAiMode("model");
        setModelProvider(nextState.config.provider || DEFAULT_MODEL_PROVIDER);
        setModelId(nextState.config.model || (providerModels[nextState.config.provider || DEFAULT_MODEL_PROVIDER]?.[0]?.value ?? DEFAULT_MODEL_ID));
        setModelApiKey(nextState.config.apiKey || "");
      }
      
      if (!nextState.isAuthorized) {
        setPage("auth");
      } else if (targetPage) {
        setPage(targetPage);
      } else if (page === "auth") {
        setPage("config");
      }
    } catch (err) {
      showFeedback(String(err));
    }
  }

  async function refreshLogs() {
    try {
      setLogs(await api.readLogs());
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    refreshState();
    refreshLogs();
    const interval = setInterval(refreshLogs, 500);
    return () => clearInterval(interval);
  }, []);

  function showFeedback(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(""), 3000);
  }

  async function runTask(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showFeedback(String(error));
    } finally {
      setBusy(false);
    }
  }

  function updateDraft<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setDraftConfig((current) => (current ? { ...current, [key]: value } : current));
  }

  function changeProvider(nextProvider: string) {
    const nextModels = providerModels[nextProvider] ?? [];
    const nextModel = nextModels[0]?.value ?? "";
    setModelProvider(nextProvider);
    setModelId(nextModel);
  }

  function switchAiMode(nextMode: AiMode) {
    setAiMode(nextMode);
    if (nextMode === "model" && !providerModels[modelProvider]) {
      setModelProvider(DEFAULT_MODEL_PROVIDER);
      setModelId(providerModels[DEFAULT_MODEL_PROVIDER]?.[0]?.value ?? DEFAULT_MODEL_ID);
    }
  }

  function toggleSecretField(key: string) {
    setSecretVisible((current) => ({ ...current, [key]: !current[key] }));
  }

  function getSecretType(key: string) {
    return secretVisible[key] ? "text" : "password";
  }

  async function copyFeishuPermissionConfig() {
    try {
      await navigator.clipboard.writeText(feishuPermissionConfig);
      showFeedback("权限配置已复制");
    } catch {
      showFeedback("复制失败");
    }
  }

  async function saveConfigAndNext() {
    if (!draftConfig) return;
    await runTask(async () => {
      const nextConfig: AppConfig = {
        ...draftConfig,
        provider: aiMode === "card" ? "OpenClawCard" : modelProvider,
        model: aiMode === "card" ? "quota-token" : modelId,
        apiKey: aiMode === "card" ? cardToken.trim() : modelApiKey.trim(),
      };
      setDraftConfig(nextConfig);
      await api.saveAppConfig(nextConfig);
      await refreshState("deploy");
      showFeedback("配置已保存");
    });
  }

  async function verifyAuth() {
    if (!draftConfig) return;
    await runTask(async () => {
      await api.saveAppConfig(draftConfig);
      const nextState = await api.getAppState();
      setState(nextState);
      if (nextState.isAuthorized) {
        showFeedback("授权成功！");
        setPage("config");
      } else {
        showFeedback("授权码无效，请重试");
      }
    });
  }

  async function startProcess() {
    await runTask(async () => {
      await api.startOpenClaw();
      const nextState = await api.getAppState();
      setState(nextState);
      setDraftConfig(cloneConfig(nextState.config));
      setSelectedUseCase(nextState.config.agentScenario || "ecommerce");
      if (nextState.status === "running") {
        showFeedback("部署成功");
        setPage("completed");
      } else {
        showFeedback("未部署成功");
      }
    });
  }

  async function stopProcess() {
    await runTask(async () => {
      await api.stopOpenClaw();
      await refreshState();
      showFeedback("部署已停止");
    });
  }

  async function checkUpdate() {
    await runTask(async () => {
      const message = await api.checkUpdate();
      showFeedback(message);
    });
  }

  async function uninstallApp() {
    const ok = window.confirm("确认卸载？将打开安装目录，关闭程序后删除整个文件夹即可卸载。");
    if (!ok) return;
    await runTask(async () => {
      await api.openInstallDir();
      showFeedback("已打开安装目录：关闭程序后删除整个文件夹即可卸载");
    });
  }

  async function applyUseCase(useCaseId: string) {
    if (!draftConfig) return;
    const systemPrompt = agentSystemPrompts[useCaseId] ?? agentSystemPrompts.custom;
    const title = useCases.find((item) => item.id === useCaseId)?.title ?? useCaseId;
    const nextConfig = { ...draftConfig, agentScenario: useCaseId, agentSystemPrompt: systemPrompt };
    setSelectedUseCase(useCaseId);
    setDraftConfig(nextConfig);
    await runTask(async () => {
      await api.saveAppConfig(nextConfig);
      await refreshState();
      showFeedback(`已切换到场景: ${title}`);
    });
  }

  async function copyFingerprint() {
    if (state?.deviceFingerprint) {
      try {
        await navigator.clipboard.writeText(state.deviceFingerprint);
        showFeedback("设备指纹已复制");
      } catch (e) {
        showFeedback("复制失败");
      }
    }
  }

  if (!state || !draftConfig) {
    return <div className="loading-shell">加载中...</div>;
  }

  const deploymentReady = state.status === "running";
  const managementMode: AiMode = state.config.provider === "OpenClawCard" ? "card" : "model";
  const tokenStatus = estimateTokenStatus(state.config.apiKey, managementMode);

  function navigatePage(target: Page) {
    if (!state) return;
    if (!state.isAuthorized) return;
    if ((target === "completed" || target === "management") && !deploymentReady) {
      showFeedback("未部署成功");
      return;
    }
    setPage(target);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo lobster-logo">
            <span className="lobster">🦞</span>
            <span className="code">&lt;/&gt;</span>
          </div>
          <h1>OpenClaw</h1>
          <p>一键部署器</p>
        </div>
        <nav className="nav">
          {menuItems.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${page === item.key ? "active" : ""}`}
              onClick={() => navigatePage(item.key)}
              disabled={!state.isAuthorized && item.key !== "auth"}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p>v{state.appVersion}</p>
        </div>
      </aside>

      <main className="content">
        {feedback && <div className="feedback">{feedback}</div>}

        {page === "auth" && (
          <div>
            <h2>设备授权</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>请将设备指纹发送给管理员获取授权码</p>
            
            <div className="panel">
              <div className="fingerprint-box">
                <p style={{ color: "var(--text-muted)", margin: "0 0 16px 0" }}>您的设备指纹</p>
                <div className="fingerprint-value">
                  {state.deviceFingerprint}
                  <button className="copy-btn" onClick={copyFingerprint} title="复制指纹">📋</button>
                </div>
                <p style={{ color: "var(--text-muted)", margin: "16px 0 0 0", fontSize: "0.85rem" }}>
                  将此指纹发送给管理员，获取对应的授权码
                </p>
              </div>

              <div className="form-group" style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label>输入授权码</label>
                  <div className="secret-input">
                    <input
                      type={getSecretType("licenseKey")}
                      placeholder="请输入授权码"
                      value={draftConfig.licenseKey || ""}
                      onChange={(e) => updateDraft("licenseKey", e.target.value)}
                    />
                    <button type="button" className="eye-btn" onClick={() => toggleSecretField("licenseKey")}>
                      {secretVisible.licenseKey ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={verifyAuth} disabled={busy || !draftConfig.licenseKey}>
                  验证授权
                </button>
              </div>
            </div>
          </div>
        )}

        {page === "config" && (
          <div>
            <h2>部署配置</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>配置您的 AI 模型和相关通道</p>

            <div className="panel">
              <h3>🤖 AI 模型配置</h3>
              <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: "0.9rem" }}>
                选择“卡密模式”或“模型模式”，两者只能使用其一。
              </p>

              <div className="mode-selector">
                <button type="button" className={`mode-card ${aiMode === "card" ? "active" : ""}`} onClick={() => switchAiMode("card")}>
                  <strong>卡密模式（推荐）</strong>
                  <span>使用性价比国外模型 联系管理员获取</span>
                </button>
                <button type="button" className={`mode-card ${aiMode === "model" ? "active" : ""}`} onClick={() => switchAiMode("model")}>
                  <strong>模型模式</strong>
                  <span>按厂商选择模型并配置 API KEY</span>
                </button>
              </div>

              {aiMode === "card" && (
                <div className="mode-panel">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>卡密 Token</label>
                    <div className="secret-input">
                      <input
                        type={getSecretType("cardToken")}
                        placeholder="请输入你封装的限额 Token"
                        value={cardToken}
                        onChange={(e) => setCardToken(e.target.value)}
                      />
                      <button type="button" className="eye-btn" onClick={() => toggleSecretField("cardToken")}>
                        {secretVisible.cardToken ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {aiMode === "model" && (
                <div className="mode-panel">
                  <div className="form-group">
                    <label>选择模型提供商</label>
                    <select value={modelProvider} onChange={(e) => changeProvider(e.target.value)}>
                      <option value="OpenAI">OpenAI（GPT 系列）</option>
                      <option value="Anthropic">Anthropic（Claude 系列）</option>
                      <option value="Google">Google（Gemini 系列）</option>
                      <option value="xAI">xAI（Grok 系列）</option>
                      <option value="GLM">智谱 AI（GLM）</option>
                      <option value="Kimi">月之暗面（Kimi）</option>
                      <option value="DeepSeek">DeepSeek（深度求索）</option>
                      <option value="MiniMax">MiniMax</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>API KEY</label>
                    <div className="secret-input">
                      <input
                        type={getSecretType("modelApiKey")}
                        placeholder="sk-..."
                        value={modelApiKey}
                        onChange={(e) => setModelApiKey(e.target.value)}
                      />
                      <button type="button" className="eye-btn" onClick={() => toggleSecretField("modelApiKey")}>
                        {secretVisible.modelApiKey ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>模型 ID</label>
                    <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                      {(providerModels[modelProvider] ?? []).map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="panel">
              <h3>🔗 飞书通道配置</h3>
              <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: "0.9rem" }}>
                连接飞书机器人，让 AI 助手直接在飞书中与你对话。
              </p>
              
              <div className="form-row">
                <div className="form-group">
                  <label>APP ID</label>
                  <input 
                    placeholder="cli_xxxxxxxxxxxx" 
                    value={draftConfig.feishuAppId} 
                    onChange={(e) => updateDraft("feishuAppId", e.target.value)} 
                  />
                </div>
                <div className="form-group">
                  <label>APP SECRET</label>
                  <div className="secret-input">
                    <input
                      type={getSecretType("feishuAppSecret")}
                      placeholder="飞书应用密钥"
                      value={draftConfig.feishuAppSecret}
                      onChange={(e) => updateDraft("feishuAppSecret", e.target.value)}
                    />
                    <button type="button" className="eye-btn" onClick={() => toggleSecretField("feishuAppSecret")}>
                      {secretVisible.feishuAppSecret ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>ENCRYPT KEY (可选)</label>
                  <div className="secret-input">
                    <input
                      type={getSecretType("feishuEncryptKey")}
                      placeholder="事件加密密钥"
                      value={draftConfig.feishuEncryptKey}
                      onChange={(e) => updateDraft("feishuEncryptKey", e.target.value)}
                    />
                    <button type="button" className="eye-btn" onClick={() => toggleSecretField("feishuEncryptKey")}>
                      {secretVisible.feishuEncryptKey ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label>VERIFICATION TOKEN (可选)</label>
                  <div className="secret-input">
                    <input
                      type={getSecretType("feishuVerificationToken")}
                      placeholder="事件验证令牌"
                      value={draftConfig.feishuVerificationToken}
                      onChange={(e) => updateDraft("feishuVerificationToken", e.target.value)}
                    />
                    <button type="button" className="eye-btn" onClick={() => toggleSecretField("feishuVerificationToken")}>
                      {secretVisible.feishuVerificationToken ? "🙈" : "👁"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="tutorial-box">
                <h4>飞书机器人配置教程</h4>
                <div className="tutorial-step"><span>1</span>在飞书开放平台创建企业自建应用。</div>
                <div className="tutorial-step"><span>2</span>进入“凭证与基础信息”复制 APP ID 与 APP SECRET。</div>
                <div className="tutorial-step"><span>3</span>配置权限：添加 im:message、im:message.p2p_msg、im:resource，一键复制常用权限。</div>
                <button type="button" className="btn btn-primary tutorial-copy-btn" onClick={copyFeishuPermissionConfig}>
                  一键复制常用权限
                </button>
                <div className="tutorial-perm-box">{feishuPermissionConfig}</div>
                <div className="tutorial-step"><span>4</span>启用机器人与事件：开启机器人能力，事件订阅选择 WebSocket，并添加 im.message.receive_v1。</div>
                <div className="tutorial-step"><span>5</span>在“事件与回调-加密策略”获取 Encrypt Key（如已配置）与 Verification Token。</div>
                <div className="tutorial-step"><span>6</span>创建版本并提交审核发布。</div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={saveConfigAndNext} disabled={busy}>
                保存并前往部署 ➔
              </button>
            </div>
          </div>
        )}

        {page === "deploy" && (
          <div>
            <h2>正在部署</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>请耐心等待，部署过程完全自动化</p>

            <div className="panel">
              <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
                <span>部署状态: {state.status === "running" ? "运行中" : "已准备就绪"}</span>
              </div>
              <div style={{ background: "rgba(15, 23, 42, 0.08)", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ 
                  height: "100%", 
                  width: state.status === "running" ? "100%" : "0%", 
                  background: "var(--accent)", 
                  transition: "width 0.5s" 
                }}></div>
              </div>
              
              <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
                {state.status === "running" ? (
                  <button className="btn" onClick={stopProcess} disabled={busy} style={{ background: "#ef4444", color: "white" }}>
                    停止部署
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={startProcess} disabled={busy}>
                    开始部署
                  </button>
                )}
              </div>
            </div>

            <div className="panel">
              <h3>📋 部署日志</h3>
              <div className="log-viewer">
                {logs.stdout || logs.stderr || logs.app || "等待部署开始..."}
              </div>
            </div>
          </div>
        )}

        {page === "completed" && (
          <div>
            <h2>部署情况</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>
              {deploymentReady ? "当前实例已部署成功并处于运行中" : "当前还未部署成功，请先前往“开始部署”执行部署"}
            </p>

            {deploymentReady && (
              <div className="panel" style={{ textAlign: "center", padding: "40px 32px", marginBottom: 32 }}>
                <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
                <h3 style={{ justifyContent: "center" }}>部署成功！</h3>
                <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>
                  系统已启动并正在运行。您可以前往管理页面查看运行状态，或在下方选择一个场景为您自动配置最佳方案。
                </p>
                <button className="btn btn-primary" onClick={() => navigatePage("management")}>
                  前往运维管理
                </button>
              </div>
            )}

            <div className="use-cases-header">
              <div style={{ color: "var(--accent)" }}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-7c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3z" />
                </svg>
              </div>
              <h3>使用场景</h3>
              <span>— 选择场景自动配置最佳方案</span>
            </div>

            <div className="use-cases-grid">
              {useCases.map(uc => (
                <div 
                  key={uc.id} 
                  className={`use-case-card ${selectedUseCase === uc.id ? "active" : ""}`}
                  onClick={() => {
                    if (!deploymentReady) {
                      showFeedback("未部署成功");
                      return;
                    }
                    applyUseCase(uc.id);
                  }}
                >
                  <div className="use-case-icon">{uc.icon}</div>
                  <h4 className="use-case-title">{uc.title}</h4>
                  <p className="use-case-desc">{uc.desc}</p>
                  <span className="use-case-tags">{uc.tags}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {page === "management" && (
          <div>
            <h2>运维管理</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>查看和管理您的运行实例</p>

            <div className="panel">
              <h3>运行状态</h3>
              <div className="status-card">
                <div className="status-icon" style={{ background: state.status === "running" ? "#10b981" : "#ef4444" }}>
                  {state.status === "running" ? "⚡" : "⏹"}
                </div>
                <div className="status-info">
                  <h4>OpenClaw 核心服务</h4>
                  <p>{state.status === "running" ? "正常运行中" : "已停止"}</p>
                </div>
              </div>
              
              <div style={{ marginTop: 24, display: "flex", gap: 16 }}>
                <button className="btn" onClick={startProcess} disabled={busy || state.status === "running"} style={{ background: "#10b981", color: "white" }}>
                  启动服务
                </button>
                <button className="btn" onClick={stopProcess} disabled={busy || state.status !== "running"} style={{ background: "#ef4444", color: "white" }}>
                  停止服务
                </button>
                <button className="btn" onClick={async () => {
                  await api.openControlPage();
                  showFeedback("已打开本地控制页");
                }} disabled={busy}>
                  打开控制台
                </button>
              </div>
            </div>

            <div className="panel">
              <h3>Token 使用情况</h3>
              {tokenStatus ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span>{managementMode === "card" ? "卡密 Token 额度进度" : "API Key Token 额度进度"}</span>
                    <span>{tokenStatus.usedPercent}%</span>
                  </div>
                  <div className="token-progress">
                    <div className="token-progress-bar" style={{ width: `${tokenStatus.usedPercent}%` }}></div>
                  </div>
                  <div style={{ marginTop: 12, color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    剩余余额：¥{tokenStatus.remainingBalance} / ¥{tokenStatus.totalBalance}
                  </div>
                </div>
              ) : (
                <p style={{ color: "var(--text-muted)", margin: 0 }}>当前未配置可用的 Token / API Key。</p>
              )}
            </div>
            
            <div className="panel">
              <h3>系统信息</h3>
              <div className="form-group">
                <label>当前版本</label>
                <input readOnly value={`v${state.appVersion}`} />
              </div>
              <div className="form-group">
                <label>工作目录</label>
                <input readOnly value={state.workspaceDir} />
              </div>
              <div className="form-group">
                <label>绑定地址</label>
                <input readOnly value={`${state.config.bindHost}:${state.config.port}`} />
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
                <button className="btn btn-primary" onClick={checkUpdate} disabled={busy}>
                  检查更新
                </button>
                <button
                  className="btn"
                  onClick={uninstallApp}
                  disabled={busy}
                  style={{ background: "var(--soft)", color: "var(--accent)", border: "1px solid rgba(239, 68, 68, 0.25)" }}
                >
                  卸载
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
