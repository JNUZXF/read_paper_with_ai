import OutputArea from './OutputArea.jsx'

export default function RightPanel({
  papers, activePaperId, activeAngle,
  onSelectPaper, onSelectAngle,
  getContent, tick, enableReasoning, enableFinalReport,
}) {
  return (
    <main className="right-panel">
      <OutputArea
        papers={papers}
        activePaperId={activePaperId}
        activeAngle={activeAngle}
        onSelectPaper={onSelectPaper}
        onSelectAngle={onSelectAngle}
        getContent={getContent}
        tick={tick}
        enableReasoning={enableReasoning}
        enableFinalReport={enableFinalReport}
      />
    </main>
  )
}
