/** Render tabular data (CSV, TSV, or Markdown table) as an HTML table. */
export function DataTableView({ content }: { content: string }) {
  const rows = parseTable(content);

  if (rows.length === 0) {
    return (
      <div className="p-3 text-sm text-[var(--color-text-tertiary)]">No data to display.</div>
    );
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
            >
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-[var(--color-text-secondary)]">
                  {cell}
                </td>
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

  // Detect format
  const firstLine = lines[0];

  // Markdown table (| col1 | col2 |)
  if (firstLine.includes("|")) {
    return lines
      .filter((l) => !l.match(/^\s*\|?\s*[-:]+\s*\|/)) // Skip separator rows
      .map((l) =>
        l
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
      );
  }

  // TSV
  if (firstLine.includes("\t")) {
    return lines.map((l) => l.split("\t").map((c) => c.trim()));
  }

  // CSV
  return lines.map((l) => l.split(",").map((c) => c.trim()));
}
