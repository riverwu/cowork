import type { Tool } from "./types";
import { httpPost, downloadUrl, readFileBase64 } from "@/lib/tauri";
import { getSettings } from "@/lib/db";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
/**
 * Default model. Seedream 4.0 (`doubao-seedream-4-0-250828`) supports both
 * text-to-image and multi-reference image-to-image, and is the model
 * Volcengine recommends for new integrations.
 *
 * If a 404 "InvalidEndpointOrModel.NotFound" comes back, the user either
 * has not activated this model in their Ark console
 * (https://console.volcengine.com/ark) or is using an account-specific
 * inference endpoint ID (`ep-...`) — both of those are configurable from
 * Settings → Image generation.
 */
const DEFAULT_MODEL = "doubao-seedream-4-0-250828";

interface DoubaoImageItem {
  url?: string;
}

interface DoubaoImageResponse {
  data?: DoubaoImageItem[];
  error?: { message?: string };
  message?: string;
}

export const imageGen: Tool = {
  definition: {
    name: "image_gen",
    description:
      `Generate an illustrative / photographic / designed image with the AI image model (Doubao Seedream). Saves a PNG/JPG to disk and returns the absolute path.

Use for: covers, section dividers, hero/banner images, posters, icons, logos, mood imagery — anything the user calls 配图/插图/封面/illustration. Do NOT use for data charts (use run_python + matplotlib instead — this tool cannot draw exact numbers/axes/legends).

Sizing guidance (IMPORTANT — pick a preset, do not invent values):

- Default: omit \`size\` entirely. The tool falls back to 4096x4096 (4K square),
  which works for most slide images, posters, hero images, and avatars.
- Pick by aspect ratio of the intended use, not by a number you guess:
  - 1:1 square (avatars, icons, IG, PPT inset cards): "4096x4096" (4K) or "2048x2048" (2K).
  - 16:9 landscape (full-bleed slide background, hero banner, video thumbnail): "3840x2160" (4K UHD) or "2560x1440" (2K).
  - 9:16 portrait (mobile splash, story, vertical poster): "2160x3840" (4K) or "1440x2560" (2K).
  - 4:3 landscape (classic slide, photo): "3072x2304" (~4K) or "2304x1728" (2K).
  - 3:4 portrait: "2304x3072" (~4K) or "1728x2304" (2K).
  - 21:9 ultra-wide: "3840x1644" (4K) or "2560x1080".
- Hard constraints for Seedream 4.0 (\`doubao-seedream-4-0-*\`):
  - width*height MUST be >= 3,686,400 pixels (~1920x1920). Anything smaller is rejected.
  - Both width and height should be multiples of 16 and within ~512..4096 each.
- Older \`doubao-seedream-3-0-t2i-*\` accepts smaller sizes (down to 1024x1024).
- Only override the default to choose the right aspect ratio. Do not request
  custom sizes (e.g. "2000x1500") unless the user explicitly asked.

Parameters:
- prompt: natural-language description of the image to generate.
- output_path: absolute path where the image file should be written (e.g. /Users/me/cowork/poster.png).
- reference_images (optional): list of reference image inputs. Each item may be either an
  HTTPS URL or an absolute local file path. Local files are read and sent inline as
  base64. Reference images are only honored by image-to-image / multi-image-capable models
  (e.g. doubao-seedream-4-0-250828); the configured model in settings must support them.
- size (optional): output size as "WIDTHxHEIGHT". See sizing guidance above. Default 4096x4096.
- seed (optional): integer seed for reproducible generation.

The Doubao API key, base URL and model are read from app Settings → Image generation.
If the API key is not configured, this tool will return a clear error so the agent can ask
the user to configure it.`,
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text prompt describing the image to generate." },
        output_path: { type: "string", description: "Absolute path to save the generated image (PNG/JPG)." },
        reference_images: {
          type: "array",
          items: { type: "string" },
          description: "Optional reference images. Each item is an HTTPS URL or an absolute local file path.",
        },
        size: {
          type: "string",
          description:
            "Output size as \"WIDTHxHEIGHT\". Default 4096x4096 (4K square). Pick a preset by aspect ratio: " +
            "1:1 → 4096x4096 or 2048x2048; 16:9 → 3840x2160 or 2560x1440; 9:16 → 2160x3840 or 1440x2560; " +
            "4:3 → 3072x2304 or 2304x1728; 3:4 → 2304x3072 or 1728x2304; 21:9 → 3840x1644 or 2560x1080. " +
            "Seedream 4.0 requires width*height >= 3,686,400 pixels and width/height each within ~512..4096.",
        },
        seed: { type: "number", description: "Optional integer seed for reproducible generation." },
      },
      required: ["prompt", "output_path"],
    },
  },

  async execute(input) {
    const prompt = String(input.prompt || "").trim();
    const outputPath = String(input.output_path || "").trim();
    const refsInput = Array.isArray(input.reference_images) ? input.reference_images : [];
    const size = (input.size as string | undefined) || "4096x4096";
    const seed = typeof input.seed === "number" ? Math.floor(input.seed) : undefined;

    if (!prompt) return "Error: prompt is required.";
    if (!outputPath) return "Error: output_path is required (absolute path).";

    const settings = await getSettings();
    const apiKey = settings.imageApiKey;
    if (!apiKey) {
      return "Error: image generation API key is not configured. Open Settings → Image generation and add a Doubao Ark API key.";
    }
    const baseUrl = (settings.imageBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = settings.imageModel || DEFAULT_MODEL;

    let referenceImages: string[] | undefined;
    if (refsInput.length > 0) {
      referenceImages = [];
      for (const raw of refsInput) {
        const ref = String(raw).trim();
        if (!ref) continue;
        if (/^https?:\/\//i.test(ref)) {
          referenceImages.push(ref);
        } else if (ref.startsWith("/") || ref.startsWith("~")) {
          try {
            const b64 = await readFileBase64(ref);
            const mime = mimeFromExtension(ref);
            referenceImages.push(`data:${mime};base64,${b64}`);
          } catch (err) {
            return `Error: failed to read reference image ${ref}: ${err}`;
          }
        } else {
          return `Error: reference image must be an HTTPS URL or absolute local path (got: ${ref}).`;
        }
      }
      if (referenceImages.length === 0) referenceImages = undefined;
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      response_format: "url",
      size,
      watermark: false,
    };
    if (seed !== undefined) body.seed = seed;
    if (referenceImages && referenceImages.length > 0) {
      body.image = referenceImages.length === 1 ? referenceImages[0] : referenceImages;
    }

    const endpoint = `${baseUrl}/images/generations`;
    let response;
    try {
      response = await httpPost(
        endpoint,
        { Authorization: `Bearer ${apiKey}` },
        JSON.stringify(body),
      );
    } catch (err) {
      return `Error: image generation request failed to send: ${err}`;
    }

    if (response.status < 200 || response.status >= 300) {
      const detail = truncate(response.body, 600);
      if (response.status === 404 && /InvalidEndpointOrModel|does not exist/i.test(response.body)) {
        return `Error: Doubao Ark rejected model "${model}" with HTTP 404. Open Settings → Image generation and either (a) switch to a model your Ark account has activated (e.g. doubao-seedream-4-0-250828), or (b) paste the inference endpoint ID (ep-...) created in https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint into the Model ID field. Raw response: ${detail}`;
      }
      if (response.status === 401 || response.status === 403) {
        return `Error: Doubao Ark rejected the API key (HTTP ${response.status}). Verify the key in Settings → Image generation. Raw response: ${detail}`;
      }
      if (response.status === 400 && /size/i.test(response.body) && /pixels|3686400/i.test(response.body)) {
        return `Error: size "${size}" is too small for model "${model}". Seedream 4.0 requires width*height >= 3,686,400 pixels. Retry by picking a preset for the right aspect ratio: 1:1 → 4096x4096 (default) or 2048x2048; 16:9 → 3840x2160; 9:16 → 2160x3840; 4:3 → 3072x2304; 3:4 → 2304x3072. Raw response: ${detail}`;
      }
      if (response.status === 400 && /size/i.test(response.body)) {
        return `Error: size "${size}" was rejected for model "${model}" (HTTP 400). Use one of the documented presets: 4096x4096, 3840x2160, 2160x3840, 3072x2304, 2304x3072, 2560x1440. Raw response: ${detail}`;
      }
      return `Error: image generation API returned HTTP ${response.status}: ${detail}`;
    }

    let parsed: DoubaoImageResponse;
    try {
      parsed = JSON.parse(response.body) as DoubaoImageResponse;
    } catch {
      return `Error: image generation API returned non-JSON body: ${truncate(response.body, 600)}`;
    }

    if (parsed.error?.message) return `Error: image generation API error: ${parsed.error.message}`;
    const item = parsed.data?.[0];
    if (!item) {
      return `Error: image generation API returned no image data. Body: ${truncate(response.body, 400)}`;
    }

    if (!item.url) {
      return "Error: image generation API did not return an image URL. The configured model may not support response_format=url.";
    }
    try {
      await downloadUrl(item.url, outputPath);
    } catch (err) {
      return `Error: failed to save generated image to ${outputPath}: ${err}`;
    }

    const refNote = referenceImages && referenceImages.length > 0
      ? ` (with ${referenceImages.length} reference image${referenceImages.length === 1 ? "" : "s"})`
      : "";
    return `Image generated and saved to ${outputPath}${refNote}. Model: ${model}, size: ${size}.`;
  },
};

function mimeFromExtension(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
