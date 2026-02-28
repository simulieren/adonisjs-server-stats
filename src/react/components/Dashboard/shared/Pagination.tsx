import React, { useCallback, useMemo } from 'react'

import { getPageNumbers } from '../../../../core/pagination.js'

interface PaginationProps {
  page: number
  lastPage: number
  total: number
  onPageChange: (page: number) => void
  className?: string
}

/**
 * Pagination controls with page numbers and prev/next buttons.
 */
export function Pagination({
  page,
  lastPage,
  total,
  onPageChange,
  className = '',
}: PaginationProps) {
  const pages = useMemo(() => getPageNumbers(page, lastPage), [page, lastPage])

  const handlePrev = useCallback(() => {
    if (page > 1) onPageChange(page - 1)
  }, [page, onPageChange])

  const handleNext = useCallback(() => {
    if (page < lastPage) onPageChange(page + 1)
  }, [page, lastPage, onPageChange])

  if (lastPage <= 1) return null

  return (
    <div className={`ss-dash-pagination ${className}`}>
      <span className="ss-dash-page-info">
        Page {page} of {lastPage} ({total} total)
      </span>
      <div className="ss-dash-pagination-controls">
        <button
          type="button"
          className="ss-dash-page-btn"
          onClick={handlePrev}
          disabled={page <= 1}
        >
          &laquo; Prev
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="ss-dash-page-ellipsis">
              ...
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`ss-dash-page-btn ${p === page ? 'ss-dash-active' : ''}`}
              onClick={() => onPageChange(p as number)}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className="ss-dash-page-btn"
          onClick={handleNext}
          disabled={page >= lastPage}
        >
          Next &raquo;
        </button>
      </div>
    </div>
  )
}
