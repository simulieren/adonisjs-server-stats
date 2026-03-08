import { clamp } from '../utils/math_helpers.js'

import type { InspectorManager } from './inspector_manager.js'
import type { HttpContext } from '@adonisjs/core/http'

const EMPTY_JOBS = { available: false, overview: null, stats: null, jobs: [], total: 0 }

/**
 * Handle GET /jobs — list jobs with optional status filter and search.
 */
export async function handleJobs(inspectors: InspectorManager, { request, response }: HttpContext) {
  const inspector = await inspectors.getQueueInspector()
  if (!inspector) return response.json(EMPTY_JOBS)

  const qs = request.qs()
  const page = Math.max(1, Number(qs.page) || 1)
  const perPage = clamp(Number(qs.perPage) || Number(qs.limit) || 25, 1, 100)

  try {
    const [overview, jobList] = await Promise.all([
      inspector.getOverview(),
      inspector.listJobs(qs.status || 'all', page, perPage),
    ])

    let jobs = jobList.jobs
    let total = jobList.total

    if (qs.search) {
      const term = qs.search.toLowerCase()
      jobs = jobs.filter(
        (j) => j.name?.toLowerCase().includes(term) || j.id?.toString().toLowerCase().includes(term)
      )
      total = jobs.length
    }

    return response.json({ available: true, overview, stats: overview, jobs, total, page, perPage })
  } catch {
    return response.json(EMPTY_JOBS)
  }
}

/**
 * Handle GET /jobs/:id — get a single job's details.
 */
export async function handleJobDetail(
  inspectors: InspectorManager,
  { params, response }: HttpContext
) {
  const inspector = await inspectors.getQueueInspector()
  if (!inspector) return response.notFound({ error: 'Queue not available' })

  try {
    const detail = await inspector.getJob(String(params.id))
    return detail ? response.json(detail) : response.notFound({ error: 'Job not found' })
  } catch {
    return response.notFound({ error: 'Job not found' })
  }
}

/**
 * Handle POST /jobs/:id/retry — retry a failed job.
 */
export async function handleJobRetry(
  inspectors: InspectorManager,
  { params, response }: HttpContext
) {
  const inspector = await inspectors.getQueueInspector()
  if (!inspector) return response.notFound({ error: 'Queue not available' })

  try {
    return (await inspector.retryJob(String(params.id)))
      ? response.json({ success: true })
      : response.badRequest({ error: 'Job could not be retried (not in failed state)' })
  } catch {
    return response.internalServerError({ error: 'Retry failed' })
  }
}
