'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

function ErrorBoundaryFallback() {
  const { t } = useI18n()

  return (
    <div className="grid h-full place-items-center bg-base-200 px-6 text-base-content">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-8 text-center shadow-sm">
        <div className="text-lg font-semibold">{t('errorBoundary.title')}</div>
        <p className="text-sm text-base-content/70">{t('errorBoundary.description')}</p>
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center rounded-[var(--radius-field)] bg-primary px-5 text-sm font-semibold text-primary-content transition hover:opacity-90"
          onClick={() => window.location.reload()}
        >
          {t('errorBoundary.reload')}
        </button>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[joplot] Unhandled render error', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return <ErrorBoundaryFallback />
    }

    return this.props.children
  }
}
