import { useRef, useState } from 'react'

export default function UploadZone({ files, onFilesChange }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  function handleFiles(newFiles) {
    const pdfs = Array.from(newFiles).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    if (pdfs.length) onFilesChange(pdfs)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  function removeFile(index) {
    const next = files.filter((_, i) => i !== index)
    onFilesChange(next.length ? next : [])
  }

  const hasFiles = files && files.length > 0

  return (
    <div
      className={`upload-zone${dragOver ? ' drag-over' : ''}`}
      onClick={() => !hasFiles && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)}
      />

      {!hasFiles ? (
        <>
          <div className="upload-zone-icon">📄</div>
          <div className="upload-zone-text">拖拽 PDF 到此处，或点击选择文件</div>
          <div className="upload-zone-hint">支持多篇论文同时上传</div>
        </>
      ) : (
        <>
          <div className="upload-zone-files">
            {files.map((f, i) => (
              <div key={i} className="upload-file-tag">
                <span className="upload-file-tag-icon">📄</span>
                <span className="upload-file-tag-name">{f.name}</span>
                <button
                  className="upload-clear-btn"
                  onClick={e => { e.stopPropagation(); removeFile(i) }}
                  title="移除"
                >✕</button>
              </div>
            ))}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 4 }}
            onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
          >
            + 继续添加文件
          </button>
        </>
      )}
    </div>
  )
}
