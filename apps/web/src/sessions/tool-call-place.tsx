import { toolCallPlaceId } from "@sovereign/protocol";
import { ToolCall, type ToolCallProps } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import { HostPlace } from "../places/place-host.tsx";

export type ToolCallPlaceProps = ToolCallProps & {
  sessionId: string;
  projectId?: string;
  toolCallId: string;
};

export function ToolCallPlace(props: ToolCallPlaceProps): ReactNode {
  const { sessionId, projectId, toolCallId, ...toolCall } = props;

  return (
    <HostPlace
      id={toolCallPlaceId(toolCall.toolName)}
      context={{
        ...(projectId === undefined ? {} : { project: projectId }),
        subject: { sessionId, toolCallId, toolName: toolCall.toolName },
      }}
      builtIn={<ToolCall {...toolCall} />}
    />
  );
}
