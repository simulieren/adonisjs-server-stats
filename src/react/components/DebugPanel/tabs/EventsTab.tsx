import React, { useState, useMemo } from 'react'
import type { EventRecord, DebugPanelProps } from '../../../../core/types.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { timeAgo } from '../../../../core/formatters.js'
import { JsonViewer } from '../../shared/JsonViewer.js'

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
        <table className="ss-dbg-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th>Event</th>
              <th>Data</th>
              <th style={{ width: '80px' }}>Time</th>
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
