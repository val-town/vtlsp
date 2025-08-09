import type { LSConnectionState } from "app/editor/ls/LSManager";
import { useLsClient } from "app/editor/ls/useLsClient";
import type { ProjectMeta } from "shared/types";

export function LSStatusDot({ project }: { project: ProjectMeta }) {
  const { connectionState } = useLsClient({ project });

  return (
    <div className={`size-8 flex items-center justify-center rounded-full bg-transparent transition group-focus:ring ${getStatusStyles(connectionState)}`}>
      <div className="size-2 rounded-full ease-out select-none bg-current" />
    </div>
  );
}

const styles = {
  root: cva(
    [
      "size-8",
      "flex items-center justify-center",
      "rounded-full",
      "bg-transparent",
      "transition",
      "group-focus:ring",
    ],
    {
      variants: {
        status: {
          connected: "text-orange-500 group-hover:bg-orange-100",
          healthy: "text-green-500 group-hover:bg-green-100",
          disconnected: "text-red-500 animate-pulse group-hover:bg-red-100",
          connecting: "text-yellow-500 animate-pulse group-hover:bg-yellow-500",
          reconnecting:
            "text-yellow-500 animate-pulse group-hover:bg-yellow-500",
        } satisfies Record<LSConnectionState, string>,
      },
      defaultVariants: {
        status: "disconnected",
      },
    }
  ),
  dot: cva(["size-2", "rounded-full", "ease-out", "select-none", "bg-current"]),
};
