import type { ProjectMeta } from "shared/types";
import {
  CONTAINER_RESTART_WAIT,
  lsStateAtom,
  useLsClient,
} from "app/editor/ls/useLsClient";
import { useCallback, useState } from "react";
import { Dropdown } from "app/components/ui";
import { LSStatusChip } from "./LSStatusChip";
import { LSStatusDot } from "./LSStatusDot";
import {
  BookOpenIcon,
  PowerIcon,
  PowerOffIcon,
  RotateCwIcon,
} from "lucide-react";
import { trpc } from "app/integrations/trpcClient";
import { useRevalidator } from "@remix-run/react";
import toast from "react-hot-toast";
import { useSetAtom } from "jotai";

const DENOLS_DOCS_URL = "https://docs.val.town/reference/deno-lsp";

/**
 * Status indicator for the language server. Starts out as a dot, when clicked becomes a dropdown
 * menu with options to restart the language server or get logs.
 *
 * A "Hard restart" will stop the container and start a new one, while a "Restart" will
 * just redo the LSP handshake.
 */
export function LSStatusBox({ project }: { project: ProjectMeta }) {
  const { restartContainer, reloadLS, connectionState } = useLsClient({
    project,
  });
  const [isRestartCooldown, setIsRestartCooldown] = useState(false);

  const setLsState = useSetAtom(lsStateAtom);
  const revalidator = useRevalidator();

  const handleRestart = useCallback(
    (type: "hard" | "soft") => {
      // This is optimistic -- we change the state before the first heartbeat fails
      setLsState("reconnecting");
      if (type === "hard") {
        restartContainer();
        setIsRestartCooldown(true);
        setTimeout(() => {
          setIsRestartCooldown(false);
          // Matches the timeout in useLsClient before we attempt a reconnect
        }, CONTAINER_RESTART_WAIT);
      } else if (type === "soft") {
        reloadLS();
      }
    },
    [restartContainer, reloadLS, setLsState]
  );

  const updatePreferences = trpc.userPreferencesUpdate.useMutation({
    onSuccess() {
      revalidator.revalidate();
    },
  });

  const handleDisableDenols = useCallback(() => {
    return toast.promise(
      updatePreferences.mutateAsync({
        flagDenols: false,
      }),
      {
        loading: "Disabling DenoLS...",
        error: "Failed to disable DenoLS.",
        success: "DenoLS disabled. Go to editor settings to re-enable.",
      }
    );
  }, [updatePreferences]);

  return (
    <div className="absolute top-0 bottom-0 right-0 flex flex-col justify-end pointer-events-none">
      <div className="sticky z-10 bottom-4 pointer-events-none">
        <Dropdown.Root>
          <Dropdown.Trigger className="pointer-events-auto flex items-center group bg-transparent focus:outline-none cursor-pointer">
            <LSStatusDot project={project} />
          </Dropdown.Trigger>

          <Dropdown.Portal>
            <Dropdown.Content
              align="end"
              alignOffset={8}
              sideOffset={2}
              side="top"
              className="w-[256px]"
              onCloseAutoFocus={(e) => {
                // allow focus to move to editor/etc
                e.preventDefault();
              }}
            >
              <div className="p-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">DenoLS</div>
                <LSStatusChip project={project} />
              </div>

              {connectionState !== "healthy" && (
                <div className="text-xs p-2">
                  DenoLS can take up to 15 seconds to boot for the first time
                </div>
              )}

              <Dropdown.Separator />

              <Dropdown.Item
                onSelect={(e) => {
                  e.preventDefault();
                  handleRestart("soft");
                }}
              >
                <RotateCwIcon size={16} />
                Restart
              </Dropdown.Item>

              <Dropdown.Item
                onSelect={(e) => {
                  e.preventDefault();
                  handleRestart("hard");
                }}
                disabled={isRestartCooldown}
              >
                <PowerIcon size={16} />
                Hard restart
              </Dropdown.Item>

              <Dropdown.Item
                type="danger"
                onSelect={(e) => {
                  e.preventDefault();
                  void handleDisableDenols();
                }}
              >
                <PowerOffIcon size={16} />
                Disable DenoLS
              </Dropdown.Item>

              <Dropdown.Separator />

              <Dropdown.Item asChild>
                <a
                  href={DENOLS_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Documentation"
                >
                  <BookOpenIcon size={16} />
                  Docs
                </a>
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
    </div>
  );
}

