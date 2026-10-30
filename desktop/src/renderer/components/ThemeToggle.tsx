import type { ThemePreference } from '../lib/theme'

interface Props {
  preference: ThemePreference
  onChange: (preference: ThemePreference) => void
}

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
]

function MonitorIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1" />
      <path d="M5.5 13.5h5M8 11v2.5" strokeLinecap="round" />
    </svg>
  )
}

function SunIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" />
      <path
        d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path
        d="M13.1 9.4A5.6 5.6 0 0 1 6.6 2.9a5.6 5.6 0 1 0 6.5 6.5Z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function iconFor(value: ThemePreference): JSX.Element {
  if (value === 'light') return <SunIcon />
  if (value === 'dark') return <MoonIcon />
  return <MonitorIcon />
}

export function ThemeToggle({ preference, onChange }: Props): JSX.Element {
  return (
    <div className="theme-switch" role="group" aria-label="Tema de la interfaz">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={preference === option.value ? 'active' : undefined}
          aria-pressed={preference === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          {iconFor(option.value)}
        </button>
      ))}
    </div>
  )
}
