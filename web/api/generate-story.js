// Vercel Serverless Function: POST /api/generate-story
//
// Body (JSON): { prompt: string, age_level?: string,
//                character_image?: { base64: string, mimeType: string } }
//
// Writes the story with Claude, illustrates it with nano banana (Gemini
// 2.5 Flash Image), and persists everything to Supabase. Runs long (a
// couple of minutes for a full book) — see vercel.json for maxDuration.
//
// Responds immediately with { story_id } once the story row is created,
// then continues generating in the background (Vercel keeps the function
// alive via waitUntil-style completion — see note at the bottom). The
// frontend polls GET /api/story-status?id=<story_id> to watch progress.

import { waitUntil } from "@vercel/functions";
import { supabase } from "./_supabase.js";

const GEMINI_MODEL = process.env.NANO_BANANA_MODEL || "gemini-2.5-flash-image";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const CLAUDE_MODEL = "claude-sonnet-5";

// ---------------------------------------------------------------------------
// Claude: write the story
// ---------------------------------------------------------------------------
async function writeStory(prompt, ageLevel, characterImage) {
  const content = [];
  if (characterImage) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: characterImage.mimeType, data: characterImage.base64 },
    });
    content.push({
      type: "text",
      text:
        "The attached image shows a character to use in the story — describe it accurately (exact " +
        "colors, markings, proportions, accessories) in character_bible so an image model can reproduce " +
        "it consistently, without inventing a different design.",
    });
  }
  content.push({
    type: "text",
    text:
      `Write a short illustrated children's picture book. Prompt from the parent: "${prompt}"\n` +
      `Target age: ${ageLevel || "3-6"}\n\n` +
      "Split it into 6-9 chunks (one per page/scene). Each chunk needs narrative text (a couple of " +
      "sentences, age-appropriate) and a self-contained image_prompt describing that scene visually, " +
      "including an explicit shot type/camera angle that fits the moment (wide, medium, close-up, " +
      "over-the-shoulder, low/high angle, etc.) — vary these across chunks, don't repeat the same shot. " +
      "character_bible should be a single fixed paragraph describing every character's design (colors, " +
      "markings, proportions, accessories) and the art style/palette, to keep every illustration " +
      "consistent — it gets prepended to every chunk's image generation. Only include a character in a " +
      "chunk's image_prompt if that chunk's narrative text actually calls for them to be present.",
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
      tools: [
        {
          name: "write_story",
          description: "Submit the finished story.",
          input_schema: {
            type: "object",
            required: ["title", "theme", "age_level", "character_bible", "chunks"],
            properties: {
              title: { type: "string" },
              theme: { type: "string" },
              age_level: { type: "string" },
              character_bible: { type: "string" },
              chunks: {
                type: "array",
                minItems: 5,
                maxItems: 10,
                items: {
                  type: "object",
                  required: ["text", "image_prompt"],
                  properties: {
                    text: { type: "string" },
                    image_prompt: { type: "string" },
                  },
                },
              },
            },
          },
        },
      ],
      tool_choice: { type: "tool", name: "write_story" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const toolUse = data.content?.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a write_story tool call.");
  return toolUse.input;
}

// ---------------------------------------------------------------------------
// nano banana: images
// ---------------------------------------------------------------------------
async function callNanoBanana(parts) {
  const apiKey = process.env.GEMINI_API_KEY;
  const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"] } }),
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new Error(`nano banana failed (${body?.error?.status ?? res.status}): ${body?.error?.message ?? res.statusText}`);
  }
  const imagePart = body?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!imagePart) throw new Error(`nano banana returned no image (finishReason: ${body?.candidates?.[0]?.finishReason}).`);
  return { bytes: Buffer.from(imagePart.inlineData.data, "base64"), mimeType: imagePart.inlineData.mimeType || "image/png" };
}

async function generateReference(characterBible, anchorImage) {
  const parts = [];
  if (anchorImage) {
    parts.push({ inlineData: { mimeType: anchorImage.mimeType, data: anchorImage.base64 } });
    parts.push({
      text:
        "The attached image is the approved, exact design for one of the characters described below — " +
        "match it precisely. Redraw that character plus the rest of the cast in a single consistent " +
        "illustration style suitable for a children's picture book.",
    });
  }
  parts.push({
    text:
      `${characterBible}\n\nCharacter reference sheet: show all the characters clearly, full body, ` +
      "standing side by side in simple neutral poses facing slightly toward camera, on a plain neutral " +
      "background. No text or lettering in the image.",
  });
  return callNanoBanana(parts);
}

async function generateChunkImage(characterBible, chunk, referenceImage) {
  const parts = [];
  if (referenceImage) {
    parts.push({ inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.bytes.toString("base64") } });
    parts.push({
      text:
        "The attached image is the approved character reference sheet, showing the full cast. For any " +
        "character that DOES appear in this scene, match their design from it exactly. Do not copy its " +
        "plain background, poses, or camera framing, and do not include a character from it who isn't " +
        "actually called for by the scene description below — only draw characters the scene text " +
        "mentions or clearly implies.",
    });
  }
  parts.push({
    text:
      `${characterBible}\n\nScene to illustrate: ${chunk.image_prompt}\n\n` +
      "Children's picture-book illustration. No text or lettering in the image.",
  });
  return callNanoBanana(parts);
}

// ---------------------------------------------------------------------------
// Supabase storage helper
// ---------------------------------------------------------------------------
async function uploadImage(storyId, filename, bytes, mimeType) {
  const path = `${storyId}/${filename}`;
  const { error } = await supabase.storage.from("story-images").upload(path, bytes, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed for ${path}: ${error.message}`);
  return path;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const { prompt, age_level, character_image } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // Create a placeholder row immediately so the frontend has an id to poll.
  const { data: placeholder, error: insertErr } = await supabase
    .from("stories")
    .insert({ title: "Генерируется…", theme: prompt.slice(0, 200), age_level: age_level || "3-6", character_bible: "", status: "generating" })
    .select()
    .single();
  if (insertErr) {
    res.status(500).json({ error: `Could not create story row: ${insertErr.message}` });
    return;
  }
  const storyId = placeholder.id;

  // Respond right away with the id to poll, then keep working via
  // waitUntil — Vercel (Fluid Compute) keeps the function alive for this
  // promise even after the response has been sent, up to maxDuration
  // (see vercel.json). Without waitUntil, work after res.json() has no
  // execution-time guarantee and can be cut off.
  res.status(202).json({ story_id: storyId });
  waitUntil(generateRest(storyId, prompt, age_level, character_image));
}

async function generateRest(storyId, prompt, age_level, character_image) {
  try {
    const story = await writeStory(prompt, age_level, character_image);

    await supabase
      .from("stories")
      .update({ title: story.title, theme: story.theme, age_level: story.age_level, character_bible: story.character_bible })
      .eq("id", storyId);

    const chunkRows = story.chunks.map((c, i) => ({ story_id: storyId, order: i, text: c.text, image_prompt: c.image_prompt }));
    const { data: insertedChunks, error: chunksErr } = await supabase.from("chunks").insert(chunkRows).select();
    if (chunksErr) throw new Error(`Could not save chunks: ${chunksErr.message}`);
    const chunks = insertedChunks.sort((a, b) => a.order - b.order);

    const refImage = await generateReference(story.character_bible, character_image);
    const refPath = await uploadImage(storyId, `reference.${refImage.mimeType.includes("png") ? "png" : "jpg"}`, refImage.bytes, refImage.mimeType);
    await supabase.from("stories").update({ reference_image_path: refPath }).eq("id", storyId);

    for (const chunk of chunks) {
      const img = await generateChunkImage(story.character_bible, chunk, refImage);
      const ext = img.mimeType.includes("png") ? "png" : "jpg";
      const path = await uploadImage(storyId, `${chunk.id}.${ext}`, img.bytes, img.mimeType);
      await supabase.from("chunks").update({ image_path: path, status: "has_image" }).eq("id", chunk.id);
    }

    await supabase.from("stories").update({ status: "ready" }).eq("id", storyId);
  } catch (err) {
    await supabase.from("stories").update({ status: "error", error_message: String(err?.message || err) }).eq("id", storyId);
  }
}

// Node.js runtime (not Edge) — needs Buffer, longer execution, and the
// Supabase SDK. maxDuration is set in vercel.json.
export const config = { runtime: "nodejs" };
