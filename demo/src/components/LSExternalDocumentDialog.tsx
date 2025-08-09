import { useCodemirror } from "app/hooks/useCodemirror";
import { atom, useAtom } from "jotai";
import * as Dialog from "app/components/ui/Dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCodemirrorExtensions } from "app/components/editors";
import { noop } from "es-toolkit";
import { withLinesSelected } from "app/editor/linkToLines";
import { VisuallyHidden } from "radix-ui";
import { Compartment } from "@codemirror/state";
import { ExternalLinkIcon, ArrowLeftIcon } from "lucide-react";
import { button } from "app/style";
import { useLsCodemirror } from "../useLsCodemirror";
import type { ProjectMeta } from "shared/types";
import { LSStatusBox } from "./LSStatusBox";
import { Toolbar } from "radix-ui";

interface LSExternalDocument {
  path: string;
  text: string;
  lineStart: number;
  lineEnd: number;
}

export const lsExternalDocumentConfig = atom<null | LSExternalDocument>(null);
export const lsPrevExternalDocumentConfig = atom<null | LSExternalDocument>(
  null,
);

const highlightCompartment = new Compartment();

export function LSExternalDocumentDialog({
  project,
}: {
  project: ProjectMeta;
}) {
  const [lsExternalConfig, setLsExternalConfig] = useAtom(
    lsExternalDocumentConfig,
  );
  const [previousConfig, setPreviousConfig] = useAtom(
    lsPrevExternalDocumentConfig,
  );

  const handleGoBack = useCallback(() => {
    if (previousConfig) {
      setLsExternalConfig(previousConfig);
      setPreviousConfig(null);
    }
  }, [previousConfig, setLsExternalConfig, setPreviousConfig]);

  if (!lsExternalConfig) return null;

  return (
    <Dialog.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          setLsExternalConfig(null);
          setPreviousConfig(null);
        }
      }}
    >
      <Dialog.Portal>
        <VisuallyHidden.Root>
          <Dialog.Title>
            {decodeURIComponent(lsExternalConfig.path)}'s content
          </Dialog.Title>
        </VisuallyHidden.Root>

        <Dialog.Description className="sr-only">
          {decodeURIComponent(lsExternalConfig.path)}'s content
        </Dialog.Description>

        <Dialog.Overlay />

        <Dialog.Content>
          <LSExternalDocumentDialogContent
            config={lsExternalConfig}
            project={project}
            showBackButton={!!previousConfig}
            onGoBack={handleGoBack}
          />

          <LSStatusBox project={project} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LSExternalDocumentToolbar({
  config,
  showBackButton,
  onGoBack,
}: {
  config: LSExternalDocument;
  showBackButton: boolean;
  onGoBack: () => void;
}) {
  const valTownUrl = useMemo(() => {
    return convertDenoUrlToValTown(config.path);
  }, [config.path]);

  return (
    <Toolbar.Root className="flex items-center justify-between min-w-0 p-2 -mt-2 border-b bg-white">
      <div className="flex items-center gap-2 min-w-0">
        {showBackButton && (
          <Toolbar.Button
            onClick={onGoBack}
            className={button({ type: "secondary", size: "xs" })}
          >
            <ArrowLeftIcon className="h-3 w-3" />
            Back
          </Toolbar.Button>
        )}
        <div className="text-xs text-gray-500 truncate min-w-0">
          {decodeURIComponent(config.path)}
        </div>
      </div>
      {valTownUrl && (
        <Toolbar.Link
          href={valTownUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={button({ type: "primary", size: "xs" })}
        >
          Visit Val
          <ExternalLinkIcon className="h-3 w-3" />
        </Toolbar.Link>
      )}
    </Toolbar.Root>
  );
}

function LSExternalDocumentDialogContent({
  config,
  project,
  showBackButton,
  onGoBack,
}: {
  config: LSExternalDocument;
  project: ProjectMeta;
  showBackButton: boolean;
  onGoBack: () => void;
}) {
  const [editorContainer, setEditorContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const [isContentLoaded, setIsContentLoaded] = useState(false);
  const lsCodemirror = useLsCodemirror({ project, path: config.path });

  const editorRef = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) {
      setEditorContainer(node);
    }
  }, []);

  const tsExtensions = useCodemirrorExtensions({
    onRun: noop,
    onSave: noop,
    fullscreen: false,
    readOnly: true,
  });

  const extensions = useMemo(() => {
    return [
      ...tsExtensions,
      lsCodemirror.extensions,
      highlightCompartment.of([]),
    ];
  }, [tsExtensions, lsCodemirror.extensions]);

  const cm = useCodemirror({
    readOnly: true,
    container: editorContainer,
    value: config.text,
    extensions,
  });

  useEffect(() => {
    if (!cm.view) return;

    cm.view.dispatch({
      changes: {
        from: 0,
        to: cm.view.state.doc.length,
        insert: config.text,
      },
    });

    setIsContentLoaded(true);
  }, [cm.view, config]);

  useEffect(() => {
    if (!cm.view || !isContentLoaded) return;

    cm.view.dispatch({
      effects: highlightCompartment.reconfigure(
        withLinesSelected({
          from: config.lineStart,
          to: config.lineEnd || config.lineStart,
        }),
      ),
    });
  }, [cm.view, config, isContentLoaded]);

  return (
    <div className="flex flex-col h-full" style={{ height: "80vh" }}>
      <LSExternalDocumentToolbar
        config={config}
        showBackButton={showBackButton}
        onGoBack={onGoBack}
      />

      <div className="flex-1 min-h-0">
        <div ref={editorRef} className="cm-theme h-full w-full" />
      </div>
    </div>
  );
}

/**
 * Deno uses deno:/https/... for HTTP URLs in ESM imports. We want to offer a button
 * to open these in Val Town, so we need to convert the Deno URL format to
 * Val Town's URL format, and then from esm.town to val.town.
 */
const DENO_ESM_TOWN_REGEX =
  /^deno:\/https\/esm\.town\/v\/([^/]+)\/([^%]+)%40(\d+)-([^/]+)\/(.+)$/;
function convertDenoUrlToValTown(denoUrl: string): string | null {
  const match = denoUrl.match(DENO_ESM_TOWN_REGEX);
  if (!match) return null;

  const [, username, valName, _version, _branch, filePath] = match;
  return `https://www.val.town/x/${username}/${valName}/code/${filePath}`;
}
