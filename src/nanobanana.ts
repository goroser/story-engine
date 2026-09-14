// Thin client for "nano banana" (Gemini 2.5 Flash Image) image generation.
import type { Chunk, Story } from "./types.js";

const DEFAULT_MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

interface GenerateArgs {
  story: Story;
  chunk: Chunk;
  /** A previously-generated chunk to pass in as a character/setting reference image. */
  referenceImage?: { bytes: Buffer; mimeType: string };
}

export class NanoBananaError extends Error {}

/**
 * Renders one chunk's illustration: the story's character/style bible prepended
 * to the chunk's scene prompt, optionally grounded by a reference image from an
 * earlier chunk. Per the project spec, the reference is scoped explicitly to
 * character/setting only — not camera angle or pose — so illustrations stay
 * varied while the cast and world stay consistent.
 */
export async function generateChunkImage({
  story,
  chunk,
  referenceImage,
}: GenerateArgs): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new NanoBananaError(
      "GEMINI_API_KEY is not set. Add it to .env (GEMINI_API_KEY=...) or the server's environment."
    );
  }
  const model = process.env.NANO_BANANA_MODEL || DEFAULT_MODEL;

  const parts: Array<Record<string, unknown>> = [];
  if (referenceImage) {
    parts.push({
      inlineData: {
        mimeType: referenceImage.mimeType,
        data: referenceImage.bytes.toString("base64"),
      },
    });
    parts.push({
      text:
        "Use the attached image only as a reference for how the characters and location look — " +
        "feel free to change the camera angle, composition, and character poses for this new scene.",
    });
  }
  parts.push({
    text:
      `${story.character_bible}\n\n` +
      `Scene to illustrate: ${chunk.image_prompt}\n\n` +
      "Children's picture-book illustration. No text or lettering in the image.",
  });

  const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });

  const body = await res.json().catch(() => undefined);

  if (!res.ok) {
    const message = (body as any)?.error?.message ?? res.statusText;
    const status = (body as any)?.error?.status ?? res.status;
    throw new NanoBananaError(`nano banana request failed (${status}): ${message}`);
  }

  const responseParts: Array<Record<string, unknown>> | undefined =
    (body as any)?.candidates?.[0]?.content?.parts;
  const imagePart = responseParts?.find((p) => (p as any).inlineData?.data);
  if (!imagePart) {
    const finishReason = (body as any)?.candidates?.[0]?.finishReason;
    throw new NanoBananaError(
      `nano banana returned no image (finishReason: ${finishReason ?? "unknown"}). ` +
        "The prompt may have been blocked, or the model returned text only."
    );
  }
  const inline = (imagePart as any).inlineData as { mimeType: string; data: string };
  return { bytes: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || "image/png" };
}
