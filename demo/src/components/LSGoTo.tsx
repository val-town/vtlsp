import type * as LSP from "vscode-languageserver-protocol";
import { File, X } from "lucide-react";
import {
  REFERENCE_KIND_LABELS,
  type ReferenceKind,
} from "vtlsp/codemirror-lsp/src/extensions/references";

interface LSGoToProps {
  locations: LSP.Location[];
  kind: ReferenceKind;
  goTo: (ref: LSP.Location) => void;
  onClose: () => void;
}

export function LSGoTo({ locations, kind, goTo, onClose }: LSGoToProps) {
  const label = REFERENCE_KIND_LABELS[kind] || "Locations";

  const groupedReferences = locations.reduce(
    (acc, ref) => {
      if (!acc[ref.uri]) {
        acc[ref.uri] = [];
      }
      acc[ref.uri].push(ref);
      return acc;
    },
    {} as Record<string, LSP.Location[]>,
  );

  const getFileName = (uri: string) => {
    const parts = uri.split("/");
    return parts[parts.length - 1] || uri;
  };

  return (
    <div className="bg-white">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {label} ({locations.length})
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={`Close ${label} panel`}
        >
          <X size={16} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 p-2">
        {Object.entries(groupedReferences).map(([uri, refs]) => (
          <div key={uri} className="mb-3 last:mb-0">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 px-1">
              <File size={14} />
              <span>{getFileName(uri)}</span>
              <span className="text-gray-500 dark:text-gray-400">
                ({refs.length})
              </span>
            </div>

            <div className="space-y-1">
              {refs.map((ref, index) => (
                <ReferenceItem
                  key={index}
                  reference={ref}
                  isSelected={false}
                  onClick={() => goTo(ref)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReferenceItem({
  reference,
  isSelected,
  onClick,
}: {
  reference: LSP.Location;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded text-xs font-mono transition-colors ${
        isSelected
          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
          : "text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-300"
      }`}
    >
      <span className="text-blue-600 dark:text-blue-400 min-w-[2rem]">
        {reference.range.start.line + 1}:
      </span>
      <span className="text-gray-500 dark:text-gray-400">
        {reference.range.start.character}-{reference.range.end.character}
      </span>
    </button>
  );
}
