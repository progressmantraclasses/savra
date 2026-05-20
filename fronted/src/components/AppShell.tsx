import { Link, Outlet, useLocation } from 'react-router-dom'
import { loadRequests } from '../lib/requestStore'

export default function AppShell() {
  const location = useLocation()
  const requests = loadRequests()
  const activeCount = requests.filter(request => request.status === 'queued' || request.status === 'processing').length

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#09090b] text-zinc-100">
      <div className="orb w-[650px] h-[650px] bg-violet-600 -top-56 -left-44" />
      <div className="orb w-[560px] h-[560px] bg-indigo-700 -bottom-44 -right-48" />
      <div className="orb w-[320px] h-[320px] bg-cyan-700 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="panel mb-6 flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-500 shadow-lg shadow-violet-900/40">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="display-font text-xl font-semibold tracking-tight sm:text-2xl">Savra AI</h1>
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">presentation queue</p>
            </div>
          </Link>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              to="/"
              className={`rounded-full px-4 py-2 transition ${location.pathname === '/' ? 'bg-white text-zinc-900' : 'bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'}`}
            >
              New request
            </Link>
            <Link
              to="/queue"
              className={`rounded-full px-4 py-2 transition ${location.pathname === '/queue' ? 'bg-white text-zinc-900' : 'bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'}`}
            >
              My requests
            </Link>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-emerald-300">
              {activeCount} live in queue
            </span>
          </div>
        </header>

        <main className="flex-1 pb-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}