import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { openPath, revealInFolder } from "@/lib/tauri";
import { IconDocument, IconFolder } from "@/components/icons";
import type { Components } from "react-markdown";

/** File extensions we recognize for file card rendering. */
const FILE_EXTENSIONS = /\.(txt|md|py|ts|tsx|js|jsx|rs|go|java|c|cpp|h|json|yaml|yml|toml|csv|xml|html|css|sql|sh|bash|pdf|docx|xlsx|png|jpg|jpeg|gif|svg|mp4|mp3|zip|tar|gz)$/i;

/** Detect absolute file paths in text and convert to file cards. */
function processFileReferences(text: string): React.ReactNode[] {
  // Match absolute paths: /path/to/file.ext or ~/path/to/file.ext
  const pathRegex = /((?:\/[\w.\-]+)+\.\w+|~(?:\/[\w.\-]+)+\.\w+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pathRegex.exec(text)) !== null) {
    const path = match[1];
    if (!FILE_EXTENSIONS.test(path)) continue;

    // Add text before this match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    parts.push(<FileCard key={match.index} path={path} />);
    lastIndex = match.index + match[0].length;
  }

  if (parts.length === 0) return [text];
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/** File card — clickable card with open file / reveal in folder actions. */
function FileCard({ path }: { path: string }) {
  const fileName = path.split("/").pop() || path;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  function handleOpen(e: React.MouseEvent) {
    e.preventDefault();
    openPath(path);
  }

  function handleReveal(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    revealInFolder(path);
  }

  return (
    <span
      onClick={handleOpen}
      className="inline-flex items-center gap-1.5 mx-0.5 px-2 py-0.5 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] hover:bg-[var(--surface-container)] hover:border-[var(--on-surface-tertiary)] cursor-pointer transition-colors group align-middle"
      title={path}
    >
      <IconDocument size={12} />
      <span className="text-[12px] text-[var(--on-surface-secondary)] max-w-[200px] truncate">{fileName}</span>
      <span className="text-[10px] text-[var(--on-surface-tertiary)]">.{ext}</span>
      <button
        onClick={handleReveal}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] transition-all"
        title="Reveal in folder"
      >
        <IconFolder size={10} />
      </button>
    </span>
  );
}

/** Custom components for ReactMarkdown. */
const markdownComponents: Components = {
  // Code blocks with syntax highlighting class
  code({ className, children, ...props }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="px-1 py-0.5 rounded bg-[var(--surface-container)] text-[var(--on-surface)] text-[12px] font-mono" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={`block overflow-x-auto p-3 rounded-lg bg-[var(--surface-container)] text-[12px] font-mono leading-relaxed ${className || ""}`} {...props}>
        {children}
      </code>
    );
  },

  // Pre blocks
  pre({ children }) {
    return (
      <pre className="my-2 rounded-lg overflow-hidden bg-[var(--surface-container)]">
        {children}
      </pre>
    );
  },

  // Paragraphs — process file references
  p({ children }) {
    const processed = processChildren(children);
    return <p className="mb-2 last:mb-0">{processed}</p>;
  },

  // Links
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener" className="text-[var(--primary-accent)] hover:underline cursor-pointer">
        {children}
      </a>
    );
  },

  // Images — render inline
  img({ src, alt }) {
    if (!src) return null;
    // Handle local file paths
    const imgSrc = src.startsWith("/") ? `asset://localhost${src}` : src;
    return (
      <img
        src={imgSrc}
        alt={alt || ""}
        className="my-2 max-w-full rounded-lg border border-[var(--border)]"
        style={{ maxHeight: 400 }}
      />
    );
  },

  // Tables
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-[12px]">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-[var(--surface-low)]">{children}</thead>;
  },
  th({ children }) {
    return <th className="px-3 py-1.5 text-left font-medium text-[var(--on-surface-secondary)] border-b border-[var(--border)]">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-1.5 border-b border-[var(--border)]/50 text-[var(--on-surface-secondary)]">{children}</td>;
  },

  // Headings
  h1({ children }) { return <h1 className="text-[16px] font-bold mt-4 mb-2">{children}</h1>; },
  h2({ children }) { return <h2 className="text-[15px] font-bold mt-3 mb-1.5">{children}</h2>; },
  h3({ children }) { return <h3 className="text-[14px] font-semibold mt-3 mb-1">{children}</h3>; },
  h4({ children }) { return <h4 className="text-[13px] font-semibold mt-2 mb-1">{children}</h4>; },

  // Lists
  ul({ children }) { return <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>; },
  ol({ children }) { return <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>; },
  li({ children }) { return <li className="text-[var(--on-surface-secondary)]">{children}</li>; },

  // Blockquote
  blockquote({ children }) {
    return <blockquote className="border-l-3 border-[var(--border)] pl-3 my-2 text-[var(--on-surface-tertiary)] italic">{children}</blockquote>;
  },

  // Horizontal rule
  hr() { return <hr className="my-3 border-[var(--border)]" />; },
};

/** Process children to find file paths in text nodes. */
function processChildren(children: React.ReactNode): React.ReactNode {
  if (!children) return children;
  if (typeof children === "string") {
    const parts = processFileReferences(children);
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === "string"
        ? <span key={i}>{processChildren(child)}</span>
        : child,
    );
  }
  return children;
}

/** Render markdown content with full support. */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}
