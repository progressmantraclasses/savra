import { useNavigate } from 'react-router-dom'
import PptForm from '../components/PptForm'
import { loadRequests } from '../lib/requestStore'

export default function HomePage() {
  const navigate = useNavigate()
  const requests = loadRequests()
  const activeCount = requests.filter(request => request.status === 'queued' || request.status === 'processing').length
  const completedCount = requests.filter(request => request.status === 'done').length

  return (
    <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="panel overflow-hidden p-6 sm:p-8">
        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.3em] text-zinc-400">
          Live generation flow
        </div>
        <h2 className="display-font mt-5 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Track each presentation request like a real product queue.
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
          Submit a topic, watch the timer tick, see the current stage, and open a preview or download once the PPT is ready.
          Every request stays saved in this browser so you can revisit it later from the queue page.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Queued</p>
            <p className="display-font mt-2 text-2xl font-semibold">{activeCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Done</p>
            <p className="display-font mt-2 text-2xl font-semibold">{completedCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Saved on</p>
            <p className="display-font mt-2 text-2xl font-semibold">This device</p>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-cyan-400/10 bg-cyan-400/5 p-5 text-sm text-cyan-100/90">
          <p className="font-medium text-white">What you’ll get</p>
          <p className="mt-2 leading-6 text-cyan-100/80">
            Queue status, live timer, progress bar, PPT preview, download link, and a request history page.
          </p>
        </div>
      </div>

      <div className="panel p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="display-font text-2xl font-semibold tracking-tight text-white">Create a presentation</h2>
            <p className="mt-1 text-sm text-zinc-500">Fill the form, then we’ll move you to the live job page.</p>
          </div>
        </div>

        <PptForm onJobStarted={(jobId) => navigate(`/job/${jobId}`)} />
      </div>
    </section>
  )
}