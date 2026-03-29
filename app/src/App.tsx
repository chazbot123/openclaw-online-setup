import { useEffect, useState } from "react";
import { api } from "./tauri";
import type { AppConfig, AppState, DeployEvent, DeploySnapshot, EnvItem, GatewayLogs, GatewayStatus } from "./types";
import { listen } from "@tauri-apps/api/event";

type Page = "auth" | "config" | "deploy" | "completed" | "management";
type AiMode = "card" | "model";
const DEFAULT_MODEL_PROVIDER = "OpenAI";
const PROVIDER_FIXED_MODEL: Record<string, string> = {
  OpenAI: "gpt-4o-mini",
  Anthropic: "claude-3-7-sonnet-latest",
  Google: "gemini-2.5-flash",
  xAI: "grok-3-mini-fast",
  GLM: "zai/glm-5-turbo",
  Kimi: "k2p5",
  DeepSeek: "deepseek-chat",
  MiniMax: "MiniMax-M2.7-highspeed",
};
const DEFAULT_MODEL_ID = PROVIDER_FIXED_MODEL[DEFAULT_MODEL_PROVIDER];

const menuItems: Array<{ key: Page; label: string }> = [
  { key: "auth", label: "🔑 授权验证" },
  { key: "config", label: "⚙️ 部署配置" },
  { key: "deploy", label: "🧰 安装环境" },
  { key: "completed", label: "📈 部署情况" },
  { key: "management", label: "📊 运维管理" }
];

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

function inferProviderFromModelId(model: string): string | null {
  const lower = (model || "").toLowerCase().trim();
  if (!lower) return null;
  if (lower.includes("/")) {
    const [provider] = lower.split("/", 2);
    if (provider === "openai") return "OpenAI";
    if (provider === "anthropic") return "Anthropic";
    if (provider === "google" || provider === "gemini") return "Google";
    if (provider === "xai" || provider === "grok") return "xAI";
    if (provider === "glm" || provider === "zhipuai" || provider === "bigmodel") return "GLM";
    if (provider === "kimi" || provider === "moonshot") return "Kimi";
    if (provider === "deepseek") return "DeepSeek";
    if (provider === "minimax") return "MiniMax";
  }
  if (lower.startsWith("gpt-")) return "OpenAI";
  if (lower.startsWith("claude-")) return "Anthropic";
  if (lower.startsWith("gemini-")) return "Google";
  if (lower.startsWith("grok-")) return "xAI";
  if (lower.startsWith("glm-")) return "GLM";
  if (lower.startsWith("kimi-") || lower.startsWith("moonshot-")) return "Kimi";
  if (lower.startsWith("deepseek-")) return "DeepSeek";
  if (lower.startsWith("minimax-")) return "MiniMax";
  return null;
}

function normalizeProvider(provider: string, model: string) {
  if (PROVIDER_FIXED_MODEL[provider]) return provider;
  const inferred = inferProviderFromModelId(model);
  if (inferred && PROVIDER_FIXED_MODEL[inferred]) return inferred;
  return DEFAULT_MODEL_PROVIDER;
}

function fixedModelForProvider(provider: string) {
  return PROVIDER_FIXED_MODEL[provider] || DEFAULT_MODEL_ID;
}

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
  const [envItems, setEnvItems] = useState<EnvItem[]>([]);
  const [deployEvent, setDeployEvent] = useState<DeployEvent | null>(null);
  const [deploySnapshot, setDeploySnapshot] = useState<DeploySnapshot | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [gatewayLogs, setGatewayLogs] = useState<GatewayLogs | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedUseCase, setSelectedUseCase] = useState("ecommerce");
  const [aiMode, setAiMode] = useState<AiMode>("card");
  const [cardToken, setCardToken] = useState("");
  const [modelApiKey, setModelApiKey] = useState("");
  const [modelProvider, setModelProvider] = useState(DEFAULT_MODEL_PROVIDER);
  const [secretVisible, setSecretVisible] = useState<Record<string, boolean>>({});
  const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;

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
        const normalizedProvider = normalizeProvider(nextState.config.provider || DEFAULT_MODEL_PROVIDER, nextState.config.model || "");
        setAiMode("model");
        setModelProvider(normalizedProvider);
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

  async function refreshStateLite() {
    try {
      setState(await api.getAppState());
    } catch (err) {
      showFeedback(String(err));
    }
  }

  async function refreshEnv() {
    try {
      setEnvItems(await api.getEnvStatus());
    } catch (e) {
      showFeedback(String(e));
    }
  }

  async function refreshDeploySnapshot() {
    try {
      const snap = await api.getDeploySnapshot();
      setDeploySnapshot(snap);
      if (snap.lastEvent) {
        setDeployEvent(snap.lastEvent);
      }
    } catch (e) {
      // ignore
    }
  }

  async function refreshGateway() {
    try {
      setGatewayStatus(await api.getGatewayStatus());
      setGatewayLogs(await api.readGatewayLogs());
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    refreshState();
    refreshEnv();
    refreshGateway();
  }, []);

  useEffect(() => {
    if (page === "deploy") {
      refreshEnv();
      refreshDeploySnapshot();
    }
  }, [page]);

  useEffect(() => {
    if (page === "completed") {
      refreshEnv();
      refreshGateway();
    }
  }, [page]);

  useEffect(() => {
    if (page !== "completed") return;
    const interval = setInterval(() => {
      refreshGateway();
    }, 5000);
    return () => clearInterval(interval);
  }, [page]);

  useEffect(() => {
    if (page !== "management") return;
    const interval = setInterval(() => {
      refreshStateLite();
      refreshGateway();
    }, 2000);
    return () => clearInterval(interval);
  }, [page]);

  useEffect(() => {
    if (page !== "deploy") return;
    const interval = setInterval(refreshDeploySnapshot, 400);
    return () => clearInterval(interval);
  }, [page]);

  useEffect(() => {
    if (page !== "deploy") return;
    const last = deploySnapshot?.lastEvent;
    if (!last) return;
    if (last.stepId === "done" && last.status === "success") {
      refreshEnv();
      setPage("completed");
    }
  }, [deploySnapshot, page]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: null | (() => void) = null;
    listen<DeployEvent>("deploy_progress", (event) => {
      setDeployEvent(event.payload);
      setDeploySnapshot((current) => current ? { ...current, lastEvent: event.payload } : current);
      if (event.payload.stepId === "done") {
        refreshEnv();
        showFeedback(event.payload.message);
      }
    }).then((fn) => (unlisten = fn));
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: null | (() => void) = null;
    listen<string>("deploy_output", (event) => {
      setDeploySnapshot((current) => {
        if (!current) return current;
        const next = `${current.output}\n${event.payload}`.trim();
        const lines = next.split("\n");
        const tail = lines.slice(Math.max(0, lines.length - 800)).join("\n");
        return { ...current, output: tail };
      });
    }).then((fn) => (unlisten = fn));
    return () => {
      if (unlisten) unlisten();
    };
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
    setModelProvider(nextProvider);
  }

  function switchAiMode(nextMode: AiMode) {
    setAiMode(nextMode);
    if (nextMode === "model" && !PROVIDER_FIXED_MODEL[modelProvider]) {
      setModelProvider(DEFAULT_MODEL_PROVIDER);
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
      const normalizedProvider = normalizeProvider(modelProvider, "");
      const nextConfig: AppConfig = {
        ...draftConfig,
        provider: aiMode === "card" ? "OpenClawCard" : normalizedProvider,
        model: aiMode === "card" ? "quota-token" : fixedModelForProvider(normalizedProvider),
        apiKey: aiMode === "card" ? cardToken.trim() : modelApiKey.trim(),
      };
      if (aiMode === "model") {
        setModelProvider(normalizedProvider);
      }
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
      setDeployEvent({ stepId: "init", status: "running", message: "开始部署", progress: 0 });
      await refreshDeploySnapshot();
      await api.startDeploy();
    });
  }

  async function startService() {
    await runTask(async () => {
      if (!state) return;
      const message = await api.gatewayStart();
      await refreshState();
      showFeedback(message || "服务已启动");
    });
  }

  async function stopService() {
    await runTask(async () => {
      const message = await api.gatewayStop();
      await refreshState();
      showFeedback(message || "服务已停止");
    });
  }

  async function startWechatLogin() {
    await runTask(async () => {
      const message = await api.wechatStartLogin();
      showFeedback(message || "已打开微信扫码终端");
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

  const serviceRunning = state.status === "running";
  const managementMode: AiMode = state.config.provider === "OpenClawCard" ? "card" : "model";
  const tokenStatus = estimateTokenStatus(state.config.apiKey, managementMode);
  const requiredEnvInstalled = envItems.filter((item) => item.required).length > 0 && envItems.filter((item) => item.required).every((item) => item.installed);
  const deployLast = deploySnapshot?.lastEvent;
  const deploySucceeded = (deployLast?.stepId === "done" && deployLast?.status === "success") || requiredEnvInstalled;
  const gatewayOutput = `${gatewayLogs?.stdout || ""}\n${gatewayLogs?.stderr || ""}`.toLowerCase();
  const feishuConfigured = Boolean(state.config.feishuAppId && state.config.feishuAppSecret);
  const wechatConfigured = Boolean(state.config.wechatEnabled);
  const feishuConnected =
    feishuConfigured &&
    gatewayStatus?.running === true &&
    gatewayOutput.includes("feishu") &&
    (gatewayOutput.includes("connect") || gatewayOutput.includes("ready") || gatewayOutput.includes("启动") || gatewayOutput.includes("已连接"));
  const wechatConnected =
    wechatConfigured &&
    gatewayStatus?.running === true &&
    gatewayOutput.includes("wechat") &&
    (gatewayOutput.includes("login") || gatewayOutput.includes("扫码") || gatewayOutput.includes("connected") || gatewayOutput.includes("已连接"));
  const lockedOpsPage = !deploySucceeded;

  function navigatePage(target: Page) {
    if (!state) return;
    if (!state.isAuthorized) return;
    if ((target === "completed" || target === "management") && lockedOpsPage) {
      showFeedback("未完成部署，暂不可进入部署情况和运维管理");
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
              disabled={
                (!state.isAuthorized && item.key !== "auth") ||
                (state.isAuthorized && (item.key === "completed" || item.key === "management") && lockedOpsPage)
              }
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
                  <span>按厂商使用固定性价比模型并配置 API KEY</span>
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
                    <label>固定模型 ID（已按性价比预设）</label>
                    <input value={fixedModelForProvider(modelProvider)} disabled />
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

            <div className="panel">
              <h3>🟩 微信通道（个人微信）</h3>
              <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: "0.9rem" }}>
                参考 OpenClaw 微信通道教程：先安装频道插件 clawhub install channel-wechat，然后运行 openclaw gateway 扫码登录。
              </p>

              <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="checkbox"
                  checked={Boolean(draftConfig.wechatEnabled)}
                  onChange={(e) => updateDraft("wechatEnabled", e.target.checked)}
                  id="wechat-enabled"
                />
                <label htmlFor="wechat-enabled" style={{ margin: 0 }}>启用个人微信通道</label>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>私聊策略</label>
                  <select value={draftConfig.wechatDmPolicy} onChange={(e) => updateDraft("wechatDmPolicy", e.target.value)}>
                    <option value="pairing">pairing（推荐：配对码激活）</option>
                    <option value="allowlist">allowlist（仅白名单）</option>
                    <option value="open">open（所有人可用）</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>群聊策略</label>
                  <select value={draftConfig.wechatGroupPolicy} onChange={(e) => updateDraft("wechatGroupPolicy", e.target.value)}>
                    <option value="allowlist">allowlist（推荐）</option>
                    <option value="open">open</option>
                    <option value="disabled">disabled</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>配对提示文案</label>
                <input
                  placeholder="请发送配对码以激活 AI 助手"
                  value={draftConfig.wechatPairingMessage}
                  onChange={(e) => updateDraft("wechatPairingMessage", e.target.value)}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>允许群聊（用逗号分隔群名）</label>
                  <input
                    placeholder="AI交流群,技术讨论"
                    value={draftConfig.wechatAllowGroups}
                    onChange={(e) => updateDraft("wechatAllowGroups", e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>群聊触发关键词</label>
                  <input
                    placeholder="@AI"
                    value={draftConfig.wechatTriggerKeyword}
                    onChange={(e) => updateDraft("wechatTriggerKeyword", e.target.value)}
                  />
                </div>
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
            <h2>安装</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>
              {envItems.filter((i) => i.required && !i.installed).length} 个必需组件待安装
            </p>

            <div className="panel">
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ color: "var(--text-muted)" }}>{deployEvent ? deployEvent.message : "点击一键安装开始"}</div>
                <div style={{ fontWeight: 700 }}>{deployEvent ? `${deployEvent.progress}%` : ""}</div>
              </div>
              <div style={{ background: "rgba(15, 23, 42, 0.08)", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ 
                  height: "100%", 
                  width: deployEvent ? `${deployEvent.progress}%` : "0%", 
                  background: "var(--accent)", 
                  transition: "width 0.5s" 
                }}></div>
              </div>
              
              <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
                <button className="btn" onClick={refreshEnv} disabled={busy}>
                  重新检测
                </button>
                <button className="btn btn-primary" onClick={startProcess} disabled={busy}>
                  一键安装
                </button>
              </div>
            </div>

            <div className="panel">
              <h3>组件状态</h3>
              <div style={{ display: "grid", gap: 12 }}>
                {envItems.map((item) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(15, 23, 42, 0.08)", background: "rgba(15, 23, 42, 0.03)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 999, background: item.installed ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)", color: item.installed ? "#10b981" : "#ef4444", fontWeight: 900 }}>
                        {item.installed ? "✓" : "✕"}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700 }}>{item.name}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{item.detail}</div>
                      </div>
                    </div>
                    <div style={{ color: item.installed ? "#10b981" : "#ef4444", fontWeight: 800 }}>
                      {item.installed ? item.version || "已安装" : "未安装"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <h3>安装输出</h3>
              <div className="log-viewer">
                {(deploySnapshot?.output || "").trim() || "等待输出..."}
              </div>
            </div>
          </div>
        )}

        {page === "completed" && (
          <div>
            <h2>部署情况</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
              {deploySucceeded ? (serviceRunning ? "部署成功，服务运行中" : "部署成功，可前往运维管理启动服务") : "尚未完成部署，请先前往“安装环境”完成部署"}
            </p>

            <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{deploySucceeded ? "部署成功" : "部署未完成"}</div>
                <div style={{ color: "var(--text-muted)" }}>{deploySucceeded ? "可以前往运维管理查看状态与日志。" : "请先完成安装并确保已检测到 OpenClaw 运行载荷。"}</div>
              </div>
              <button className="btn btn-primary" onClick={() => navigatePage("management")} disabled={!deploySucceeded}>
                前往运维管理
              </button>
            </div>

            <div className="panel" style={{ marginTop: 20 }}>
              <h3>组件状态</h3>
              <div style={{ display: "grid", gap: 12 }}>
                {envItems.map((item) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(15, 23, 42, 0.08)", background: "rgba(15, 23, 42, 0.03)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 999, background: item.installed ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)", color: item.installed ? "#10b981" : "#ef4444", fontWeight: 900 }}>
                        {item.installed ? "✓" : "✕"}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700 }}>{item.name}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{item.detail}</div>
                      </div>
                    </div>
                    <div style={{ color: item.installed ? "#10b981" : "#ef4444", fontWeight: 800 }}>
                      {item.installed ? item.version || "已安装" : "未安装"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel" style={{ marginTop: 20 }}>
              <h3>通道配置状态</h3>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(15, 23, 42, 0.08)", background: "rgba(15, 23, 42, 0.03)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>飞书</div>
                    <div style={{ color: feishuConnected ? "#10b981" : "#ef4444", fontWeight: 800 }}>
                      {feishuConnected ? "接入成功" : "未接通"}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>
                    {feishuConfigured ? "已填写飞书配置，等待网关实际连通结果。" : "未填写 AppId / AppSecret。"}
                  </div>
                </div>

                <div style={{ padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(15, 23, 42, 0.08)", background: "rgba(15, 23, 42, 0.03)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>个人微信</div>
                    <div style={{ color: wechatConnected ? "#10b981" : "#ef4444", fontWeight: 800 }}>
                      {wechatConnected ? "接入成功" : "未接通"}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>
                    {wechatConfigured ? "已启用微信通道，点击下方按钮弹出二维码终端进行扫码。" : "未启用微信通道。"}
                  </div>
                  {wechatConfigured && (
                    <div style={{ marginTop: 12 }}>
                      <button className="btn btn-primary" onClick={startWechatLogin} disabled={busy}>
                        获取微信二维码
                      </button>
                    </div>
                  )}
                </div>
              </div>
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
                  <p>{gatewayStatus?.running ? "正常运行中" : "已停止"}</p>
                </div>
              </div>
              
              <div style={{ marginTop: 24, display: "flex", gap: 16 }}>
                <button className="btn" onClick={startService} disabled={busy} style={{ background: "#10b981", color: "white" }}>
                  启动服务
                </button>
                <button className="btn" onClick={stopService} disabled={busy} style={{ background: "#ef4444", color: "white" }}>
                  停止服务
                </button>
                <button className="btn" onClick={async () => {
                  await api.openOpenClawDashboard();
                  showFeedback("已打开 OpenClaw Dashboard");
                }} disabled={busy}>
                  打开控制台
                </button>
                <button className="btn" onClick={() => api.openLogsDir()} disabled={busy}>
                  打开日志目录
                </button>
              </div>
            </div>

            <div className="panel">
              <h3>网关日志</h3>
              <div className="log-viewer">
                {(gatewayLogs?.stderr || gatewayLogs?.stdout || "").trim() || "暂无输出（启动后可在此查看错误）"}
              </div>
            </div>

            <div className="panel">
              <h3>Token 使用情况</h3>
              {tokenStatus ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span>{managementMode === "card" ? "卡密 Token 额度进度（预估）" : "API Key Token 额度进度（预估）"}</span>
                    <span>{tokenStatus.usedPercent}%</span>
                  </div>
                  <div className="token-progress">
                    <div className="token-progress-bar" style={{ width: `${tokenStatus.usedPercent}%` }}></div>
                  </div>
                  <div style={{ marginTop: 12, color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    剩余余额：¥{tokenStatus.remainingBalance} / ¥{tokenStatus.totalBalance}
                  </div>
                  <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => refreshState()} disabled={busy}>
                      刷新
                    </button>
                    <button className="btn btn-primary" onClick={() => api.openOpenClawDashboard()} disabled={busy}>
                      打开 Dashboard（实时）
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p style={{ color: "var(--text-muted)", margin: 0 }}>当前未配置可用的 Token / API Key。</p>
                  <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => refreshState()} disabled={busy}>
                      刷新
                    </button>
                    <button className="btn btn-primary" onClick={() => api.openOpenClawDashboard()} disabled={busy}>
                      打开 Dashboard
                    </button>
                  </div>
                </div>
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
