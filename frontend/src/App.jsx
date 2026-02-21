import { useState, useEffect, useRef, useCallback } from 'react'
import Header from './components/Header.jsx'
import SettingsDrawer from './components/SettingsDrawer.jsx'
import LeftPanel from './components/LeftPanel.jsx'
import RightPanel from './components/RightPanel.jsx'
import { api } from './utils/api.js'

const DEFAULT_ANGLES = [
  { title: '主题与研究问题', prompt: '提炼论文想解决的核心问题、研究边界和目标人群/场景，明确作者的研究动机与价值主张。' },
  { title: '方法论与实验设计', prompt: '分析方法框架、关键假设、数据集/基线/对照设置，判断实验设计是否能支撑结论。' },
  { title: '核心创新点', prompt: '识别与现有工作的关键差异，区分真正创新与工程整合，说明创新带来的具体收益。' },
  { title: '结果与证据强度', prompt: '总结主要结果，检查统计显著性、消融实验、误差分析等证据强弱并指出薄弱环节。' },
  { title: '局限性与潜在风险', prompt: '评估方法局限、数据偏差、泛化风险和潜在负面影响，给出风险等级与触发条件。' },
  { title: '可复现性与工程实现建议', prompt: '从复现实验和落地工程角度，给出资源需求、实现步骤、关键依赖与验证路径。' },
]

const STORAGE_KEY = 'paper_lens.v3'

function loadPersisted() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function persist(patch) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPersisted(), ...patch }))
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false)

  // Provider state
  const [providers, setProviders] = useState([])
  const [catalog, setCatalog] = useState([])
  const [currentProviderId, setCurrentProviderId] = useState(() => loadPersisted().currentProviderId || null)

  // Analysis config
  const [angleSpecs, setAngleSpecs] = useState(() => loadPersisted().angleSpecs || DEFAULT_ANGLES)
  const [userPrompt, setUserPrompt] = useState('')
  const [maxInputChars, setMaxInputChars] = useState(30000)
  const [streamMode, setStreamMode] = useState('sequential')
  const [parallelLimit, setParallelLimit] = useState(3)
  const [enableReasoning, setEnableReasoning] = useState(false)
  const [enableFinalReport, setEnableFinalReport] = useState(false)

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [papers, setPapers] = useState([])
  const [activePaperId, setActivePaperId] = useState(null)
  const [activeAngle, setActiveAngle] = useState('__final__')
  const [statusMsg, setStatusMsg] = useState('准备就绪 — 在左侧上传 PDF 开始分析')
  const [isError, setIsError] = useState(false)

  // Streaming content (ref-based for performance)
  const contentMap = useRef({})
  const [tick, setTick] = useState(0)
  const tickPending = useRef(false)

  function scheduleTick() {
    if (tickPending.current) return
    tickPending.current = true
    requestAnimationFrame(() => {
      tickPending.current = false
      setTick(t => t + 1)
    })
  }

  function appendContent(key, delta) {
    contentMap.current[key] = (contentMap.current[key] || '') + delta
    scheduleTick()
  }

  function getContent(key) {
    return contentMap.current[key] || ''
  }

  function setStatus(msg, err = false) {
    setStatusMsg(msg)
    setIsError(err)
  }

  // Load initial data
  useEffect(() => {
    api.get('/v1/providers').then(data => {
      setProviders(data)
      const saved = loadPersisted().currentProviderId
      if (saved && data.find(p => p.id === saved)) {
        setCurrentProviderId(saved)
      } else if (data.length) {
        setCurrentProviderId(data[0].id)
      }
    }).catch(e => setStatus(e.message, true))

    api.get('/v1/catalog/providers').then(data => {
      setCatalog(data.providers || [])
    }).catch(() => {})
  }, [])

  // Persist settings
  useEffect(() => { persist({ angleSpecs }) }, [angleSpecs])
  useEffect(() => { if (currentProviderId) persist({ currentProviderId }) }, [currentProviderId])

  function handleSelectProvider(id) {
    setCurrentProviderId(id)
  }

  async function handleSyncCatalog() {
    try {
      setStatus('同步 Provider 目录中...')
      await api.post('/v1/catalog/sync/trigger', {})
      const data = await api.get('/v1/catalog/providers')
      setCatalog(data.providers || [])
      setStatus('目录同步完成 ✓')
    } catch (e) { setStatus(e.message, true) }
  }

  async function handleHealthCheck() {
    try {
      const health = await api.get('/health')
      const provs = await api.get('/v1/providers')
      setStatus(`服务正常 ✓ | ${health.service || 'ok'} | 配置数: ${provs.length}`)
    } catch (e) { setStatus(e.message, true) }
  }

  // Stream events handler for a single paper
  function handleStreamEvent(paperId, evt) {
    if (evt.event === 'meta') {
      setPapers(ps => ps.map(p =>
        p.id === paperId ? { ...p, title: evt.paper_title || p.title } : p
      ))
      return
    }
    if (evt.event === 'angle_delta') {
      appendContent(`${paperId}:${evt.angle}`, evt.delta)
      setPapers(ps => ps.map(p => {
        if (p.id !== paperId) return p
        const angles = { ...p.angles }
        if (!angles[evt.angle]) angles[evt.angle] = { status: 'streaming' }
        else if (angles[evt.angle].status === 'pending') angles[evt.angle] = { status: 'streaming' }
        return { ...p, angles }
      }))
      return
    }
    if (evt.event === 'angle_reasoning_delta') {
      appendContent(`${paperId}:${evt.angle}:r`, evt.delta)
      return
    }
    if (evt.event === 'angle_done') {
      setPapers(ps => ps.map(p => {
        if (p.id !== paperId) return p
        const angles = { ...p.angles }
        angles[evt.angle] = { status: 'done' }
        return { ...p, angles }
      }))
      return
    }
    if (evt.event === 'angle_error') {
      setPapers(ps => ps.map(p => {
        if (p.id !== paperId) return p
        const angles = { ...p.angles }
        angles[evt.angle] = { status: 'error' }
        return { ...p, angles }
      }))
      appendContent(`${paperId}:${evt.angle}`, `\n\n> 分析错误: ${evt.message}`)
      return
    }
    if (evt.event === 'final_delta') {
      appendContent(`${paperId}:final`, evt.delta)
      return
    }
    if (evt.event === 'final_reasoning_delta') {
      appendContent(`${paperId}:final:r`, evt.delta)
      return
    }
    if (evt.event === 'final_done') {
      setPapers(ps => ps.map(p => p.id === paperId ? { ...p, status: 'done' } : p))
      setStatus(`分析完成 ✓ 处理字符数: ${evt.text_char_count}`)
      return
    }
  }

  async function streamSinglePaper(paperId, file, options) {
    const form = new FormData()
    form.append('options_json', JSON.stringify(options))
    form.append('file', file)

    const resp = await fetch('/v1/papers/analyze/stream', { method: 'POST', body: form })
    if (!resp.ok || !resp.body) throw new Error(await resp.text())

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 2)
        if (!chunk.startsWith('data:')) continue
        const payload = chunk.slice(5).trim()
        if (!payload) continue
        try {
          const evt = JSON.parse(payload)
          handleStreamEvent(paperId, evt)
        } catch {}
      }
    }
  }

  async function handleStart(files) {
    if (!currentProviderId) {
      setStatus('请先点击左上角 ⚙ 配置模型 Provider', true)
      return
    }
    if (!files?.length) {
      setStatus('请先上传 PDF 文件', true)
      return
    }

    const validSpecs = angleSpecs.filter(s => s.title.trim() && s.prompt.trim())
    if (!validSpecs.length) {
      setStatus('请至少配置一个有效的分析角度', true)
      return
    }

    const options = {
      provider_id: currentProviderId,
      angle_specs: validSpecs,
      user_prompt: userPrompt.trim() || null,
      max_input_chars: Math.max(2000, Math.min(30000, maxInputChars)),
      stream_mode: streamMode,
      parallel_limit: parallelLimit,
      enable_reasoning: enableReasoning,
      reasoning_effort: 'high',
      enable_final_report: enableFinalReport,
    }

    // Initialize paper states — pre-populate all angles as pending so tabs appear immediately
    const initialAngles = {}
    validSpecs.forEach(s => { initialAngles[s.title] = { status: 'pending' } })

    const newPapers = Array.from(files).map((file, i) => ({
      id: `paper-${Date.now()}-${i}`,
      filename: file.name,
      title: file.name.replace(/\.pdf$/i, ''),
      status: 'analyzing',
      angles: { ...initialAngles },
      error: null,
    }))

    contentMap.current = {}
    setPapers(newPapers)
    setActivePaperId(newPapers[0].id)
    setActiveAngle(validSpecs[0].title)
    setIsAnalyzing(true)
    setStatus(`开始分析 ${files.length} 篇论文...`)

    try {
      if (files.length === 1) {
        await streamSinglePaper(newPapers[0].id, files[0], options)
      } else {
        // Multiple papers: parallel streams
        setStatus(`并行分析 ${files.length} 篇论文中...`)
        await Promise.all(
          newPapers.map((paper, i) =>
            streamSinglePaper(paper.id, files[i], options).catch(e => {
              setPapers(ps => ps.map(p =>
                p.id === paper.id ? { ...p, status: 'error', error: e.message } : p
              ))
            })
          )
        )
        const doneCount = newPapers.length
        setStatus(`${doneCount} 篇论文分析完成 ✓`)
      }
    } catch (e) {
      setStatus(e.message, true)
    } finally {
      setIsAnalyzing(false)
    }
  }

  function handleClear() {
    contentMap.current = {}
    setPapers([])
    setActivePaperId(null)
    setTick(0)
    setStatus('输出已清空，可重新上传论文开始分析')
    setIsError(false)
  }

  return (
    <div className="app">
      <Header
        settingsOpen={showSettings}
        onSettingsClick={() => setShowSettings(s => !s)}
        providers={providers}
        currentProviderId={currentProviderId}
        onSyncCatalog={handleSyncCatalog}
        onHealthCheck={handleHealthCheck}
      />

      {showSettings && (
        <SettingsDrawer
          providers={providers}
          catalog={catalog}
          currentProviderId={currentProviderId}
          onClose={() => setShowSettings(false)}
          onProvidersChange={setProviders}
          onSelectProvider={handleSelectProvider}
          onStatus={setStatus}
        />
      )}

      <div className="main-layout">
        <LeftPanel
          angleSpecs={angleSpecs}
          onAngleSpecsChange={setAngleSpecs}
          userPrompt={userPrompt}
          onUserPromptChange={setUserPrompt}
          maxInputChars={maxInputChars}
          onMaxInputCharsChange={setMaxInputChars}
          streamMode={streamMode}
          onStreamModeChange={setStreamMode}
          parallelLimit={parallelLimit}
          onParallelLimitChange={setParallelLimit}
          enableReasoning={enableReasoning}
          onEnableReasoningChange={setEnableReasoning}
          enableFinalReport={enableFinalReport}
          onEnableFinalReportChange={setEnableFinalReport}
          isAnalyzing={isAnalyzing}
          onStart={handleStart}
          onClear={handleClear}
          statusMsg={statusMsg}
          isError={isError}
        />

        <RightPanel
          papers={papers}
          activePaperId={activePaperId}
          activeAngle={activeAngle}
          onSelectPaper={id => setActivePaperId(id)}
          onSelectAngle={setActiveAngle}
          getContent={getContent}
          tick={tick}
          enableReasoning={enableReasoning}
          enableFinalReport={enableFinalReport}
        />
      </div>
    </div>
  )
}
