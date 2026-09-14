// Pushes a locally-authored story (from data/stories.json + data/images/)
// into Supabase, so it shows up in the hosted web/ gallery alongside
// self-service-generated ones. Plain fetch()-based REST calls — no
// @supabase/supabase-js dependency needed in the MCP server project.
//
// usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/push-to-supabase.mjs <story_id>
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const dataDir = join(projectRoot, "data");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const storyId = process.argv[2];
if (!storyId) {
  console.error("usage: node scripts/push-to-supabase.mjs <story_id>");
  process.exit(1);
}

function headers(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

async function uploadFile(localPath, storagePath, mimeType) {
  const bytes = await readFile(localPath);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/story-images/${storagePath}`, {
    method: "POST",
    headers: headers({ "Content-Type": mimeType, "x-upsert": "true" }),
    body: bytes,
  });
  if (!res.ok) throw new Error(`Upload failed for ${storagePath}: ${res.status} ${await res.text()}`);
  return storagePath;
}

async function main() {
  const stories = JSON.parse(await readFile(join(dataDir, "stories.json"), "utf-8"));
  const story = stories.find((s) => s.id === storyId);
  if (!story) throw new Error(`No local story with id ${storyId}`);

  const chunks = [...story.chunks].sort((a, b) => a.order - b.order);
  console.log(`Pushing "${story.title}" (${chunks.length} chunks)...`);

  // 1. Create the story row (status ready, reference_image_path filled in after upload).
  let refPath = null;
  if (story.reference_image) {
    const ext = story.reference_image.split(".").pop();
    refPath = `${storyId}/reference.${ext}`;
    await uploadFile(story.reference_image, refPath, ext === "png" ? "image/png" : "image/jpeg");
    console.log("  uploaded reference image");
  }

  const storyRes = await fetch(`${SUPABASE_URL}/rest/v1/stories`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({
      id: storyId,
      title: story.title,
      theme: story.theme,
      age_level: story.age_level,
      character_bible: story.character_bible,
      status: "ready",
      reference_image_path: refPath,
      rating: story.rating,
      notes: story.notes,
      created_at: story.created_at,
    }),
  });
  if (!storyRes.ok) throw new Error(`Story insert failed: ${storyRes.status} ${await storyRes.text()}`);
  console.log("  created story row");

  // 2. Upload each chunk's image, then insert the chunk row.
  for (const chunk of chunks) {
    let imageUrl = null;
    if (chunk.image_url) {
      const ext = chunk.image_url.split(".").pop();
      imageUrl = `${storyId}/${chunk.id}.${ext}`;
      await uploadFile(chunk.image_url, imageUrl, ext === "png" ? "image/png" : "image/jpeg");
    }
    const chunkRes = await fetch(`${SUPABASE_URL}/rest/v1/chunks`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        id: chunk.id,
        story_id: storyId,
        order: chunk.order,
        text: chunk.text,
        image_prompt: chunk.image_prompt,
        image_url: imageUrl,
        status: imageUrl ? "has_image" : "draft",
      }),
    });
    if (!chunkRes.ok) throw new Error(`Chunk ${chunk.id} insert failed: ${chunkRes.status} ${await chunkRes.text()}`);
    console.log(`  chunk ${chunk.order}: ${imageUrl ? "image uploaded" : "no image"}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
