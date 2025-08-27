import { useEffect, useRef, useState } from "react";

interface LSRenameProps {
  onDismiss: () => void;
  onComplete: (newName: string) => void;
  placeholder: string;
}

export function LSRename({
  onDismiss,
  onComplete,
  placeholder,
}: LSRenameProps) {
  const [newName, setNewName] = useState(placeholder);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Note that usually you'd want to use a component library to handle these
  // sorts of events for you

  useEffect(() => {
    // Focus and select the input when the component mounts
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }

    // Handle clicks outside the component
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onDismiss();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onDismiss]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) {
      onComplete(newName.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onDismiss();
    } else if (e.key === "Enter") {
      if (newName.trim()) {
        onComplete(newName.trim());
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="bg-white border border-gray-200 rounded-md shadow-lg z-50 px-0.5"
    >
      <form onSubmit={handleSubmit} style={{ display: "inline-block" }}>
        <div className="inline-block relative">
          {/* Hidden text to determine width */}
          <div className="invisible whitespace-pre text-sm">
            {newName || "W"}
          </div>

          {/* Actual input that sits on top */}
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="absolute top-0 left-0 text-sm border-none outline-none focus:ring-0 bg-transparent"
          />
        </div>
      </form>
    </div>
  );
}
