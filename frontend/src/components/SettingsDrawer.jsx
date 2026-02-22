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
  catalog,
  currentConfig,
  onClose, onApplyConfig, onStatus,
}) {
  const savedSettings = loadSettings()
  const [selectedPreset, setSelectedPreset] = useState(savedSettings.selectedPreset || '')
  const [selectedModel, setSelectedModel] = useState(savedSettings.selectedModel || '')
  const [baseUrl, setBaseUrl] = useState(currentConfig?.baseUrl || savedSettings.baseUrl || '')
  const [apiKey, setApiKey] = useState(currentConfig?.apiKey || savedSettings.apiKey || '')
  const [enableReasoning, setEnableReasoning] = useState(currentConfig?.enableReasoning || savedSettings.enableReasoning || false)
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

  async function handleValidate() {
    if (!selectedModel || !baseUrl || !apiKey) {
      onStatus('请填写 Base URL、API Key 和选择模型', true)
      return
    }
    try {
      onStatus('连通性检查中...')
      // 直接使用当前配置进行验证
      await api.post('/v1/models/validate', {
        api_key: apiKey,
        base_url: baseUrl,
        model: selectedModel,
      })
      onStatus('连通性检查成功 ✓')
    } catch (e) { onStatus(e.message, true) }
  }

  function handleApply() {
    if (!selectedModel || !baseUrl || !apiKey) {
      onStatus('请填写 Base URL、API Key 和选择模型', true)
      return
    }
    onApplyConfig({
      baseUrl,
      apiKey,
      model: selectedModel,
      enableReasoning,
    })
    onStatus('配置已应用 ✓')
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
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleApply}>应用当前配置</button>
            <button className="btn btn-outline btn-sm" onClick={handleValidate}>连通性检查</button>
          </div>
        </div>
      </div>
    </>
  )
}
