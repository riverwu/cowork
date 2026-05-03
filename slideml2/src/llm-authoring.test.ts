import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck } from "./validate.js";
import { resolveCassettedLlm, shouldUseRealLlm, type LlmCallSignature } from "./llm-test-cassette.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * End-to-end LLM authoring smoke test. The LLM is asked to author a small deck
 * using the documented component set; we then run the same validate + render
 * pipeline a real user runs, and assert zero BLOCKING diagnostics.
 *
 * The test uses a cassette layer so CI without LLM credentials still exercises
 * the pipeline against the recorded response. To refresh the cassette, set
 * SLIDEML2_LLM_RECORD=1 + LLM_API/LLM_API_KEY/LLM_MODEL and re-run.
 */

const BLOCKING_CODES: ReadonlySet<LayoutDiagnostic["code"]> = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "DROP",
  "LOW_CONTRAST",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

const SCENARIO = {
  baseURL: process.env.LLM_API || "https://api.anthropic.com",
  model: process.env.LLM_MODEL || "claude-haiku-4-5",
  system: `You are a SlideML2 deck author. Produce ONLY a JSON object with this shape:
{ "slides": [ { "id": string, "title"?: string, "children": Node[] } ] }
where each Node has type and the fields documented for that component. Use semantic components (callout / kpi-grid / stat-strip / timeline / comparison-card / image-card / bar-list / hero-stat / cta) instead of stack/text where possible. Do not use raw hex colors on text nodes — only theme tokens (text.primary, text.inverse, brand.primary, success, warning, danger).`,
  user: `Author a 4-slide deck on "AI 可穿戴设备 2026 市场总览". Slide 1 cover with title + subtitle + 3 stats. Slide 2 一组 4 个 KPI. Slide 3 三家厂商比较 (comparison-card x3 in a grid). Slide 4 单条 CTA + 来源备注. Return ONLY JSON.`,
  maxTokens: 4000,
  tag: "authoring-smoke-2026",
};

interface AuthoredSlides {
  slides: SlideV2[];
}

function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`Authored response is not JSON: ${raw.slice(0, 120)}`);
  return raw.slice(start, end + 1);
}

async function callAnthropic(call: LlmCallSignature): Promise<string> {
  const apiKey = process.env.LLM_API_KEY!;
  const baseURL = call.baseURL.replace(/\/$/, "");
  const url = `${baseURL}/v1/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: call.model,
      max_tokens: call.maxTokens,
      system: call.system,
      messages: [{ role: "user", content: call.user }],
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`LLM ${response.status}: ${await response.text()}`);
  const json = await response.json() as { content?: Array<{ text?: string }> };
  return json.content?.map((p) => p.text || "").join("\n") || "";
}

function buildDeck(authored: AuthoredSlides): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "AI Wearables", primary: "2563EB" } },
    slides: authored.slides,
  };
}

describe("real-LLM authoring smoke", () => {
  it("produces a deck with zero blocking diagnostics (cassette or live)", async () => {
    const cassetteOrLive = await resolveCassettedLlm(SCENARIO, () => callAnthropic(SCENARIO));
    if (cassetteOrLive === null) {
      // Neither a cassette nor an LLM key: skip without failing CI.
      const skip = !shouldUseRealLlm();
      expect(skip, "no cassette and no LLM credentials available").toBe(true);
      return;
    }
    const authored = JSON.parse(extractJson(cassetteOrLive)) as AuthoredSlides;
    const deck = buildDeck(authored);

    const validation = validateDeck(deck);
    const validationDescription = validation.errors
      .map((e) => `[${e.code}${e.path ? ` ${e.path}` : ""}] ${e.message}`).join("\n");
    expect(validation.errors, `Schema validation failed:\n${validationDescription}\nLLM JSON:\n${cassetteOrLive.slice(0, 1500)}`).toHaveLength(0);

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck));
    const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
    const summary = blocking.map((d) => `[${d.code} ${d.slideId || "?"}/${d.nodeId || "?"}] ${d.message}`).join("\n");
    expect(blocking, `Blocking diagnostics:\n${summary}`).toHaveLength(0);
  }, 60_000);
});
