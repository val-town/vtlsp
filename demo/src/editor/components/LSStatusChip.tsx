import type { LSConnectionState } from "app/editor/ls/LSManager";
import { useLsClient } from "app/editor/ls/useLsClient";
import type { ProjectMeta } from "shared/types";
import { tag } from "app/style";

export function LSStatusChip({ project }: { project: ProjectMeta }) {
  const { connectionState } = useLsClient({ project });

  return (
    <div className={tag({ type: tagTypeMap[connectionState], size: "xs" })}>
      <span className="text-xs">{messages[connectionState]}</span>
    </div>
  );
}

const tagTypeMap = {
  healthy: "positive",
  disconnected: "danger",
  connected: "warning",
  connecting: "warning",
  reconnecting: "warning",
} as const satisfies Record<LSConnectionState, ReturnType<typeof tag>>;

const messages = {
  healthy: "Healthy",
  connected: "Waiting",
  disconnected: "Disconnected",
  connecting: "Connecting",
  reconnecting: "Restarting",
} as const satisfies Record<LSConnectionState, string>;
