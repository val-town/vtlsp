import * as LSP from "vscode-languageserver-protocol";
import { X } from "lucide-react";

interface LSWindowProps {
  message: LSP.ShowMessageParams;
  onDismiss: () => void;
}

const getMessageTypeStyles = (type: LSP.MessageType) => {
  switch (type) {
    case LSP.MessageType.Error:
      return "bg-red-50 border-red-200 text-red-800";
    case LSP.MessageType.Warning:
      return "bg-yellow-50 border-yellow-200 text-yellow-800";
    case LSP.MessageType.Info:
      return "bg-blue-50 border-blue-200 text-blue-800";
    case LSP.MessageType.Log:
      return "bg-gray-50 border-gray-200 text-gray-800";
    case LSP.MessageType.Debug:
      return "bg-purple-50 border-purple-200 text-purple-800";
    default:
      return "bg-gray-50 border-gray-200 text-gray-800";
  }
};

export function LSWindow({ message, onDismiss }: LSWindowProps) {
  const messageTypeIcons = {
    [LSP.MessageType.Error]: "❌",
    [LSP.MessageType.Warning]: "⚠️",
    [LSP.MessageType.Info]: "ℹ️",
    [LSP.MessageType.Log]: "📝",
    [LSP.MessageType.Debug]: "🐞",
  } as const satisfies Record<LSP.MessageType, string>;

  return (
    <div className={`fixed top-4 right-4 max-w-sm border rounded-lg p-4 shadow-lg z-50 ${getMessageTypeStyles(message.type)}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-2">
          <span className="text-lg">
            {messageTypeIcons[message.type]}
          </span>
          <div>
            <p className="font-medium text-sm">{message.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-600 ml-4 flex-shrink-0 transition-colors"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

