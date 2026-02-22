import { useEffect, useRef, useState } from 'react'
import { renderMarkdown, cleanText } from '../utils/markdown.js'
import { api } from '../utils/api.js'

/* ── Single angle/section content renderer ── */
function StreamContent({ contentKey, getContent, tick }) {
  const elRef = useRef(null)
  const prevKey = useRef(null)

  useEffect(() => {
    if (!elRef.current) return
    const raw = getContent(contentKey)
    if (raw) {
      elRef.current.innerHTML = renderMarkdown(cleanText(raw))
    } else if (prevKey.current !== contentKey) {
      elRef.current.innerHTML = ''
    }
    prevKey.current = contentKey
  })

  return <div className="md" ref={elRef} />
}

/* ── Reasoning collapsible ── */
function ReasoningSection({ contentKey, getContent, tick }) {
  const content = getContent(contentKey)
  if (!content) return null

  return (
    <details className="reasoning-section" style={{ marginBottom: 10 }}>
      <summary className="reasoning-toggle">
        <span>💭</span>
        <span>思考过程</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {content.length} 字
        </span>
      </summary>
      <div className="reasoning-body">
        <StreamContent contentKey={contentKey} getContent={getContent} tick={tick} />
      </div>
    </details>
  )
}

/* ── Paper status icon ── */
function StatusIcon({ status }) {
  if (status === 'analyzing') return <span className="paper-tab-status analyzing">⟳</span>
  if (status === 'done') return <span className="paper-tab-status" style={{ color: 'var(--success)' }}>✓</span>
  if (status === 'error') return <span className="paper-tab-status" style={{ color: 'var(--error)' }}>✕</span>
  return <span className="paper-tab-status" style={{ color: 'var(--text-muted)' }}>·</span>
}

/* ── Main output area ── */
export default function OutputArea({
  papers, activePaperId, activeAngle,
  onSelectPaper, onSelectAngle,
  getContent, tick, enableReasoning, enableFinalReport,
}) {
  const activePaper = papers.find(p => p.id === activePaperId)
  const hasMultiplePapers = papers.length > 1

  // Per-paper export state (resets on paper switch)
  const [exportState, setExportState] = useState({ status: 'idle', filePath: '', filename: '', downloadUrl: '', error: '' })
  // Batch export state (persists across paper switches)
  const [batchExportState, setBatchExportState] = useState({ status: 'idle', filename: '', downloadUrl: '', error: '' })

  // Reset single-paper export state when switching papers
  useEffect(() => {
    setExportState({ status: 'idle', filePath: '', filename: '', downloadUrl: '', error: '' })
  }, [activePaperId])

  function _triggerDownload(url, filename) {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  async function handleExport() {
    if (!activePaper || activePaper.status !== 'done') return
    setExportState({ status: 'loading', filePath: '', filename: '', downloadUrl: '', error: '' })
    try {
      const angles = Object.keys(activePaper.angles)
        .map(name => ({ title: name, content: getContent(`${activePaperId}:${name}`) }))
        .filter(a => a.content.trim())
      const finalReport = enableFinalReport ? (getContent(`${activePaperId}:final`) || null) : null
      const result = await api.post('/v1/papers/export/docx', {
        paper_title: activePaper.title,
        angles,
        final_report: finalReport,
      })
      _triggerDownload(result.download_url, result.filename)
      setExportState({ status: 'done', filePath: result.file_path, filename: result.filename, downloadUrl: result.download_url, error: '' })
    } catch (e) {
      setExportState({ status: 'idle', filePath: '', filename: '', downloadUrl: '', error: e.message })
    }
  }

  async function handleBatchExport() {
    setBatchExportState({ status: 'loading', filename: '', downloadUrl: '', error: '' })
    try {
      const papersPayload = papers
        .filter(p => p.status === 'done' || Object.values(p.angles || {}).some(a => a.status === 'done'))
        .map(p => ({
          paper_title: p.title,
          angles: Object.keys(p.angles || {})
            .map(name => ({ title: name, content: getContent(`${p.id}:${name}`) }))
            .filter(a => a.content.trim()),
          final_report: enableFinalReport ? (getContent(`${p.id}:final`) || null) : null,
        }))
        .filter(p => p.angles.length > 0)

      if (!papersPayload.length) throw new Error('暂无可导出的分析内容')

      const result = await api.post('/v1/papers/export/batch-docx', { papers: papersPayload })
      _triggerDownload(result.download_url, result.filename)
      setBatchExportState({ status: 'done', filename: result.filename, downloadUrl: result.download_url, error: '' })
    } catch (e) {
      setBatchExportState({ status: 'idle', filename: '', downloadUrl: '', error: e.message })
    }
  }

  // Determine angle tabs for active paper
  const angleTabs = activePaper
    ? [
        ...(enableReasoning ? [{ key: '__reasoning__', label: '💭 思考', status: 'done' }] : []),
        ...Object.entries(activePaper.angles || {}).map(([name, state]) => ({
          key: name, label: name, status: state.status,
        })),
        ...(enableFinalReport ? [{ key: '__final__', label: '📋 综合报告', status: activePaper.status === 'done' ? 'done' : activePaper.status }] : []),
      ]
    : []

  if (!papers.length) {
    return (
      <div className="output-area">
        <div className="empty-state">
          <div className="empty-state-icon">🌿</div>
          <div className="empty-state-title">等待分析开始</div>
          <div className="empty-state-sub">
            在左侧上传论文 PDF，配置分析角度，点击「开始分析」后流式输出将在这里实时呈现。
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="output-area">
      {/* Paper tabs — only shown when multiple papers */}
      {hasMultiplePapers && (
        <>
          <div className="paper-tab-bar">
            {papers.map(p => (
              <button
                key={p.id}
                className={`paper-tab${p.id === activePaperId ? ' active' : ''}`}
                onClick={() => onSelectPaper(p.id)}
              >
                <StatusIcon status={p.status} />
                <span className="paper-tab-name" title={p.filename}>
                  {p.title !== p.filename ? p.title : p.filename.replace(/\.pdf$/i, '')}
                </span>
              </button>
            ))}
            {/* Batch export button — shown when at least one paper has content */}
            {papers.some(p => p.status === 'done') && (
              <button
                className="export-docx-btn export-batch-btn"
                onClick={handleBatchExport}
                disabled={batchExportState.status === 'loading'}
                title={`将全部 ${papers.length} 篇论文的分析汇总导出为一个 Word 文档`}
              >
                {batchExportState.status === 'loading'
                  ? '⏳ 汇总中…'
                  : `📥 导出全部 ${papers.length} 篇`}
              </button>
            )}
          </div>
          {/* Batch export result banner */}
          {batchExportState.status === 'done' && (
            <div className="export-banner">
              <span className="export-banner-icon">✓</span>
              <span className="export-banner-path" title={batchExportState.filename}>
                已下载：{batchExportState.filename}
              </span>
              <a
                className="export-banner-btn"
                href={batchExportState.downloadUrl}
                download={batchExportState.filename}
                title="重新下载"
              >
                重新下载
              </a>
            </div>
          )}
          {batchExportState.error && (
            <div className="export-banner export-banner-error">
              <span>✕ 批量导出失败：{batchExportState.error}</span>
            </div>
          )}
        </>
      )}

      {/* Angle tabs */}
      {activePaper && (
        <div className="angle-tab-bar">
          {hasMultiplePapers && (
            <span className="angle-tab-bar-label">角度：</span>
          )}
          {/* When no angles yet: show placeholder tabs based on analysis config */}
          {angleTabs.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              分析中，等待角度输出...
            </span>
          ) : (
            angleTabs.map(tab => (
              <button
                key={tab.key}
                className={`angle-tab${activeAngle === tab.key ? ' active' : ''} ${tab.status}`}
                onClick={() => onSelectAngle(tab.key)}
              >
                <span className="angle-tab-dot" />
                <span>{tab.label}</span>
              </button>
            ))
          )}
          {/* Export button — only when analysis is fully done */}
          {activePaper.status === 'done' && (
            <button
              className="export-docx-btn"
              onClick={handleExport}
              disabled={exportState.status === 'loading'}
              title="将全部分析角度导出为 Word 文档"
            >
              {exportState.status === 'loading' ? '⏳ 导出中…' : '📥 导出 Word'}
            </button>
          )}
        </div>
      )}

      {/* Export result banner */}
      {exportState.status === 'done' && (
        <div className="export-banner">
          <span className="export-banner-icon">✓</span>
          <span className="export-banner-path" title={exportState.filePath}>
            已下载：{exportState.filename}
          </span>
          <a
            className="export-banner-btn"
            href={exportState.downloadUrl}
            download={exportState.filename}
            title="重新下载"
          >
            重新下载
          </a>
        </div>
      )}
      {exportState.error && (
        <div className="export-banner export-banner-error">
          <span>✕ 导出失败：{exportState.error}</span>
        </div>
      )}

      {/* Content */}
      {activePaper && (
        <div className="content-area">
          {/* Multi-paper overview: if no angle selected or overview requested */}
          {activeAngle === '__overview__' ? (
            <PapersOverview papers={papers} getContent={getContent} tick={tick} onSelectPaper={(id) => { onSelectPaper(id); onSelectAngle('__final__') }} />
          ) : activeAngle === '__reasoning__' ? (
            <div className="content-section fade-in">
              <div className="content-section-header">
                <div className="content-section-label">
                  <span>💭</span>
                  <span>全局思考过程</span>
                </div>
              </div>
              <div className="content-section-body">
                <StreamContent contentKey={`${activePaperId}:final:r`} getContent={getContent} tick={tick} />
              </div>
            </div>
          ) : activeAngle === '__final__' ? (
            <div className="content-section fade-in">
              <div className="content-section-header">
                <div className="content-section-label">
                  <span>📋</span>
                  <span>综合融合报告</span>
                  {activePaper.title && activePaper.title !== activePaper.filename && (
                    <span className="content-section-badge">{activePaper.title}</span>
                  )}
                </div>
                {activePaper.status === 'done' && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--success)' }}>✓ 完成</span>
                )}
              </div>
              <div className="content-section-body">
                {enableReasoning && (
                  <ReasoningSection
                    contentKey={`${activePaperId}:final:r`}
                    getContent={getContent} tick={tick}
                  />
                )}
                {getContent(`${activePaperId}:final`) ? (
                  <StreamContent contentKey={`${activePaperId}:final`} getContent={getContent} tick={tick} />
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
                    {activePaper.status === 'analyzing' ? '等待各角度完成后生成综合报告...' : '暂无内容'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Individual angle content */
            <div className="content-section fade-in">
              <div className="content-section-header">
                <div className="content-section-label">
                  <span>🔍</span>
                  <span>{activeAngle}</span>
                  {activePaper.angles?.[activeAngle]?.status === 'done' && (
                    <span style={{ color: 'var(--success)', fontSize: 11, marginLeft: 4 }}>✓</span>
                  )}
                  {activePaper.angles?.[activeAngle]?.status === 'streaming' && (
                    <span style={{ color: 'var(--brand)', fontSize: 11, marginLeft: 4, animation: 'pulse 1s ease-in-out infinite' }}>●</span>
                  )}
                </div>
                {activePaper.title && activePaper.title !== activePaper.filename && (
                  <span className="content-section-badge" style={{ marginLeft: 'auto' }}>{activePaper.title}</span>
                )}
              </div>
              <div className="content-section-body">
                {enableReasoning && (
                  <ReasoningSection
                    contentKey={`${activePaperId}:${activeAngle}:r`}
                    getContent={getContent} tick={tick}
                  />
                )}
                {getContent(`${activePaperId}:${activeAngle}`) ? (
                  <StreamContent contentKey={`${activePaperId}:${activeAngle}`} getContent={getContent} tick={tick} />
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
                    {activePaper.status === 'analyzing' ? '分析中，请稍候...' : '暂无内容'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error display */}
          {activePaper.status === 'error' && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(201,92,92,0.08)',
              border: '1px solid rgba(201,92,92,0.2)',
              borderRadius: 'var(--r)',
              color: 'var(--error)',
              fontSize: 13,
            }}>
              ✕ 分析失败：{activePaper.error || '未知错误'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Overview grid for all papers ── */
function PapersOverview({ papers, getContent, tick, onSelectPaper }) {
  return (
    <div className="papers-overview">
      {papers.map(p => {
        const finalContent = getContent(`${p.id}:final`)
        const summary = finalContent ? finalContent.slice(0, 300) : ''
        return (
          <div key={p.id} className="paper-card" onClick={() => onSelectPaper(p.id)} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div className="paper-card-title">{p.title}</div>
              <span className={`paper-status-chip ${p.status}`}>
                {p.status === 'analyzing' && '⟳ 分析中'}
                {p.status === 'done' && '✓ 完成'}
                {p.status === 'error' && '✕ 失败'}
                {p.status === 'pending' && '· 等待'}
              </span>
            </div>
            <div className="paper-card-meta">
              <span>📄</span>
              <span>{p.filename}</span>
            </div>
            {summary && (
              <div className="paper-card-summary">{summary}...</div>
            )}
            {!summary && p.status === 'analyzing' && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>分析进行中...</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
