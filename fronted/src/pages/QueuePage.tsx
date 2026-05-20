import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  formatElapsed,
  formatTimestamp,
  getActivityCopy,
  getOfficePreviewUrl,
  getProgressValue,
  getStatusLabel,
  loadRequests,
  type RequestRecord,
} from '../lib/requestStore'

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

export default function QueuePage() {
  const [now, setNow] = useState(Date.now())
  const [requests, setRequests] = useState(() => loadRequests())

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
      setRequests(loadRequests())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const activeRequests = requests.filter(request => request.status === 'queued' || request.status === 'processing')
  const finishedRequests = requests.filter(request => request.status === 'done' || request.status === 'failed')

  return (
    <section className="space-y-6 animate-fade-up">
      <div className="panel flex flex-col gap-4 p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.25em] text-zinc-500">
            Queue view
          </div>
          <h2 className="display-font mt-4 text-3xl font-semibold tracking-tight">Your saved requests</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            This page keeps your history on the device, with live status and elapsed timers for every request.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Total</p>
            <p className="display-font mt-1 text-xl font-semibold">{requests.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Live</p>
            <p className="display-font mt-1 text-xl font-semibold text-amber-300">{activeRequests.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Ready</p>
            <p className="display-font mt-1 text-xl font-semibold text-emerald-300">{finishedRequests.filter(request => request.status === 'done').length}</p>
          </div>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="panel p-8 text-center">
          <h3 className="display-font text-2xl font-semibold">No requests yet</h3>
          <p className="mt-2 text-sm text-zinc-400">Create your first PPT from the home page and it will appear here automatically.</p>
          <Link to="/" className="btn-primary mt-6 inline-flex">
            Create request
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map(request => {
            const progress = getProgressValue(request, now)
            const previewUrl = getOfficePreviewUrl(request.outputUrl)

            return (
              <article key={request.jobId} className="panel overflow-hidden p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={request.status} />
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
                        {formatElapsed(now - request.createdAt)} elapsed
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
                        Updated {formatTimestamp(request.updatedAt)}
                      </span>
                    </div>

                    <div>
                      <h3 className="display-font text-xl font-semibold text-white">{request.topic}</h3>
                      <p className="mt-1 text-sm text-zinc-400">
                        {request.subject} · {request.grade} · {request.numSlides} slides
                      </p>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">
                        {getActivityCopy(request)}
                      </p>
                    </div>

                    <div className="w-full max-w-2xl">
                      <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                        <span>Progress</span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:w-[240px]">
                    <Link to={`/job/${request.jobId}`} className="btn-primary w-full">
                      Open details
                    </Link>

                    {request.outputUrl ? (
                      <>
                        {previewUrl && (
                          <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm text-zinc-200 transition hover:bg-white/[0.08]">
                            Preview PPT
                          </a>
                        )}
                        <a href={request.outputUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm text-zinc-200 transition hover:bg-white/[0.08]">
                          Download PPT
                        </a>
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-center text-xs uppercase tracking-[0.25em] text-zinc-500">
                        {request.status === 'failed' ? 'Needs retry' : 'Preview available when ready'}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}