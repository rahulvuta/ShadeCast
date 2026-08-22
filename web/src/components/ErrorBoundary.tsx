import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ShadeCast]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" className="mx-auto max-w-lg p-6">
          <p className="text-lg font-bold">Something went wrong</p>
          <p className="mt-2 text-sm text-[var(--muted)]">{this.state.error.message}</p>
          <button
            type="button"
            className="btn-primary touch-target mt-4 rounded px-4 py-2 text-sm"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
