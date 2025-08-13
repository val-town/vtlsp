import { isLSPMarkupContent } from "@valtown/codemirror-ls";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import typescript from "highlight.js/lib/languages/typescript";
import { createLowlight } from "lowlight";
import { Fragment, type JSX, jsx, jsxs } from "react/jsx-runtime";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import type * as LSP from "vscode-languageserver-protocol";

export function LSContents({
  contents,
  className = "",
}: {
  contents: string | LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[];
  className?: string;
}): JSX.Element {
  if (typeof contents === "string") {
    return <MarkdownContent content={contents} />;
  } else if (isLSPMarkupContent(contents)) {
    return <MarkdownContent content={contents.value} />;
  } else if (Array.isArray(contents)) {
    return (
      <div>
        {contents.map((content) => {
          if (typeof content === "string") {
            return (
              <MarkdownContent
                key={crypto.randomUUID()}
                content={content}
                className={className}
              />
            );
          }
          if (isLSPMarkupContent(content)) {
            if (content.kind === "markdown") {
              return (
                <MarkdownContent
                  key={crypto.randomUUID()}
                  content={content.value}
                  className={className}
                />
              );
            }

            return (
              <div key={crypto.randomUUID()}>
                <LowLightCodeBlock
                  code={content.value}
                  language={content.language || "typescript"}
                />
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  } else {
    // Handle MarkedString case - it has value and optional language
    if ("language" in contents && contents.language) {
      return (
        <LowLightCodeBlock code={contents.value} language={contents.language} />
      );
    }
    return <MarkdownContent content={contents.value} />;
  }
}

function MarkdownContent({
  content,
  className: additionalClassNames,
}: {
  content: string;
  className?: string;
}) {
  return (
    <ReactMarkdown
      allowedElements={allowedTags}
      rehypePlugins={[rehypeRaw]}
      components={{
        code({ node, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match ? match[1] : "";

          if (language) {
            try {
              const highlightLang = ["typescript", "typescriptreact"].includes(
                language,
              )
                ? "typescript"
                : language;

              const tree = lowlight.highlight(
                highlightLang,
                String(children).replace(/\n$/, ""),
              );

              return (
                <code
                  className={`whitespace-pre-wrap break-words hljs ${className || ""} ${additionalClassNames || ""}`.trim()}
                  {...props}
                >
                  {
                    // @ts-ignore: react types don't type these.
                    toJsxRuntime(tree, { Fragment, jsx, jsxs })
                  }
                </code>
              );
            } catch {
              // Fallback if language not supported
              return (
                <code
                  className={`whitespace-pre-wrap break-words ${className || ""} ${additionalClassNames || ""}`.trim()}
                  {...props}
                >
                  {children}
                </code>
              );
            }
          }

          return (
            <code
              className={`whitespace-pre-wrap break-words ${className || ""} ${additionalClassNames || ""}`.trim()}
              {...props}
            >
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function LowLightCodeBlock({
  code,
  language,
  className = "",
}: {
  code: string;
  language: string;
  className?: string;
}) {
  try {
    const highlightLang = ["typescript", "typescriptreact"].includes(language)
      ? "typescript"
      : language || "plaintext";
    const tree = lowlight.highlight(highlightLang, code);

    return (
      <code className={`whitespace-pre-wrap break-words hljs ${className}`}>
        {
          // @ts-ignore: react types don't type these.
          toJsxRuntime(tree, { Fragment, jsx, jsxs })
        }
      </code>
    );
  } catch {
    return (
      <code className="whitespace-pre-wrap break-words language-text">
        {code}
      </code>
    );
  }
}

// biome-ignore format: Don't split up these into multiple lines
const allowedTags = ["h1", "h2", "h3", "h4", "h5", "h6", "div", "span", "p", "br", "hr",
  "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "th", "td", "blockquote",
  "pre", "code", "em", "strong", "a", "img"];

const lowlight = createLowlight();
lowlight.register({ typescript });
