import React, { useState, useMemo } from 'react'

import { timeAgo, formatTime } from '../../../../core/formatters.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { useResizableTable } from '../../../hooks/useResizableTable.js'
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
    return items.filter(
      (e) =>
        (e.event || '').toLowerCase().includes(lower) ||
        (e.data || '').toLowerCase().includes(lower)
    )
  }, [data, search])

  const tableRef = useResizableTable([events])

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
          <colgroup>
            <col style={{ width: '50px' }} />
            <col style={{ width: '20%' }} />
            <col />
            <col style={{ width: '80px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Event</th>
              <th>Data</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map((evt) => {
              const ts =
                evt.timestamp ||
                (evt as unknown as Record<string, number>).created_at ||
                (evt as unknown as Record<string, number>).createdAt
              return (
                <tr key={evt.id}>
                  <td className="ss-dbg-c-dim" style={{ whiteSpace: 'nowrap' }}>
                    {evt.id}
                  </td>
                  <td className="ss-dbg-event-name">{evt.event}</td>
                  <td className="ss-dbg-event-data">
                    <JsonViewer data={evt.data} maxPreviewLength={80} classPrefix="ss-dbg" />
                  </td>
                  <td className="ss-dbg-event-time" title={formatTime(ts)}>
                    {timeAgo(ts)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default EventsTab
