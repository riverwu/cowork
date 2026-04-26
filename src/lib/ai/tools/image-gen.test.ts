import { describe, it, expect } from "vitest";
import { imageGen } from "./image-gen";

describe("image_gen tool", () => {
  it("declares the expected name and required params", () => {
    expect(imageGen.definition.name).toBe("image_gen");
    expect(imageGen.definition.parameters.required).toEqual(["prompt", "output_path"]);
    const props = imageGen.definition.parameters.properties as Record<string, unknown>;
    expect(props.prompt).toBeDefined();
    expect(props.output_path).toBeDefined();
    expect(props.reference_images).toBeDefined();
    expect(props.size).toBeDefined();
    expect(props.seed).toBeDefined();
  });

  it("returns a clear error when required inputs are missing", async () => {
    expect(await imageGen.execute({ output_path: "/tmp/out.png" })).toMatch(/prompt is required/);
    expect(await imageGen.execute({ prompt: "a cat" })).toMatch(/output_path is required/);
  });
});
