import { useEffect, useRef, useState } from 'react'
import { listKbs, ingestPdf, getJobStatus } from '../api/client'
import type { Kb, IngestJob } from '../types'

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div
        className="bg-brand-600 h-2 rounded-full transition-all duration-500"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

export default function Ingest() {
  const [kbs, setKbs]         = useState<Kb[]>([])
  const [kbId, setKbId]       = useState('')
  const [file, setFile]       = useState<File | null>(null)
  const [title, setTitle]     = useState('')
  const [authors, setAuthors] = useState('')
  const [doi, setDoi]         = useState('')
  const [year, setYear]       = useState('')
  const [dragging, setDragging] = useState(false)
  const [job, setJob]         = useState<IngestJob | null>(null)
  const [error, setError]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listKbs().then(data => {
      setKbs(data)
      if (data.length > 0) setKbId(localStorage.getItem('skb_active_kb') ?? data[0].id)
    })
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const startPoll = (jobId: string, kbId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const status = await getJobStatus(jobId, kbId)
        setJob(status)
        if (status.status === 'done' || status.status === 'failed') {
          clearInterval(pollRef.current!)
        }
      } catch { /* backend temporarily unavailable */ }
    }, 2000)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.type === 'application/pdf') { setFile(f); setTitle(f.name.replace('.pdf', '')) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !kbId) return
    setSubmitting(true); setError(''); setJob(null)
    try {
      const result = await ingestPdf(kbId, file, {
        title: title || file.name,
        authors: authors ? authors.split(',').map(a => a.trim()) : [],
        doi: doi || undefined,
        year: year ? parseInt(year) : undefined,
      })
      setJob(result)
      if (result.jobId) startPoll(result.jobId, kbId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const statusColor = job?.status === 'done' ? 'text-green-600' : job?.status === 'failed' ? 'text-red-600' : 'text-yellow-600'

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Ingest PDF</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* KB selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Knowledge base</label>
          <select
            value={kbId}
            onChange={e => setKbId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          >
            <option value="">Select…</option>
            {kbs.map(kb => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>
        </div>

        {/* Drop zone */}
        <div
          ref={dropRef}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('pdf-input')?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          {file ? (
            <p className="text-sm font-medium text-gray-700">📄 {file.name} <span className="text-gray-400">({(file.size / 1024 / 1024).toFixed(2)} MB)</span></p>
          ) : (
            <>
              <p className="text-sm text-gray-500">Drop a PDF here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Max 100 MB</p>
            </>
          )}
          <input
            id="pdf-input" type="file" accept="application/pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setTitle(f.name.replace('.pdf', '')) } }}
          />
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Paper title" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Authors (comma-separated)</label>
            <input type="text" value={authors} onChange={e => setAuthors(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Smith J., Doe A." />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Year</label>
              <input type="number" value={year} onChange={e => setYear(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="2024" min="1900" max="2100" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">DOI</label>
              <input type="text" value={doi} onChange={e => setDoi(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="10.1016/..." />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={!file || !kbId || submitting}
          className="w-full bg-brand-600 text-white py-2 rounded font-medium text-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Uploading…' : 'Start ingestion'}
        </button>
      </form>

      {/* Job status */}
      {job && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Ingestion job</span>
            <span className={`text-sm font-medium capitalize ${statusColor}`}>{job.status}</span>
          </div>
          <ProgressBar value={job.progress} />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{job.step ? `Step: ${job.step}` : '—'}</span>
            <span>{job.progress}%</span>
          </div>
          {job.status === 'done' && (
            <p className="text-xs text-green-600">✓ Document ingested successfully. {job.chunksDone} chunks created.</p>
          )}
          {job.status === 'failed' && (
            <p className="text-xs text-red-600">✗ {job.error}</p>
          )}
          {job.jobId && (
            <p className="text-xs text-gray-400 font-mono">Job ID: {job.jobId}</p>
          )}
        </div>
      )}
    </div>
  )
}
