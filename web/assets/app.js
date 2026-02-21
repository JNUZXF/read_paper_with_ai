const apiBase = "";
const STORAGE_KEY = "read_paper_with_ai.providerDraft.v1";
const DEFAULT_ANGLE_SPECS = [
  {
    title: "主题与研究问题",
    prompt: "提炼论文想解决的核心问题、研究边界和目标人群/场景，明确作者的研究动机与价值主张。",
  },
  {
    title: "方法论与实验设计",
    prompt: "分析方法框架、关键假设、数据集/基线/对照设置，判断实验设计是否能支撑结论。",
  },
  {
    title: "核心创新点",
    prompt: "识别与现有工作的关键差异，区分真正创新与工程整合，说明创新带来的具体收益。",
  },
  {
    title: "结果与证据强度",
    prompt: "总结主要结果，检查统计显著性、消融实验、误差分析等证据强弱并指出薄弱环节。",
  },
  {
    title: "局限性与潜在风险",
    prompt: "评估方法局限、数据偏差、泛化风险和潜在负面影响，给出风险等级与触发条件。",
  },
  {
    title: "可复现性与工程实现建议",
    prompt: "从复现实验和落地工程角度，给出资源需求、实现步骤、关键依赖与验证路径。",
  },
];

const state = {
  providers: [],
  catalog: [],
  currentProviderId: null,
  panels: new Map(),
  reasoningRaw: "",
  finalRaw: "",
  angleSpecs: DEFAULT_ANGLE_SPECS.map((item) => ({ ...item })),
};
let markdownConfigured = false;

const el = {
  providerPreset: document.getElementById("providerPreset"),
  presetModelSelect: document.getElementById("presetModelSelect"),
  providerBaseUrl: document.getElementById("providerBaseUrl"),
  providerApiKey: document.getElementById("providerApiKey"),
  presetNote: document.getElementById("presetNote"),
  saveProviderBtn: document.getElementById("saveProviderBtn"),
  validateProviderBtn: document.getElementById("validateProviderBtn"),
  providerSelect: document.getElementById("providerSelect"),
  useProviderBtn: document.getElementById("useProviderBtn"),
  deleteProviderBtn: document.getElementById("deleteProviderBtn"),
  refreshProvidersBtn: document.getElementById("refreshProvidersBtn"),
  syncCatalogBtn: document.getElementById("syncCatalogBtn"),
  pdfFile: document.getElementById("pdfFile"),
  paperTitle: document.getElementById("paperTitle"),
  angleSpecList: document.getElementById("angleSpecList"),
  addAngleSpecBtn: document.getElementById("addAngleSpecBtn"),
  userPrompt: document.getElementById("userPrompt"),
  streamMode: document.getElementById("streamMode"),
  parallelLimit: document.getElementById("parallelLimit"),
  maxInputChars: document.getElementById("maxInputChars"),
  reasoningEnabled: document.getElementById("reasoningEnabled"),
  startAnalyzeBtn: document.getElementById("startAnalyzeBtn"),
  clearOutputBtn: document.getElementById("clearOutputBtn"),
  runHealthBtn: document.getElementById("runHealthBtn"),
  statusBar: document.getElementById("statusBar"),
  anglePanels: document.getElementById("anglePanels"),
  reasoningReport: document.getElementById("reasoningReport"),
  finalReport: document.getElementById("finalReport"),
};

function readDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeDraft(patch) {
  const next = { ...readDraft(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function restoreDraftToForm() {
  const draft = readDraft();
  if (typeof draft.providerPreset === "string") el.providerPreset.value = draft.providerPreset;
  if (typeof draft.baseUrl === "string") el.providerBaseUrl.value = draft.baseUrl;
  if (typeof draft.apiKey === "string") el.providerApiKey.value = draft.apiKey;
  if (typeof draft.reasoningEnabled === "string") el.reasoningEnabled.value = draft.reasoningEnabled;
  if (Number.isFinite(Number(draft.maxInputChars))) el.maxInputChars.value = String(Number(draft.maxInputChars));
  if (Array.isArray(draft.angleSpecs) && draft.angleSpecs.length > 0) {
    state.angleSpecs = draft.angleSpecs
      .map((item) => ({
        title: String(item?.title || "").trim(),
        prompt: String(item?.prompt || "").trim(),
      }))
      .filter((item) => item.title && item.prompt);
  }
  if (state.angleSpecs.length === 0) {
    state.angleSpecs = DEFAULT_ANGLE_SPECS.map((item) => ({ ...item }));
  }
  renderAngleSpecList();
}

function setStatus(text, isError = false) {
  el.statusBar.textContent = text;
  el.statusBar.style.color = isError ? "#ff9ba3" : "#8dffb4";
}

function getSelectedProviderId() {
  const id = Number(el.providerSelect.value);
  return Number.isFinite(id) ? id : null;
}

function ensurePanel(angle) {
  if (state.panels.has(angle)) return state.panels.get(angle);
  const wrap = document.createElement("div");
  wrap.className = "angle-panel";
  const title = document.createElement("h4");
  title.textContent = angle;
  const content = document.createElement("div");
  content.className = "markdown-body";
  wrap.appendChild(title);
  wrap.appendChild(content);
  el.anglePanels.appendChild(wrap);
  const panelState = { raw: "", el: content };
  state.panels.set(angle, panelState);
  return panelState;
}

function renderMarkdown(raw) {
  if (!raw) return "";
  const escaped = raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const parser = window.marked;
  if (!parser || !window.DOMPurify) return `<pre>${escaped}</pre>`;
  if (!markdownConfigured) {
    parser.setOptions({
      gfm: true,
      breaks: true,
    });
    markdownConfigured = true;
  }
  const html = parser.parse(raw);
  return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function clearOutput() {
  state.panels.clear();
  state.reasoningRaw = "";
  state.finalRaw = "";
  el.anglePanels.innerHTML = "";
  el.reasoningReport.innerHTML = "";
  el.finalReport.innerHTML = "";
}

function renderAngleSpecList() {
  el.angleSpecList.innerHTML = "";
  state.angleSpecs.forEach((spec, index) => {
    const wrap = document.createElement("div");
    wrap.className = "angle-spec-item";

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "角度标题";
    const titleInput = document.createElement("input");
    titleInput.className = "angle-title-input";
    titleInput.placeholder = "例如：方法论与实验设计";
    titleInput.value = spec.title;
    titleInput.addEventListener("input", (evt) => {
      state.angleSpecs[index].title = evt.target.value;
      writeDraft({ angleSpecs: state.angleSpecs });
    });
    titleLabel.appendChild(titleInput);

    const promptLabel = document.createElement("label");
    promptLabel.textContent = "该角度提示词";
    const promptInput = document.createElement("textarea");
    promptInput.className = "angle-prompt-input";
    promptInput.rows = 4;
    promptInput.placeholder = "输入该角度下希望大模型重点关注的分析要求";
    promptInput.value = spec.prompt;
    promptInput.addEventListener("input", (evt) => {
      state.angleSpecs[index].prompt = evt.target.value;
      writeDraft({ angleSpecs: state.angleSpecs });
    });
    promptLabel.appendChild(promptInput);

    const actions = document.createElement("div");
    actions.className = "row";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "danger-btn remove-angle-btn";
    removeBtn.textContent = "删除该角度";
    removeBtn.disabled = state.angleSpecs.length <= 1;
    removeBtn.addEventListener("click", () => {
      state.angleSpecs.splice(index, 1);
      renderAngleSpecList();
      writeDraft({ angleSpecs: state.angleSpecs });
    });
    actions.appendChild(removeBtn);

    wrap.appendChild(titleLabel);
    wrap.appendChild(promptLabel);
    wrap.appendChild(actions);
    el.angleSpecList.appendChild(wrap);
  });
}

function collectAngleSpecs() {
  const normalized = state.angleSpecs
    .map((item) => ({
      title: item.title.trim(),
      prompt: item.prompt.trim(),
    }))
    .filter((item) => item.title && item.prompt);
  if (!normalized.length) {
    throw new Error("请至少配置一个分析角度，并填写标题与提示词");
  }
  state.angleSpecs = normalized;
  writeDraft({ angleSpecs: state.angleSpecs });
  return normalized;
}

function cleanAnalysisText(raw) {
  let text = raw.replace(/^\s+/, "");
  const prefixes = ["好的", "当然", "可以", "下面开始分析", "以下是", "我将", "我会"];
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length).replace(/^[：:，,。\s]+/, "");
        changed = true;
      }
    }
  }
  return text || raw;
}

function appendMarkdownDelta(target, delta) {
  target.raw += delta;
  target.el.innerHTML = renderMarkdown(cleanAnalysisText(target.raw));
}

async function request(path, options = {}) {
  const resp = await fetch(`${apiBase}${path}`, options);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

function renderCatalog(catalog) {
  el.providerPreset.innerHTML = "";
  for (const p of catalog) {
    const op = document.createElement("option");
    op.value = p.provider;
    op.textContent = p.provider;
    el.providerPreset.appendChild(op);
  }
  const hasOpenRouter = catalog.some((p) => p.provider === "OpenRouter");
  if (hasOpenRouter) {
    el.providerPreset.value = "OpenRouter";
  }
  applyPreset();
}

function applyPreset() {
  const name = el.providerPreset.value;
  const preset = state.catalog.find((x) => x.provider === name);
  if (!preset) return;
  const draft = readDraft();

  el.providerBaseUrl.value = preset.base_url || "";
  el.presetModelSelect.innerHTML = "";
  if (!preset.models || preset.models.length === 0) {
    const op = document.createElement("option");
    op.value = "";
    op.textContent = "(无预置模型，请手动输入)";
    el.presetModelSelect.appendChild(op);
  } else {
    for (const model of preset.models) {
      const op = document.createElement("option");
      op.value = model;
      op.textContent = model;
      el.presetModelSelect.appendChild(op);
    }
    const defaultModel =
      (preset.default_model && preset.models.includes(preset.default_model) && preset.default_model) ||
      preset.models[0];
    el.presetModelSelect.value = defaultModel;
    if (typeof draft.presetModel === "string" && preset.models.includes(draft.presetModel)) {
      el.presetModelSelect.value = draft.presetModel;
    }
  }
  if (typeof draft.baseUrl === "string") el.providerBaseUrl.value = draft.baseUrl;
  el.presetNote.textContent =
    `${preset.note}\nBase URL: ${preset.base_url || "(自定义)"}\n` +
    `文档: ${preset.reference || "(无)"}`;
}

async function loadCatalog() {
  const data = await request("/v1/catalog/providers");
  state.catalog = data.providers || [];
  renderCatalog(state.catalog);
}

async function triggerCatalogSync() {
  setStatus("正在同步 provider/model 目录...");
  const result = await request("/v1/catalog/sync/trigger", { method: "POST" });
  const updatedAt = result.updated_at || "unknown";
  await loadCatalog();
  setStatus(`目录同步完成，更新时间: ${updatedAt}`);
}

async function loadProviders() {
  const data = await request("/v1/providers");
  state.providers = data;
  el.providerSelect.innerHTML = "";
  const draft = readDraft();
  let restored = false;
  for (const p of data) {
    const op = document.createElement("option");
    op.value = String(p.id);
    op.textContent = `${p.name} · ${p.model} · ${p.api_key_masked}${p.is_default ? " (默认)" : ""}`;
    el.providerSelect.appendChild(op);
    if (typeof draft.currentProviderId === "number" && p.id === draft.currentProviderId) {
      el.providerSelect.value = String(p.id);
      restored = true;
    } else if (!restored && p.is_default) {
      el.providerSelect.value = String(p.id);
    }
  }
  const selected = getSelectedProviderId();
  state.currentProviderId = selected;
  writeDraft({ currentProviderId: selected });
}

async function saveProvider() {
  const provider = state.catalog.find((x) => x.provider === el.providerPreset.value);
  const selectedModel = el.presetModelSelect.value.trim();
  const providerName = provider ? `${provider.provider} · ${selectedModel || "custom"}` : selectedModel;
  const body = {
    name: providerName,
    model: selectedModel,
    base_url: el.providerBaseUrl.value.trim(),
    api_key: el.providerApiKey.value.trim(),
    is_default: false,
  };
  if (!body.name || !body.model || !body.base_url || !body.api_key) {
    throw new Error("Provider、推荐模型、Base URL、API Key 不能为空");
  }
  await request("/v1/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  setStatus("模型配置已保存");
  await loadProviders();
}

async function validateCurrent() {
  const id = getSelectedProviderId();
  if (!id) throw new Error("请先选择或保存配置");
  setStatus("连通性检查中...");
  await request(`/v1/models/validate/provider/${id}`, { method: "POST" });
  setStatus("连通性检查成功");
}

async function deleteProvider() {
  const id = getSelectedProviderId();
  if (!id) throw new Error("请先选择配置");
  await request(`/v1/providers/${id}`, { method: "DELETE" });
  setStatus("配置已删除");
  await loadProviders();
}

function buildOptions() {
  const maxInputCharsRaw = Number(el.maxInputChars.value);
  const maxInputChars = Number.isFinite(maxInputCharsRaw)
    ? Math.max(2000, Math.min(30000, Math.trunc(maxInputCharsRaw)))
    : 30000;
  return {
    provider_id: state.currentProviderId,
    paper_title: el.paperTitle.value.trim() || null,
    angle_specs: collectAngleSpecs(),
    user_prompt: el.userPrompt.value.trim() || null,
    max_input_chars: maxInputChars,
    stream_mode: el.streamMode.value,
    parallel_limit: Number(el.parallelLimit.value),
    enable_reasoning: el.reasoningEnabled.value === "true",
    reasoning_effort: "high",
  };
}

async function analyzeStream() {
  const file = el.pdfFile.files?.[0];
  if (!file) throw new Error("请先上传 PDF");
  if (!state.currentProviderId) throw new Error("请先选择 Provider 配置");

  clearOutput();
  setStatus("开始流式分析...");
  const form = new FormData();
  form.append("options_json", JSON.stringify(buildOptions()));
  form.append("file", file);

  const resp = await fetch("/v1/papers/analyze/stream", { method: "POST", body: form });
  if (!resp.ok || !resp.body) throw new Error(await resp.text());

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith("data:")) continue;
      const payload = chunk.slice(5).trim();
      if (!payload) continue;
      const evt = JSON.parse(payload);
      handleStreamEvent(evt);
    }
  }
  setStatus("流式分析结束");
}

function handleStreamEvent(evt) {
  if (evt.event === "meta") {
    setStatus(`正在分析：${evt.paper_title} | 模式：${evt.stream_mode}`);
    return;
  }
  if (evt.event === "angle_delta") {
    const p = ensurePanel(evt.angle);
    appendMarkdownDelta(p, evt.delta);
    return;
  }
  if (evt.event === "angle_reasoning_delta") {
    const p = ensurePanel(`${evt.angle} · Thinking`);
    appendMarkdownDelta(p, evt.delta);
    return;
  }
  if (evt.event === "angle_done") {
    const p = ensurePanel(evt.angle);
    appendMarkdownDelta(p, "\n\n> 该角度完成");
    return;
  }
  if (evt.event === "angle_error") {
    const p = ensurePanel(evt.angle);
    appendMarkdownDelta(p, `\n\n> 错误: ${evt.message}`);
    return;
  }
  if (evt.event === "final_start") {
    state.finalRaw = "";
    el.finalReport.innerHTML = "";
    return;
  }
  if (evt.event === "final_delta") {
    state.finalRaw += evt.delta;
    el.finalReport.innerHTML = renderMarkdown(cleanAnalysisText(state.finalRaw));
    return;
  }
  if (evt.event === "final_reasoning_delta") {
    state.reasoningRaw += evt.delta;
    el.reasoningReport.innerHTML = renderMarkdown(cleanAnalysisText(state.reasoningRaw));
    return;
  }
  if (evt.event === "final_done") {
    setStatus(`完成，处理字符数: ${evt.text_char_count}`);
  }
}

async function runHealthCheck() {
  setStatus("健康检查执行中...");
  const health = await request("/health");
  const providers = await request("/v1/providers");
  setStatus(`健康检查通过 | service=${health.service} | providers=${providers.length}`);
}

el.providerPreset.addEventListener("change", applyPreset);
el.providerPreset.addEventListener("change", () => writeDraft({ providerPreset: el.providerPreset.value }));
el.presetModelSelect.addEventListener("change", () => writeDraft({ presetModel: el.presetModelSelect.value }));
el.providerBaseUrl.addEventListener("input", () => writeDraft({ baseUrl: el.providerBaseUrl.value }));
el.providerApiKey.addEventListener("input", () => writeDraft({ apiKey: el.providerApiKey.value }));
el.reasoningEnabled.addEventListener("change", () => writeDraft({ reasoningEnabled: el.reasoningEnabled.value }));
el.maxInputChars.addEventListener("input", () => writeDraft({ maxInputChars: el.maxInputChars.value }));
el.addAngleSpecBtn.addEventListener("click", () => {
  if (state.angleSpecs.length >= 8) {
    setStatus("最多支持 8 个分析角度", true);
    return;
  }
  state.angleSpecs.push({ title: "", prompt: "" });
  renderAngleSpecList();
  writeDraft({ angleSpecs: state.angleSpecs });
});
el.providerSelect.addEventListener("change", () => writeDraft({ currentProviderId: getSelectedProviderId() }));
el.saveProviderBtn.addEventListener("click", () => saveProvider().catch((e) => setStatus(e.message, true)));
el.validateProviderBtn.addEventListener("click", () => validateCurrent().catch((e) => setStatus(e.message, true)));
el.useProviderBtn.addEventListener("click", () => {
  state.currentProviderId = getSelectedProviderId();
  writeDraft({ currentProviderId: state.currentProviderId });
  setStatus(`已切换 provider_id=${state.currentProviderId ?? "-"}`);
});
el.deleteProviderBtn.addEventListener("click", () => deleteProvider().catch((e) => setStatus(e.message, true)));
el.refreshProvidersBtn.addEventListener("click", () => loadProviders().catch((e) => setStatus(e.message, true)));
el.syncCatalogBtn.addEventListener("click", () => triggerCatalogSync().catch((e) => setStatus(e.message, true)));
el.startAnalyzeBtn.addEventListener("click", () => analyzeStream().catch((e) => setStatus(e.message, true)));
el.clearOutputBtn.addEventListener("click", clearOutput);
el.runHealthBtn.addEventListener("click", () => runHealthCheck().catch((e) => setStatus(e.message, true)));

Promise.all([loadCatalog(), loadProviders()])
  .then(() => {
    restoreDraftToForm();
    applyPreset();
  })
  .then(() => setStatus("就绪：先选 Provider 和推荐模型，再保存配置并开始分析"))
  .catch((e) => setStatus(e.message, true));
