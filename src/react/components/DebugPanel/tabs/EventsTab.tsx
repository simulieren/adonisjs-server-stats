import React, { useState, useMemo, useRef, useEffect } from 'react'

import { timeAgo } from '../../../../core/formatters.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { JsonViewer } from '../../shared/JsonViewer.js'

import type { EventRecord, DebugPanelProps } from '../../../../core/types.js'

interface EventsTabProps {
  options?: DebugPanelProps
}

export function EventsTab({ options }: EventsTabProps) {
  const { data, isLoading, error } = useDebugData<{ events: EventRecord[] }>('events', options)
  const [search, setSearch] = useState('')

  const events = useMemo(() => {
    const items = data?.events || []
    if (!search) return items
    const lower = search.toLowerCase()
    return items.filter((e) => e.event.toLowerCase().includes(lower))
  }, [data, search])

  const tableRef = useRef<HTMLTableElement>(null)
  useEffect(() => {
    if (tableRef.current) {
      return initResizableColumns(tableRef.current)
    }
  }, [events])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading events...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  return (
    <div>
      <div className="ss-dbg-search-bar">
        <input
          type="text"
          className="ss-dbg-search"
          placeholder="Filter events..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ss-dbg-summary">{events.length} events</span>
      </div>

      {events.length === 0 ? (
        <div className="ss-dbg-empty">No events captured</div>
      ) : (
        <table ref={tableRef} className="ss-dbg-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Event</th>
              <th>Data</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map((evt) => (
              <tr key={evt.id}>
                <td>{evt.id}</td>
                <td>
                  <span className="ss-dbg-event-name">{evt.event}</span>
                </td>
                <td className="ss-dbg-event-data">
                  <JsonViewer data={evt.data} maxPreviewLength={80} />
                </td>
                <td className="ss-dbg-event-time">{timeAgo(evt.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default EventsTab
