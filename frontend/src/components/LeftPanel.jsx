import { useState } from 'react'
import UploadZone from './UploadZone.jsx'
import AngleConfigList from './AngleConfigList.jsx'

export default function LeftPanel({
  angleSpecs, onAngleSpecsChange,
  userPrompt, onUserPromptChange,
  maxInputChars, onMaxInputCharsChange,
  streamMode, onStreamModeChange,
  parallelLimit, onParallelLimitChange,
  enableReasoning, onEnableReasoningChange,
  enableFinalReport, onEnableFinalReportChange,
  isAnalyzing,
  onStart, onCancel, onClear,
  statusMsg, isError,
}) {
  const [files, setFiles] = useState([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  function handleStart() {
    onStart(files)
  }

  return (
    <aside className="left-panel">
      <div className="left-panel-inner">

        {/* Upload */}
        <div className="section-card">
          <div className="section-title">
            <span className="section-title-icon">📂</span>
            <span>论文上传</span>
            {files.length > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>
                {files.length} 篇
              </span>
            )}
          </div>
          <UploadZone files={files} onFilesChange={setFiles} />
        </div>

        {/* Angles */}
        <div className="section-card">
          <div className="section-title">
            <span className="section-title-icon">🔍</span>
            <span>分析角度配置</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
              {angleSpecs.length} 个
            </span>
          </div>
          <AngleConfigList angleSpecs={angleSpecs} onChange={onAngleSpecsChange} />
        </div>

        {/* Prompt */}
        <div className="section-card">
          <div className="section-title">
            <span className="section-title-icon">💬</span>
            <span>附加提示词</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>可选</span>
          </div>
          <textarea
            value={userPrompt}
            onChange={e => onUserPromptChange(e.target.value)}
            placeholder="例如：重点评估该方法在工业环境的落地价值..."
            rows={3}
            style={{ fontSize: 13 }}
          />
        </div>

        {/* Advanced */}
        <div className="section-card">
          <div
            className="advanced-toggle"
            onClick={() => setShowAdvanced(s => !s)}
          >
            <span>{showAdvanced ? '▲' : '▼'}</span>
            <span>高级参数</span>
          </div>
          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="advanced-grid">
                <label className="field">
                  <span className="field-label">输出模式</span>
                  <select value={streamMode} onChange={e => onStreamModeChange(e.target.value)}>
                    <option value="sequential">逐角度流式</option>
                    <option value="parallel">并行流式</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">并行上限</span>
                  <input
                    type="number" min="1" max="8"
                    value={parallelLimit}
                    onChange={e => onParallelLimitChange(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="field">
                <span className="field-label">最大提取字数</span>
                <input
                  type="number" min="2000" max="30000" step="1000"
                  value={maxInputChars}
                  onChange={e => onMaxInputCharsChange(Number(e.target.value))}
                />
              </label>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="field-label">深度思考模式</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={enableReasoning}
                    onChange={e => onEnableReasoningChange(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </label>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="field-label">生成综合报告</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={enableFinalReport}
                    onChange={e => onEnableFinalReportChange(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </label>
            </div>
          )}
        </div>

      </div>

      {/* Footer actions */}
      <div className="left-panel-footer">
        <div className="status-bar" style={isError ? { color: 'var(--error)', background: 'rgba(201,92,92,0.06)', borderColor: 'rgba(201,92,92,0.2)' } : {}}>
          {statusMsg}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={handleStart}
            disabled={isAnalyzing || !files.length}
          >
            {isAnalyzing ? '⟳ 分析中...' : `🚀 开始分析${files.length > 1 ? ` (${files.length} 篇)` : ''}`}
          </button>
          {isAnalyzing ? (
            <button className="btn btn-cancel" onClick={onCancel}>
              ✕ 取消
            </button>
          ) : (
            <button className="btn btn-outline" onClick={onClear}>
              清空
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
