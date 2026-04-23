export function ReportView({ content }: { content: string }) {
  const html = simpleMarkdown(content);

  return (
    <div
      className="p-5 text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function simpleMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold mt-4 mb-1 text-[var(--on-surface)]">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="text-base font-semibold mt-5 mb-2 text-[var(--on-surface)]">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-2 text-[var(--on-surface)]">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-[var(--on-surface)]">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-[var(--on-surface-variant)]">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-[var(--on-surface-variant)]">$2</li>')
    .replace(/\n\n/g, '</p><p class="mb-2 text-[var(--on-surface-variant)]">')
    .replace(/\n/g, "<br/>")
    .replace(/^/, '<p class="mb-2 text-[var(--on-surface-variant)]">')
    .replace(/$/, "</p>");
}
