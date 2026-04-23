import { describe, it, expect } from "vitest";

// We can't easily test the full extractor (it calls LLM), but we can test
// the JSON parsing logic by extracting it.

describe("Memory extraction JSON parsing", () => {
  it("parses valid extraction JSON", () => {
    const text = `Here's what I extracted:
{
  "facts": [{"key": "role", "value": "PM", "category": "context"}],
  "memories": [{"content": "User likes tables", "type": "preference", "importance": 0.7}],
  "episode": {"task_summary": "Analyzed data", "outcome": "success", "reflection": "Used pandas effectively"}
}`;

    const match = text.match(/\{[\s\S]*\}/);
    expect(match).toBeTruthy();

    const parsed = JSON.parse(match![0]);
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.facts[0].key).toBe("role");
    expect(parsed.memories).toHaveLength(1);
    expect(parsed.memories[0].importance).toBe(0.7);
    expect(parsed.episode.outcome).toBe("success");
  });

  it("handles JSON without surrounding text", () => {
    const text = '{"facts":[],"memories":[],"episode":{"task_summary":"hi","outcome":"success","reflection":"ok"}}';
    const parsed = JSON.parse(text);
    expect(parsed.facts).toEqual([]);
    expect(parsed.episode.task_summary).toBe("hi");
  });

  it("handles malformed JSON gracefully", () => {
    const text = "I couldn't extract anything meaningful.";
    const match = text.match(/\{[\s\S]*\}/);
    expect(match).toBeNull();
  });

  it("handles partial extraction", () => {
    const text = '{"facts":[{"key":"lang","value":"zh","category":"preference"}],"memories":[],"episode":null}';
    const parsed = JSON.parse(text);
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.episode).toBeNull();
  });
});
