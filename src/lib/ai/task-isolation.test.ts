import { describe, expect, it } from "vitest";
import { buildTaskIsolationPrompt, detectTaskBoundary } from "./task-isolation";
import type { Message } from "@/types";

function msg(role: Message["role"], content: string): Message {
  return { id: `${role}-${content}`, sessionId: "s", role, content, metadata: null, createdAt: 0 };
}

describe("task isolation", () => {
  it("does not isolate the first user message", () => {
    const result = detectTaskBoundary([], "创建一个关于医疗 AI 的 PPT");
    expect(result.shouldIsolate).toBe(false);
  });

  it("isolates a second standalone deck request", () => {
    const result = detectTaskBoundary([
      msg("user", "创建一个关于半导体行业的 PPT"),
      msg("assistant", "已生成 /tmp/chip.pptx"),
    ], "生成一个关于教育科技的 PPT");

    expect(result.shouldIsolate).toBe(true);
    expect(result.reason).toContain("deliverable");
  });

  it("does not isolate follow-up edits to the current deck", () => {
    const result = detectTaskBoundary([
      msg("user", "创建一个关于半导体行业的 PPT"),
      msg("assistant", "已生成 /tmp/chip.pptx"),
    ], "修改第 4 页的配色，并重新 render");

    expect(result.shouldIsolate).toBe(false);
  });

  it("lets explicit fresh wording override vague continuation words", () => {
    const result = detectTaskBoundary([
      msg("user", "创建一个关于半导体行业的 PPT"),
      msg("assistant", "已生成 /tmp/chip.pptx"),
    ], "重新开始，做一个全新的教育讲义 PPT");

    expect(result.shouldIsolate).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("warns the model not to reuse previous presentation style", () => {
    const prompt = buildTaskIsolationPrompt("test");
    expect(prompt).toContain("prior deck styles");
    expect(prompt).toContain("Do not copy a previous PPT's visual language");
    expect(prompt).toContain("unless the current user message explicitly asks");
  });
});
