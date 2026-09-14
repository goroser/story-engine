// Thin client for "nano banana" (Gemini 2.5 Flash Image) image generation.
import type { Chunk, Story } from "./types.js";

const DEFAULT_MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

export class NanoBananaError extends Error {}

interface ImageRef {
  bytes: Buffer;
  mimeType: string;
}

async function callNanoBanana(parts: Array<Record<string, unknown>>): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new NanoBananaError(
      "GEMINI_API_KEY is not set. Add it to .env (GEMINI_API_KEY=...) or the server's environment."
    );
  }
  const model = process.env.NANO_BANANA_MODEL || DEFAULT_MODEL;

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

/**
 * Generates a character reference sheet from the bible text alone — no scene,
 * no chunk content. This is meant to be reviewed and approved once per story,
 * then used to anchor every chunk's illustration so character design stays
 * fixed instead of drifting generation-to-generation.
 */
export async function generateReferenceSheet(story: Story, extraNotes?: string): Promise<GeneratedImage> {
  const parts: Array<Record<string, unknown>> = [
    {
      text:
        `${story.character_bible}\n\n` +
        "Character reference sheet: show all the characters described above clearly, full body, " +
        "standing in simple neutral poses facing slightly toward camera, on a plain neutral background " +
        "(no scene, no props beyond what defines the character). This is a model sheet for establishing " +
        "their exact design — proportions, colors, markings, clothing/accessories — to be reused " +
        "consistently across many illustrations. No text or lettering in the image." +
        (extraNotes ? `\n\nAdditional notes: ${extraNotes}` : ""),
    },
  ];
  return callNanoBanana(parts);
}

interface GenerateSceneArgs {
  story: Story;
  chunk: Chunk;
  /** The approved character reference sheet — locks character design. */
  characterReference?: ImageRef;
  /** Optionally also ground setting on a specific prior chunk's illustration. */
  sceneReference?: ImageRef;
}

/**
 * Renders one chunk's illustration: the character/style bible plus the
 * chunk's scene prompt, anchored on the approved character reference (if
 * any). Explicitly pushes for camera/composition variety — reference images
 * lock character design and setting, never viewpoint, framing, or location.
 */
export async function generateChunkImage({
  story,
  chunk,
  characterReference,
  sceneReference,
}: GenerateSceneArgs): Promise<GeneratedImage> {
  const parts: Array<Record<string, unknown>> = [];

  if (characterReference) {
    parts.push({
      inlineData: { mimeType: characterReference.mimeType, data: characterReference.bytes.toString("base64") },
    });
    parts.push({
      text:
        "The attached image is the approved character reference sheet. Match every character's design " +
        "exactly — proportions, colors, markings, accessories — but this is a reference sheet, not a scene: " +
        "do not copy its plain background, its pose, or its camera framing into the new illustration.",
    });
  }

  if (sceneReference) {
    parts.push({
      inlineData: { mimeType: sceneReference.mimeType, data: sceneReference.bytes.toString("base64") },
    });
    parts.push({
      text:
        "The attached image is a previous illustration from the same book, for continuity of the setting/" +
        "location only (e.g. if this scene revisits the same place). Do not copy its camera angle, " +
        "composition, or character poses.",
    });
  }

  parts.push({
    text:
      `${story.character_bible}\n\n` +
      `Scene to illustrate: ${chunk.image_prompt}\n\n` +
      "Vary the camera: choose a shot type and angle that fits this specific moment (wide establishing " +
      "shot, medium shot, close-up on faces/expressions, low or high angle, over-the-shoulder, etc.) — " +
      "do not default to a static wide shot from directly in front. If the story moves to a new location " +
      "for this scene, show that new location rather than reusing the previous background. " +
      "Children's picture-book illustration. No text or lettering in the image.",
  });

  return callNanoBanana(parts);
}
