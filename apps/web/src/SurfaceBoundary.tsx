import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

/** Isolates a render failure to one workspace surface so a bad panel cannot unmount the app. */
export class SurfaceBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Failure is isolated to this surface. */ }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: '' }); }
  render() { return this.state.error ? <div className="notice" role="alert">This surface could not be displayed. Your conversation and saved state are retained.<details><summary>Error details</summary>{this.state.error}</details><button className="secondary" onClick={() => this.setState({ error: '' })}><RotateCcw size={14} />Retry rendering</button></div> : this.props.children; }
}
