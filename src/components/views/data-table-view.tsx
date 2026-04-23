export function DataTableView({ content }: { content: string }) {
  const rows = parseTable(content);

  if (rows.length === 0) {
    return <div className="p-4 text-sm text-[var(--outline)]">No data to display.</div>;
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--outline-variant)]">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--outline)] uppercase tracking-wider">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--outline-variant)]/50 hover:bg-[var(--surface-container-low)] transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-[var(--on-surface-variant)]">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseTable(content: string): string[][] {
  const lines = content.trim().split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];
  const firstLine = lines[0];
  if (firstLine.includes("|")) {
    return lines
      .filter((l) => !l.match(/^\s*\|?\s*[-:]+\s*\|/))
      .map((l) => l.split("|").map((c) => c.trim()).filter((c) => c.length > 0));
  }
  if (firstLine.includes("\t")) {
    return lines.map((l) => l.split("\t").map((c) => c.trim()));
  }
  return lines.map((l) => l.split(",").map((c) => c.trim()));
}
