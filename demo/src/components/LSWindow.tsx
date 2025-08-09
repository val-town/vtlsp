import type * as LSP from "vscode-languageserver-protocol";

interface LSWindowProps {
  message: LSP.ShowMessageParams;
  onDismiss: () => void;
}

export function LSWindow({ message, onDismiss }: LSWindowProps) {
  return (
    <div className="fixed top-4 right-4 max-w-sm border rounded p-3 bg-white shadow z-50">
      <div className="flex justify-between items-start">
        <p className="text-sm">{message.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 text-gray-500 hover:text-gray-700"
        >
          ×
        </button>
      </div>
    </div>
  );
}
