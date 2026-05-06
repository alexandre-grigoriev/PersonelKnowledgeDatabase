import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../api/client'
import type { Settings } from '../types'

const GEMINI_MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recommended)' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
]

const EMBEDDING_MODELS = [
  { value: 'gemini-embedding-001', label: 'Gemini Embedding 001' },
  { value: 'gemini-embedding-2', label: 'Gemini Embedding 2' },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const data = await getSettings()
      setSettings(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async (newSettings: Partial<Settings>) => {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateSettings(newSettings)
      setSettings(updated)
      alert('Settings saved successfully.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="contentPanel">
        <div className="contentHeader">
          <div className="contentTitle">Settings</div>
        </div>
        <div className="contentBody">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="contentPanel">
        <div className="contentHeader">
          <div className="contentTitle">Settings</div>
        </div>
        <div className="contentBody">
          <p>Failed to load settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="contentPanel">
      <div className="contentHeader">
        <div className="contentTitle">Settings</div>
      </div>
      <div className="contentBody">
        <div className="settingsSection">
          <h2>AI Model Configuration</h2>

          <div className="settingItem">
            <label htmlFor="geminiModel">Gemini Model:</label>
            <select
              id="geminiModel"
              value={settings.geminiModel}
              onChange={(e) => setSettings({ ...settings, geminiModel: e.target.value })}
              disabled={saving}
            >
              {GEMINI_MODELS.map(model => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settingItem">
            <label htmlFor="geminiEmbedModel">Embedding Model:</label>
            <select
              id="geminiEmbedModel"
              value={settings.geminiEmbedModel}
              onChange={(e) => setSettings({ ...settings, geminiEmbedModel: e.target.value })}
              disabled={saving}
            >
              {EMBEDDING_MODELS.map(model => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn btnPrimary"
            onClick={() => saveSettings(settings)}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>

          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </div>
  )
}