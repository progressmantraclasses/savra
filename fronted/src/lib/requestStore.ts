export type JobStatus = 'queued' | 'processing' | 'done' | 'failed'

export interface RequestRecord {
  jobId: string
  topic: string
  grade: string
  subject: string
  numSlides: number
  status: JobStatus
  outputUrl: string | null
  error: string | null
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'savra-request-history-v1'

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function sortRequests(requests: RequestRecord[]) {
  return [...requests].sort((left, right) => {
    const rightTime = right.updatedAt ?? right.createdAt
    const leftTime = left.updatedAt ?? left.createdAt
    return rightTime - leftTime
  })
}

function normalizeRequest(record: Partial<RequestRecord>): RequestRecord {
  const now = Date.now()

  return {
    jobId: record.jobId ?? '',
    topic: record.topic ?? '',
    grade: record.grade ?? '',
    subject: record.subject ?? '',
    numSlides: record.numSlides ?? 0,
    status: record.status ?? 'queued',
    outputUrl: record.outputUrl ?? null,
    error: record.error ?? null,
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? now,
  }
}

export function loadRequests(): RequestRecord[] {
  if (!isBrowser()) {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as Partial<RequestRecord>[]
    return sortRequests(parsed.map(normalizeRequest))
  } catch {
    return []
  }
}

export function saveRequests(requests: RequestRecord[]) {
  if (!isBrowser()) {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sortRequests(requests)))
}

export function upsertRequest(record: Partial<RequestRecord>) {
  const normalized = normalizeRequest(record)
  const current = loadRequests()
  const next = current.filter(request => request.jobId !== normalized.jobId)

  next.unshift(normalized)
  saveRequests(next)

  return normalized
}

export function updateRequest(jobId: string, patch: Partial<RequestRecord>) {
  const current = loadRequests()
  let updated: RequestRecord | null = null

  const next = current.map(request => {
    if (request.jobId !== jobId) {
      return request
    }

    updated = {
      ...request,
      ...patch,
      jobId,
      updatedAt: Date.now(),
    }

    return updated
  })

  if (updated) {
    saveRequests(next)
  }

  return updated
}

export function getRequest(jobId: string) {
  return loadRequests().find(request => request.jobId === jobId) ?? null
}

export function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function formatTimestamp(ms: number) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

export function getStatusLabel(status: JobStatus) {
  switch (status) {
    case 'queued':
      return 'Waiting in queue'
    case 'processing':
      return 'Generating slides'
    case 'done':
      return 'Ready to preview'
    case 'failed':
      return 'Generation failed'
  }
}

export function getActivityCopy(record: RequestRecord) {
  switch (record.status) {
    case 'queued':
      return 'Your request is waiting for the worker.'
    case 'processing':
      return 'The model is drafting content, building the deck, and uploading it.'
    case 'done':
      return 'The presentation has been uploaded and is ready for preview or download.'
    case 'failed':
      return record.error ?? 'The job could not be completed.'
  }
}

export function getProgressValue(record: RequestRecord, now = Date.now()) {
  const elapsedSeconds = (now - record.createdAt) / 1000

  if (record.status === 'done' || record.status === 'failed') {
    return 100
  }

  if (record.status === 'queued') {
    return Math.min(28, 8 + elapsedSeconds * 1.8)
  }

  return Math.min(94, 32 + elapsedSeconds * 1.25)
}

export function getOfficePreviewUrl(outputUrl: string | null) {
  if (!outputUrl) {
    return null
  }

  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(outputUrl)}`
}