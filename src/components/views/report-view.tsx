/** Simple Markdown-like rendering for reports.
 *  Phase 1: basic formatting. Phase 2+: replace with Tiptap. */
export function ReportView({ content }: { content: string }) {
  const html = simpleMarkdown(content);

  return (
    <div
      className="p-4 text-sm leading-relaxed prose-invert"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function simpleMarkdown(text: string): string {
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold mt-4 mb-1 text-[var(--color-text)]">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-1 text-[var(--color-text)]">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="text-lg font-bold mt-3 mb-2 text-[var(--color-text)]">$1</h2>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-[var(--color-text)]">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic text-[var(--color-text-secondary)]">$1</em>')
    // Lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-[var(--color-text-secondary)]">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-[var(--color-text-secondary)]">$2</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="mb-2 text-[var(--color-text-secondary)]">')
    // Single newlines to <br>
    .replace(/\n/g, "<br/>")
    // Wrap in paragraph
    .replace(/^/, '<p class="mb-2 text-[var(--color-text-secondary)]">')
    .replace(/$/, "</p>");
}
