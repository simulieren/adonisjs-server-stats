import React, { useRef, useEffect } from 'react'

import { initSplitPane } from '../../../core/split-pane.js'

interface SplitPaneWrapperProps {
  children: [React.ReactNode, React.ReactNode]
  storageKey?: string
}

export function SplitPaneWrapper({ children, storageKey }: SplitPaneWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current && handleRef.current && topRef.current && bottomRef.current) {
      return initSplitPane({
        container: containerRef.current,
        handle: handleRef.current,
        topPane: topRef.current,
        bottomPane: bottomRef.current,
        storageKey,
      })
    }
  }, [storageKey])

  return (
    <div ref={containerRef} className="ss-split-container">
      <div ref={topRef} className="ss-split-top">
        {children[0]}
      </div>
      <div ref={handleRef} className="ss-split-handle" />
      <div ref={bottomRef} className="ss-split-bottom">
        {children[1]}
      </div>
    </div>
  )
}
