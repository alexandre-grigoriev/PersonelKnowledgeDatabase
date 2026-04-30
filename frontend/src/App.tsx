import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import KbDashboard from './pages/KbDashboard'
import Ingest from './pages/Ingest'
import Query from './pages/Query'
import Archive from './pages/Archive'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/kb" replace />} />
        <Route path="kb" element={<KbDashboard />} />
        <Route path="ingest" element={<Ingest />} />
        <Route path="query" element={<Query />} />
        <Route path="archive" element={<Archive />} />
      </Route>
    </Routes>
  )
}
