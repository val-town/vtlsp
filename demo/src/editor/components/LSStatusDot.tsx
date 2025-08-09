import type { LSConnectionState } from "app/editor/ls/LSManager";
import { useLsClient } from "app/editor/ls/useLsClient";
import type { ProjectMeta } from "shared/types";

const getStatusStyles = (status: LSConnectionState) => {
  switch (status) {
    case "connected":
      return "text-orange-500 group-hover:bg-orange-100";
    case "healthy":
      return "text-green-500 group-hover:bg-green-100";
    case "disconnected":
      return "text-red-500 animate-pulse group-hover:bg-red-100";
    case "connecting":
    case "reconnecting":
      return "text-yellow-500 animate-pulse group-hover:bg-yellow-500";
    default:
      return "text-red-500 animate-pulse group-hover:bg-red-100";
  }
};

export function LSStatusDot({ project }: { project: ProjectMeta }) {
  const { connectionState } = useLsClient({ project });

  return (
    <div className={`size-8 flex items-center justify-center rounded-full bg-transparent transition group-focus:ring ${getStatusStyles(connectionState)}`}>
      <div className="size-2 rounded-full ease-out select-none bg-current" />
    </div>
  );
}

