import { Clipboard } from "lucide-react";
import { memo, useRef, type HTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface Props {
  text: string;
}

interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  children?: ReactNode;
  node?: unknown;
}

function CodeBlock({ node: _node, children, ...props }: CodeBlockProps) {
  const preRef = useRef<HTMLPreElement>(null);

  function handleCopy() {
    const text = preRef.current?.textContent;
    if (text) void navigator.clipboard.writeText(text).catch(() => undefined);
  }

  return (
    <pre {...props} ref={preRef} className="md-pre">
      <button className="icon-button md-copy" type="button" onClick={handleCopy} title="Copy code" aria-label="Copy code">
        <Clipboard size={13} aria-hidden="true" />
      </button>
      {children}
    </pre>
  );
}

export const MarkdownMessage = memo(function MarkdownMessage({ text }: Props) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ pre: CodeBlock }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
