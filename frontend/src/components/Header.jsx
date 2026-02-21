export default function Header({ settingsOpen, onSettingsClick, providers, currentProviderId, onSyncCatalog, onHealthCheck }) {
  const currentProvider = providers?.find(p => p.id === currentProviderId)

  return (
    <header className="header">
      <button
        className={`header-settings-btn${settingsOpen ? ' active' : ''}`}
        onClick={onSettingsClick}
        title="模型配置"
      >
        ⚙
      </button>

      <div className="header-logo">
        <span className="header-logo-icon">🔬</span>
        <span className="header-logo-text">Paper Lens Studio</span>
        <span className="header-logo-sub">多模型论文解析</span>
      </div>

      {currentProvider && (
        <div className="provider-badge">
          <span>🤖</span>
          <span>{currentProvider.name}</span>
        </div>
      )}

      <div className="header-spacer" />

      <div className="header-actions">
        <button className="header-pill-btn" onClick={onSyncCatalog} title="同步 Provider 目录">
          ↻ 同步目录
        </button>
        <button className="header-pill-btn" onClick={onHealthCheck} title="健康检查">
          ♡ 健康检查
        </button>
      </div>
    </header>
  )
}
