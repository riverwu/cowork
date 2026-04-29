import { describe, it, expect, vi } from "vitest";
const fakeFiles: Record<string, string> = {
  "/fake.json": '{"slideml":1,"deck":{"size":"16x9","theme":"x"},"slides":[]}',
};
vi.mock("@/lib/tauri", () => ({
  readFileText: vi.fn(async (p: string) => fakeFiles[p] ?? ""),
  writeFile: vi.fn(async (p: string, c: string) => { fakeFiles[p] = c; }),
}));
import { appendSlidesTool } from "./append-slides";
describe("append_slides — JSON-string slides arg", () => {
  it("parses slides when passed as a JSON-encoded string", async () => {
    const out = await appendSlidesTool.execute({
      path: "/fake.json",
      slides: '[{"layout":"cover","slots":{"title":"hi"}}]',
    });
    expect(out).toMatch(/Appended 1 slide/);
  });
  it("still accepts native arrays", async () => {
    fakeFiles["/fake.json"] = '{"slideml":1,"deck":{"size":"16x9","theme":"x"},"slides":[]}';
    const out = await appendSlidesTool.execute({
      path: "/fake.json",
      slides: [{ layout: "cover", slots: { title: "hi" } }],
    });
    expect(out).toMatch(/Appended 1 slide/);
  });
  it("rejects malformed JSON-string with clear hint", async () => {
    const out = await appendSlidesTool.execute({
      path: "/fake.json",
      slides: '[{"layout": "cover"',
    });
    expect(out).toMatch(/did not parse as JSON/);
  });

  it("repairs a slot accidentally placed outside slots before notes", async () => {
    fakeFiles["/fake.json"] = '{"slideml":1,"deck":{"size":"16x9","theme":"x"},"slides":[]}';
    const out = await appendSlidesTool.execute({
      path: "/fake.json",
      slides: '[{"layout":"prose","slots":{"title":"示例","body":"正文"}, "subtitle":"阅读下面的文章"}, "notes":"speaker notes"}]',
    });
    expect(out).toMatch(/Appended 1 slide/);
    const deck = JSON.parse(fakeFiles["/fake.json"]!);
    expect(deck.slides[0].slots.subtitle).toBe("阅读下面的文章");
    expect(deck.slides[0].notes).toBe("speaker notes");
    expect(deck.slides[0].subtitle).toBeUndefined();
  });
});
