import { atom, useAtom, useSetAtom } from "jotai";
import * as Dialog from "app/components/ui/Dialog";
import { NavigationMenu, VisuallyHidden } from "radix-ui";
import { button } from "app/style";
import { useCallback } from "react";

interface LSChooserConfig {
  title: string;
  options: React.ReactNode[];
  onChoice: (choice: number) => void;
}

const lsChooserConfig = atom<null | LSChooserConfig>(null);

/**
 * useGetLSChoice is a custom hook that provides a way to show a dialog that offers a user
 * to choose from a list of options.
 *
 * @returns A function that can be called to show the LSChooser dialog and get the index of the user's choice.
 */
export function useGetLSChoice() {
  const setConfig = useSetAtom(lsChooserConfig);

  const getLsChoice = useCallback(
    (title: string, options: React.ReactNode[]): Promise<number> => {
      return new Promise((resolve) => {
        setConfig({
          title,
          options,
          onChoice: resolve,
        });
      });
    },
    [setConfig],
  );

  return getLsChoice;
}

/**
 * LSChooser is a component that displays a dialog allowing the user to choose
 * from a list of options.
 *
 * Use `useGetLSChoice` to trigger this dialog and get the user's choice, but make sure
 * you place this component somewhere in your component tree so that the dialog can be rendered.
 */
export function LSChooser() {
  const [chooserConfig, setChooserConfig] = useAtom(lsChooserConfig);

  if (!chooserConfig) return null;

  const onChoice = (choice: number) => {
    chooserConfig.onChoice(choice);
    setChooserConfig(null);
  };

  const onOpenChange = (open: boolean) => {
    if (open) return;

    setChooserConfig(null);
  };

  return (
    <Dialog.Root open={!!chooserConfig} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />

        <Dialog.Content
          className="relative mx-auto min-w-[400px] max-w-[600px]"
          width="medium"
        >
          <VisuallyHidden.Root>
            <Dialog.Title>{chooserConfig.title}</Dialog.Title>
            <Dialog.Description>{chooserConfig.title}</Dialog.Description>
          </VisuallyHidden.Root>

          <LSChooserContent config={chooserConfig} onChoice={onChoice} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LSChooserContent({
  config,
  onChoice,
}: {
  config: LSChooserConfig;
  onChoice: (choice: number) => void;
}) {
  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-4 text-gray-900">
        {config.title}
      </h3>

      <NavigationMenu.Root orientation="vertical">
        <NavigationMenu.List className="space-y-2">
          {config.options.map((option, index) => (
            <NavigationMenu.Item key={index}>
              <NavigationMenu.Link asChild>
                <button
                  type="button"
                  onClick={() => onChoice(index)}
                  className={button({
                    type: "secondary",
                    size: "sm",
                    className:
                      "!text-left !justify-start !items-center w-full !p-3 hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:bg-gray-50 border border-gray-200 rounded-md transition-colors",
                  })}
                >
                  {option}
                </button>
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          ))}
        </NavigationMenu.List>
      </NavigationMenu.Root>
    </div>
  );
}
