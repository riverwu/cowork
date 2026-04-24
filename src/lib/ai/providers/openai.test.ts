import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tauri", () => ({
  httpStreamPost: vi.fn(),
}));

import { OpenAIProvider } from "./openai";
import { httpStreamPost } from "@/lib/tauri";
import type { StreamEvent } from "./types";

const mockHttpStreamPost = vi.mocked(httpStreamPost);

beforeEach(() => {
  mockHttpStreamPost.mockReset();
});

function mockStream(jsonEvents: unknown[]) {
  mockHttpStreamPost.mockImplementation(async function* () {
    for (const event of jsonEvents) {
      yield JSON.stringify(event);
    }
  });
}

describe("OpenAIProvider", () => {
  it("marks length finish_reason as truncated instead of normal completion", async () => {
    mockStream([
      { choices: [{ delta: { content: "partial output" } }] },
      { choices: [{ delta: {}, finish_reason: "length" }] },
    ]);

    const provider = new OpenAIProvider("test-key");
    const events: StreamEvent[] = [];
    for await (const event of provider.stream({ system: "test", messages: [{ role: "user", content: "write a lot" }] })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "message-done");
    expect(done?.type).toBe("message-done");
    if (done?.type === "message-done") {
      expect(done.content).toBe("partial output");
      expect(done.stopReason).toBe("max_tokens");
      expect(done.toolCalls).toHaveLength(0);
    }
  });
});
