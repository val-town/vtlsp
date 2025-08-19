import type { contextMenu } from "@valtown/codemirror-ls/extensions";
import { Code2, Edit3, MousePointer2, Search, Type } from "lucide-react";

export function LSContextMenu({
  goToDefinition,
  goToTypeDefinition,
  goToImplementation,
  findAllReferences,
  rename,
  onDismiss,
}: contextMenu.ContextMenuCallbacks & { onDismiss: () => void }) {
  const dropdown = (
    <div className="flex flex-col">
      {goToDefinition && (
        <LSContextMenuButton
          onClick={goToDefinition}
          icon={<MousePointer2 size={14} />}
        >
          Go to Definition
        </LSContextMenuButton>
      )}
      {goToTypeDefinition && (
        <LSContextMenuButton
          onClick={goToTypeDefinition}
          icon={<Type size={14} />}
        >
          Go to Type Definition
        </LSContextMenuButton>
      )}
      {goToImplementation && (
        <LSContextMenuButton
          onClick={goToImplementation}
          icon={<Code2 size={14} />}
        >
          Go to Implementation
        </LSContextMenuButton>
      )}
      {findAllReferences && (
        <LSContextMenuButton
          onClick={findAllReferences}
          icon={<Search size={14} />}
        >
          Find All References
        </LSContextMenuButton>
      )}
      {rename && (
        <LSContextMenuButton onClick={rename} icon={<Edit3 size={14} />}>
          Rename Symbol
        </LSContextMenuButton>
      )}
    </div>
  );

  // In reality you should use a component library that handles these for you
  setTimeout(() => {
    window.addEventListener("click", onDismiss, { once: true });
    window.addEventListener("contextmenu", onDismiss, { once: true });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        onDismiss();
      }
    });
  }, 0);

  return dropdown;
}

function LSContextMenuButton({
  onClick,
  children,
  icon,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 first:rounded-t last:rounded-b"
    >
      {icon}
      {children}
    </button>
  );
}
