import axios from 'axios'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  formatElapsed,
  formatTimestamp,
  getActivityCopy,
  getOfficePreviewUrl,
  getProgressValue,
  getRequest,
  getStatusLabel,
  updateRequest,
  type RequestRecord,
} from '../lib/requestStore'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'
const POLL_INTERVAL_MS = 2000

function StatusBadge({ status }: { status: RequestRecord['status'] }) {
  const badgeClass =
    status === 'queued'
      ? 'badge-queued'
      : status === 'processing'
        ? 'badge-processing'
        : status === 'done'
          ? 'badge-done'
          : 'badge-failed'

  return <span className={`badge ${badgeClass}`}>{getStatusLabel(status).toUpperCase()}</span>
}

export default function JobPage() {
  const { jobId } = useParams()
  const [now, setNow] = useState(Date.now())
  const [request, setRequest] = useState<RequestRecord | null>(() => (jobId ? getRequest(jobId) : null))

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clock)
  }, [])

  useEffect(() => {
    if (!jobId) {
      return
    }

    let cancelled = false

    async function poll() {
      try {
        const { data } = await axios.get(`${BACKEND_URL}/status/${jobId}`)
        if (cancelled) {
          return
        }

        const next = updateRequest(jobId, {
          status: data.status,
          outputUrl: data.output_url ?? null,
          error: data.error ?? null,
        })

        if (next) {
          setRequest(next)
        }

        if (data.status === 'done' || data.status === 'failed') {
          return
        }
      } catch {
        // Keep polling through network blips.
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [jobId])

  if (!jobId) {
    return <Navigate to="/" replace />
  }

  if (!request) {
    return (
      <div className="panel p-8 text-center">
        <h2 className="display-font text-2xl font-semibold">Request not found</h2>
        <p className="mt-2 text-sm text-zinc-400">This job is not in the local history on this browser.</p>
        <Link to="/queue" className="btn-primary mt-6 inline-flex">
          Open queue
        </Link>
      </div>
    )
  }

  const progress = getProgressValue(request, now)
  const previewUrl = getOfficePreviewUrl(request.outputUrl)

  return (
    <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] animate-fade-up">
      <div className="panel p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={request.status} />
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
            Job ID {request.jobId}
          </span>
        </div>

        <h2 className="display-font mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {request.topic}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {request.subject} · {request.grade} · {request.numSlides} slides
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Elapsed</p>
            <p className="display-font mt-2 text-2xl font-semibold">{formatElapsed(now - request.createdAt)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Created</p>
            <p className="display-font mt-2 text-lg font-semibold">{formatTimestamp(request.createdAt)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Updated</p>
            <p className="display-font mt-2 text-lg font-semibold">{formatTimestamp(request.updatedAt)}</p>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
            <span>Live progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Current stage</p>
          <h3 className="display-font mt-2 text-2xl font-semibold text-white">{getStatusLabel(request.status)}</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{getActivityCopy(request)}</p>

          <div className="mt-5 space-y-3 text-sm text-zinc-300">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${request.status !== 'queued' ? 'bg-emerald-400' : 'bg-violet-400'}`} />
              Submitted to queue
            </div>
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${request.status === 'processing' || request.status === 'done' ? 'bg-emerald-400' : 'bg-white/20'}`} />
              Generating content and slides
            </div>
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${request.status === 'done' ? 'bg-emerald-400' : 'bg-white/20'}`} />
              Uploading and publishing PPT
            </div>
          </div>
        </div>

        {request.status === 'failed' && request.error && (
          <div className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
            {request.error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/queue" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/[0.08]">
            View queue
          </Link>
          <Link to="/" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/[0.08]">
            Create another
          </Link>
        </div>
      </div>

      <div className="space-y-6">
        <div className="panel p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">PPT preview</p>
              <h3 className="display-font mt-2 text-2xl font-semibold text-white">Open the deck inside the app</h3>
            </div>
            {request.outputUrl && (
              <a href={request.outputUrl} target="_blank" rel="noreferrer" className="btn-primary shrink-0">
                Download
              </a>
            )}
          </div>

          {request.outputUrl ? (
            previewUrl ? (
              <div className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-black/20">
                <iframe
                  title="PPT preview"
                  src={previewUrl}
                  className="h-[520px] w-full"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-300">
                Preview is unavailable for this file type.
              </div>
            )
          ) : (
            <div className="mt-5 rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-zinc-400">
              The preview will appear here once the job finishes.
            </div>
          )}
        </div>

        <div className="panel p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Quick actions</p>
          <div className="mt-4 grid gap-3">
            {request.outputUrl ? (
              <>
                <a href={request.outputUrl} target="_blank" rel="noreferrer" className="btn-primary w-full">
                  Download PPTX
                </a>
                {previewUrl && (
                  <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm text-zinc-200 transition hover:bg-white/[0.08]">
                    Open preview in new tab
                  </a>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
                No download yet. Keep this page open while the job runs.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}