import { Component } from 'react'
import { AlertCircle } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
    this.handleReset = this.handleReset.bind(this)
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught an error:', error, info)
  }

  handleReset() {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-cream-50 flex items-center justify-center p-6">
          <div className="card max-w-sm w-full flex flex-col items-center gap-4 text-center">
            <AlertCircle className="text-brand-500" size={40} />
            <h2 className="section-heading">Something went wrong</h2>
            <p className="body-text">
              An unexpected error occurred. You can try again or reload the app.
            </p>
            <button className="btn-primary" onClick={this.handleReset}>
              Try again
            </button>
            <button className="btn-text" onClick={() => window.location.reload()}>
              Reload the app
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
