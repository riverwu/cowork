import type { Tool } from "./types";

export const analyzeData: Tool = {
  definition: {
    name: "analyze_data",
    description:
      "Analyze tabular or numerical data. Can compute statistics, find patterns, compare values, and identify anomalies. Input the data as a CSV-like string or JSON array.",
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "The data to analyze (CSV format, JSON array, or tab-separated values)",
        },
        analysis_type: {
          type: "string",
          description:
            "What kind of analysis to perform: 'summary' (basic stats), 'compare' (compare periods/groups), 'anomaly' (find outliers), 'trend' (identify trends)",
          enum: ["summary", "compare", "anomaly", "trend"],
        },
        focus: {
          type: "string",
          description: "Optional: what aspect to focus on (e.g., a specific column or metric)",
        },
      },
      required: ["data", "analysis_type"],
    },
  },

  async execute(input) {
    const data = input.data as string;
    const analysisType = input.analysis_type as string;
    const focus = input.focus as string | undefined;

    try {
      const rows = parseData(data);
      if (rows.length === 0 || (rows.length === 1 && rows[0].every((c) => !c.trim()))) {
        return "No data to analyze.";
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);

      let result = `Data: ${dataRows.length} rows, ${headers.length} columns (${headers.join(", ")})\n\n`;

      // Find numeric columns
      const numericCols = headers.map((_, colIdx) => {
        const values = dataRows.map((r) => parseFloat(r[colIdx])).filter((v) => !isNaN(v));
        return values.length > dataRows.length * 0.5 ? values : null;
      });

      if (analysisType === "summary" || analysisType === "anomaly") {
        for (let i = 0; i < headers.length; i++) {
          if (focus && !headers[i].toLowerCase().includes(focus.toLowerCase())) continue;
          const values = numericCols[i];
          if (!values || values.length === 0) continue;

          const sorted = [...values].sort((a, b) => a - b);
          const sum = values.reduce((a, b) => a + b, 0);
          const mean = sum / values.length;
          const min = sorted[0];
          const max = sorted[sorted.length - 1];
          const median = sorted[Math.floor(sorted.length / 2)];
          const stddev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);

          result += `### ${headers[i]}\n`;
          result += `- Count: ${values.length}\n`;
          result += `- Mean: ${mean.toFixed(2)}\n`;
          result += `- Median: ${median.toFixed(2)}\n`;
          result += `- Min: ${min.toFixed(2)} / Max: ${max.toFixed(2)}\n`;
          result += `- Std Dev: ${stddev.toFixed(2)}\n`;

          if (analysisType === "anomaly") {
            const threshold = mean + 2 * stddev;
            const lowerThreshold = mean - 2 * stddev;
            const outliers = dataRows.filter((r) => {
              const v = parseFloat(r[i]);
              return !isNaN(v) && (v >= threshold || v <= lowerThreshold);
            });
            if (outliers.length > 0) {
              result += `- Anomalies (>2 std dev): ${outliers.length} rows\n`;
              for (const row of outliers.slice(0, 5)) {
                result += `  - ${row.join(", ")}\n`;
              }
            }
          }
          result += "\n";
        }
      }

      if (analysisType === "compare" && dataRows.length >= 2) {
        result += "### Row-by-row comparison\n";
        for (let i = 0; i < headers.length; i++) {
          const values = numericCols[i];
          if (!values || values.length < 2) continue;
          if (focus && !headers[i].toLowerCase().includes(focus.toLowerCase())) continue;

          const first = values[0];
          const last = values[values.length - 1];
          const change = last - first;
          const pctChange = first !== 0 ? ((change / Math.abs(first)) * 100).toFixed(1) : "N/A";
          result += `- ${headers[i]}: ${first.toFixed(2)} → ${last.toFixed(2)} (${change >= 0 ? "+" : ""}${change.toFixed(2)}, ${pctChange}%)\n`;
        }
      }

      if (analysisType === "trend") {
        result += "### Trend analysis\n";
        for (let i = 0; i < headers.length; i++) {
          const values = numericCols[i];
          if (!values || values.length < 3) continue;
          if (focus && !headers[i].toLowerCase().includes(focus.toLowerCase())) continue;

          // Simple trend: compare first third vs last third
          const third = Math.floor(values.length / 3);
          const firstAvg = values.slice(0, third).reduce((a, b) => a + b, 0) / third;
          const lastAvg = values.slice(-third).reduce((a, b) => a + b, 0) / third;
          const direction = lastAvg > firstAvg * 1.05 ? "↑ increasing" : lastAvg < firstAvg * 0.95 ? "↓ decreasing" : "→ stable";
          result += `- ${headers[i]}: ${direction} (early avg: ${firstAvg.toFixed(2)}, recent avg: ${lastAvg.toFixed(2)})\n`;
        }
      }

      return result;
    } catch (err) {
      return `Analysis error: ${err}`;
    }
  },
};

function parseData(data: string): string[][] {
  // Try JSON array first
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (typeof parsed[0] === "object") {
        const headers = Object.keys(parsed[0]);
        const rows = parsed.map((item: Record<string, unknown>) =>
          headers.map((h) => String(item[h] ?? "")),
        );
        return [headers, ...rows];
      }
    }
  } catch {
    // Not JSON, try CSV/TSV
  }

  // Try CSV/TSV
  const lines = data.trim().split("\n");
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
}
