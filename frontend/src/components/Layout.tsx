import { NavLink, Outlet } from 'react-router-dom'
import KbSelector from './KbSelector'

const NAV = [
  { to: '/kb',      label: 'Knowledge Bases' },
  { to: '/ingest',  label: 'Ingest' },
  { to: '/query',   label: 'Query' },
  { to: '/archive', label: 'Archive' },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-6 h-14">
          <span className="font-semibold text-brand-700 tracking-tight shrink-0">
            Scientific KB
          </span>

          <nav className="flex gap-1">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto">
            <KbSelector />
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
