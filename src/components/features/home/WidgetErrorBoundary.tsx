"use client";

import { Component, type ReactNode } from "react";

/**
 * Keeps a widget whose view throws inside its own slot: the fallback (the
 * widget's error state) shows there, and the rest of the home stays.
 */
export class WidgetErrorBoundary extends Component<{ id: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[homeWidget] view_failed", { id: this.props.id, error: error instanceof Error ? error.name : "unknown" });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
