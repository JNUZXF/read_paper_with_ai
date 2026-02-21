import { useState, useEffect } from 'react'
import { api } from '../utils/api.js'

const SETTINGS_STORAGE_KEY = 'paper_lens.settings.v1'

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveSettings(data) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data))
}

export default function SettingsDrawer({
  providers, catalog,
  currentProviderId,
  onClose, onProvidersChange, onSelectProvider, onStatus,
}) {
  const savedSettings = loadSettings()
  const [selectedPreset, setSelectedPreset] = useState(savedSettings.selectedPreset || '')
  const [selectedModel, setSelectedModel] = useState(savedSettings.selectedModel || '')
  const [baseUrl, setBaseUrl] = useState(savedSettings.baseUrl || '')
  const [apiKey, setApiKey] = useState(savedSettings.apiKey || '')
  const [enableReasoning, setEnableReasoning] = useState(savedSettings.enableReasoning || false)
  const [selectedSavedId, setSelectedSavedId] = useState(String(currentProviderId || ''))
  const [presetNote, setPresetNote] = useState('')

  const presetModels = catalog.find(c => c.provider === selectedPreset)?.models || []

  // 自动保存设置到本地存储
  useEffect(() => {
    saveSettings({
      selectedPreset,
      selectedModel,
      baseUrl,
      apiKey,
      enableReasoning,
    })
  }, [selectedPreset, selectedModel, baseUrl, apiKey, enableReasoning])

  useEffect(() => {
    if (catalog.length && !selectedPreset) {
      const openRouter = catalog.find(c => c.provider === 'OpenRouter')
      const first = openRouter || catalog[0]
      if (first) applyPreset(first.provider)
    }
  }, [catalog])

  useEffect(() => {
    if (currentProviderId) setSelectedSavedId(String(currentProviderId))
  }, [currentProviderId])

  function applyPreset(name) {
    setSelectedPreset(name)
    const preset = catalog.find(c => c.provider === name)
    if (!preset) return
    setBaseUrl(preset.base_url || '')
    const models = preset.models || []
    const def = preset.default_model && models.includes(preset.default_model)
      ? preset.default_model : models[0] || ''
    setSelectedModel(def)
    setPresetNote(`${preset.note || ''}\n文档: ${preset.reference || '—'}`)
  }

  async function handleSave() {
    if (!selectedModel || !baseUrl || !apiKey) {
      onStatus('请填写 Base URL、API Key 和选择模型', true)
      return
    }
    try {
      const presetObj = catalog.find(c => c.provider === selectedPreset)
      const name = presetObj ? `${presetObj.provider} · ${selectedModel}` : selectedModel
      await api.post('/v1/providers', { name, model: selectedModel, base_url: baseUrl, api_key: apiKey, is_default: false })
      onStatus('配置已保存')
      const updated = await api.get('/v1/providers')
      onProvidersChange(updated)
    } catch (e) { onStatus(e.message, true) }
  }

  async function handleValidate() {
    const id = Number(selectedSavedId)
    if (!id) { onStatus('请先选择一个已保存配置', true); return }
    try {
      onStatus('连通性检查中...')
      await api.post(`/v1/models/validate/provider/${id}`, {})
      onStatus('连通性检查成功 ✓')
    } catch (e) { onStatus(e.message, true) }
  }

  async function handleDelete() {
    const id = Number(selectedSavedId)
    if (!id) return
    try {
      await api.delete(`/v1/providers/${id}`)
      onStatus('配置已删除')
      const updated = await api.get('/v1/providers')
      onProvidersChange(updated)
    } catch (e) { onStatus(e.message, true) }
  }

  function handleUse() {
    const id = Number(selectedSavedId)
    if (!id) return
    onSelectProvider(id)
    onStatus(`已切换到 Provider #${id}`)
    onClose()
  }

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <div className="settings-drawer">
        <div className="settings-header">
          <div className="settings-title">
            <span>⚙</span>
            <span>模型配置</span>
          </div>
          <button className="settings-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {/* Preset selector */}
          <div className="settings-section">
            <div className="settings-section-label">预置 Provider</div>
            <label className="field">
              <span className="field-label">服务商</span>
              <select value={selectedPreset} onChange={e => applyPreset(e.target.value)}>
                {catalog.map(c => <option key={c.provider} value={c.provider}>{c.provider}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">推荐模型</span>
              <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
                {presetModels.map(m => <option key={m} value={m}>{m}</option>)}
                {presetModels.length === 0 && <option value="">（请手动填写模型名）</option>}
              </select>
            </label>
            {presetNote && <div className="settings-note">{presetNote}</div>}
          </div>

          <div className="settings-divider" />

          {/* Manual config */}
          <div className="settings-section">
            <div className="settings-section-label">连接信息</div>
            <label className="field">
              <span className="field-label">Base URL</span>
              <input
                type="text"
                placeholder="https://api.openai.com/v1"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">API Key</span>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="field-label">深度思考模式</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={enableReasoning}
                  onChange={e => setEnableReasoning(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </label>
          </div>

          <div className="settings-row">
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleSave}>保存配置</button>
            <button className="btn btn-outline btn-sm" onClick={handleValidate}>连通性检查</button>
          </div>

          <div className="settings-divider" />

          {/* Saved providers */}
          <div className="settings-section">
            <div className="settings-section-label">已保存配置</div>
            <select value={selectedSavedId} onChange={e => setSelectedSavedId(e.target.value)}>
              {providers.map(p => (
                <option key={p.id} value={String(p.id)}>
                  {p.name} · {p.api_key_masked}{p.is_default ? ' (默认)' : ''}
                </option>
              ))}
              {providers.length === 0 && <option value="">（无保存配置）</option>}
            </select>
            <div className="settings-row">
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleUse}>使用此配置</button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete}>删除</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
