import { useState } from 'react'

export default function AngleConfigList({ angleSpecs, onChange }) {
  const [expandedIdx, setExpandedIdx] = useState(null)

  function update(index, field, value) {
    const next = angleSpecs.map((s, i) => i === index ? { ...s, [field]: value } : s)
    onChange(next)
  }

  function remove(index) {
    if (angleSpecs.length <= 1) return
    onChange(angleSpecs.filter((_, i) => i !== index))
  }

  function add() {
    if (angleSpecs.length >= 8) return
    const next = [...angleSpecs, { title: '新角度', prompt: '' }]
    onChange(next)
    setExpandedIdx(next.length - 1)
  }

  return (
    <div>
      <div className="angle-list">
        {angleSpecs.map((spec, i) => (
          <div key={i} className="angle-item">
            <div
              className="angle-item-header"
              onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            >
              <span className="angle-drag-handle">⠿</span>
              <input
                className="angle-item-title-input"
                value={spec.title}
                onChange={e => { e.stopPropagation(); update(i, 'title', e.target.value) }}
                onClick={e => e.stopPropagation()}
                placeholder="角度标题"
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {expandedIdx === i ? '▲' : '▼'}
              </span>
              {angleSpecs.length > 1 && (
                <button
                  className="btn btn-ghost btn-xs"
                  style={{ color: 'var(--error)', marginLeft: 2 }}
                  onClick={e => { e.stopPropagation(); remove(i) }}
                  title="删除此角度"
                >✕</button>
              )}
            </div>
            {expandedIdx === i && (
              <div className="angle-item-body">
                <label className="field">
                  <span className="field-label">该角度提示词</span>
                  <textarea
                    value={spec.prompt}
                    onChange={e => update(i, 'prompt', e.target.value)}
                    placeholder="输入该角度希望大模型重点关注的分析要求..."
                    rows={3}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="angle-add-row" style={{ marginTop: 8 }}>
        <button
          className="btn btn-outline btn-sm"
          onClick={add}
          disabled={angleSpecs.length >= 8}
          style={{ width: '100%' }}
        >
          + 新增分析角度 {angleSpecs.length >= 8 ? '（最多8个）' : ''}
        </button>
      </div>
    </div>
  )
}
