import { Component, type ErrorInfo, type ReactNode } from "react";

type InstanceBoundaryProps = {
  fallback: ReactNode;
  onFailure(reason: string): void;
  children: ReactNode;
};

type InstanceBoundaryState = { failed: boolean };

export function boundaryKey(
  pluginKey: string,
  contributionId: string,
  exportName: string,
  revision: string | undefined,
): string {
  return [pluginKey, contributionId, exportName, revision ?? ""].join("\u0000");
}

export class InstanceBoundary extends Component<InstanceBoundaryProps, InstanceBoundaryState> {
  override state: InstanceBoundaryState = { failed: false };

  static getDerivedStateFromError(): InstanceBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(cause: Error, info: ErrorInfo): void {
    this.props.onFailure(`${cause.message}${info.componentStack ?? ""}`);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
