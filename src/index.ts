#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateChunkImage, generateReferenceSheet, NanoBananaError } from "./nanobanana.js";
import { dataDir, getStoryById, loadStories, saveStory, updateStory } from "./storage.js";
import type { Chunk, Story } from "./types.js";

// Load GEMINI_API_KEY (and friends) from a local .env file if present. Never
// throws — the file is optional, e.g. when the key is set in the MCP client's
// own env config instead.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fine, env vars may already be set another way
}

const server = new McpServer({
  name: "story-engine",
  version: "0.1.0",
});

function textResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function summarize(story: Story) {
  return {
    id: story.id,
    title: story.title,
    theme: story.theme,
    age_level: story.age_level,
    created_at: story.created_at,
    rating: story.rating,
    chunk_count: story.chunks.length,
    reference_image: story.reference_image,
  };
}

// ---------------------------------------------------------------------------
// create_story
//
// The calling assistant (Claude) writes the story text, the character/style
// bible, and each chunk's image prompt itself — this tool just validates the
// shape and persists it. That keeps the server free of any LLM credentials.
// ---------------------------------------------------------------------------
server.registerTool(
  "create_story",
  {
    title: "Create story",
    description:
      "Save a newly written story: title, theme, age level, a character/style bible " +
      "(prepend this to every chunk's image_prompt when generating art, for visual " +
      "consistency across images), and an ordered list of chunks (narrative text + " +
      "self-contained image prompt per page/scene). Returns the saved story with ids.",
    inputSchema: {
      title: z.string().min(1),
      theme: z.string().min(1),
      age_level: z.string().min(1).describe("e.g. \"3-5\", \"6-8\""),
      character_bible: z
        .string()
        .min(1)
        .describe(
          "Fixed description of characters, setting, art style and palette, generated once per story."
        ),
      chunks: z
        .array(
          z.object({
            text: z.string().min(1),
            image_prompt: z
              .string()
              .min(1)
              .describe("Scene-specific visual description for this chunk (bible is prepended separately)."),
          })
        )
        .min(1),
    },
  },
  async ({ title, theme, age_level, character_bible, chunks }) => {
    const now = new Date().toISOString();
    const story: Story = {
      id: randomUUID(),
      title,
      theme,
      age_level,
      character_bible,
      reference_image: null,
      created_at: now,
      rating: null,
      notes: null,
      chunks: chunks.map((c, i): Chunk => ({
        id: randomUUID(),
        order: i,
        text: c.text,
        image_prompt: c.image_prompt,
        image_url: null,
        status: "draft",
      })),
    };
    await saveStory(story);
    return textResult(story);
  }
);

// ---------------------------------------------------------------------------
// get_story
// ---------------------------------------------------------------------------
server.registerTool(
  "get_story",
  {
    title: "Get story",
    description: "Fetch a full story by id, including all chunks, image prompts, and image URLs.",
    inputSchema: {
      id: z.string().min(1),
    },
  },
  async ({ id }) => {
    const story = await getStoryById(id);
    if (!story) return errorResult(`No story found with id "${id}".`);
    return textResult(story);
  }
);

// ---------------------------------------------------------------------------
// list_stories
// ---------------------------------------------------------------------------
server.registerTool(
  "list_stories",
  {
    title: "List stories",
    description:
      "Browse saved stories, optionally filtered by theme, a character name (matched against " +
      "the character bible), or rating. Returns lightweight summaries, not full chunk content.",
    inputSchema: {
      theme: z.string().optional().describe("Case-insensitive substring match against title or theme."),
      character: z
        .string()
        .optional()
        .describe("Case-insensitive substring match against the character_bible text."),
      rating: z.string().optional().describe("Exact match against a story's rating."),
    },
  },
  async ({ theme, character, rating }) => {
    const stories = await loadStories();
    const filtered = stories.filter((s) => {
      if (theme) {
        const needle = theme.toLowerCase();
        if (!s.theme.toLowerCase().includes(needle) && !s.title.toLowerCase().includes(needle)) {
          return false;
        }
      }
      if (character && !s.character_bible.toLowerCase().includes(character.toLowerCase())) {
        return false;
      }
      if (rating && s.rating !== rating) return false;
      return true;
    });
    return textResult(filtered.map(summarize));
  }
);

// ---------------------------------------------------------------------------
// regenerate_chunk
// ---------------------------------------------------------------------------
server.registerTool(
  "regenerate_chunk",
  {
    title: "Regenerate chunk",
    description:
      "Replace one chunk's text and/or image_prompt (already rewritten by the calling assistant) " +
      "without touching the rest of the story. Pass whichever of text/image_prompt changed.",
    inputSchema: {
      story_id: z.string().min(1),
      chunk_id: z.string().min(1),
      text: z.string().min(1).optional(),
      image_prompt: z.string().min(1).optional(),
    },
  },
  async ({ story_id, chunk_id, text, image_prompt }) => {
    if (text === undefined && image_prompt === undefined) {
      return errorResult("Provide at least one of text or image_prompt to update.");
    }
    const outcome = await updateStory(story_id, (story) => {
      const chunk = story.chunks.find((c) => c.id === chunk_id);
      if (!chunk) return undefined;
      if (text !== undefined) chunk.text = text;
      if (image_prompt !== undefined) {
        chunk.image_prompt = image_prompt;
        // A reworded prompt invalidates any previously attached image.
        chunk.image_url = null;
        chunk.status = "draft";
      }
      return chunk;
    });
    if (!outcome) return errorResult(`No story found with id "${story_id}".`);
    if (!outcome.result) return errorResult(`No chunk found with id "${chunk_id}" in story "${story_id}".`);
    return textResult(outcome.result);
  }
);

// ---------------------------------------------------------------------------
// attach_image
// ---------------------------------------------------------------------------
server.registerTool(
  "attach_image",
  {
    title: "Attach image",
    description: "Record a generated image URL against a chunk once nano banana has produced it.",
    inputSchema: {
      story_id: z.string().min(1),
      chunk_id: z.string().min(1),
      image_url: z.string().min(1),
    },
  },
  async ({ story_id, chunk_id, image_url }) => {
    const outcome = await updateStory(story_id, (story) => {
      const chunk = story.chunks.find((c) => c.id === chunk_id);
      if (!chunk) return undefined;
      chunk.image_url = image_url;
      chunk.status = "has_image";
      return chunk;
    });
    if (!outcome) return errorResult(`No story found with id "${story_id}".`);
    if (!outcome.result) return errorResult(`No chunk found with id "${chunk_id}" in story "${story_id}".`);
    return textResult(outcome.result);
  }
);

function imageExt(mimeType: string): string {
  return mimeType.includes("png") ? "png" : mimeType.split("/")[1] || "png";
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  png: "image/png",
};

async function loadImageRef(path: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const bytes = await readFile(path);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = MIME_BY_EXT[ext] ?? "image/png";
  return { bytes, mimeType };
}

// ---------------------------------------------------------------------------
// update_character_bible
// ---------------------------------------------------------------------------
server.registerTool(
  "update_character_bible",
  {
    title: "Update character bible",
    description:
      "Replace a story's character_bible text, e.g. after approving a reference image whose art style " +
      "or character details differ from the original description. Existing chunk image_prompts are " +
      "untouched — the bible is prepended to them at generation time.",
    inputSchema: {
      story_id: z.string().min(1),
      character_bible: z.string().min(1),
    },
  },
  async ({ story_id, character_bible }) => {
    const outcome = await updateStory(story_id, (s) => {
      s.character_bible = character_bible;
    });
    if (!outcome) return errorResult(`No story found with id "${story_id}".`);
    return textResult(outcome.story);
  }
);

// ---------------------------------------------------------------------------
// generate_character_reference
//
// Renders a candidate character reference sheet from character_bible alone —
// no scene content — so the cast's design can be reviewed and locked in
// before any chunk is illustrated. Recommended workflow: call this (possibly
// a few times, tweaking notes/character_bible between tries), look at the
// result, then approve_reference_image once it's right.
// ---------------------------------------------------------------------------
server.registerTool(
  "generate_character_reference",
  {
    title: "Generate character reference",
    description:
      "Render a candidate character reference/model sheet from the story's character_bible alone " +
      "(neutral pose, neutral background, no scene) — for review before illustrating any chunk. " +
      "Optionally pass anchor_image_path (e.g. a user-supplied drawing or photo of one character) to " +
      "lock that character's exact design and have the rest of the cast drawn to match it, in the same " +
      "style. Each call produces a new timestamped file and does NOT change the story; call " +
      "approve_reference_image once a candidate looks right. Re-run with different notes, or edit " +
      "character_bible first, to try again.",
    inputSchema: {
      story_id: z.string().min(1),
      notes: z.string().optional().describe("Extra guidance for this attempt, e.g. \"make the fox smaller\"."),
      anchor_image_path: z
        .string()
        .min(1)
        .optional()
        .describe("Path to a reference image for one character whose exact design should be matched."),
    },
  },
  async ({ story_id, notes, anchor_image_path }) => {
    const story = await getStoryById(story_id);
    if (!story) return errorResult(`No story found with id "${story_id}".`);

    let anchorImage: { bytes: Buffer; mimeType: string } | undefined;
    if (anchor_image_path) {
      try {
        anchorImage = await loadImageRef(anchor_image_path);
      } catch (err) {
        return errorResult(`Could not read "${anchor_image_path}": ${(err as Error).message}`);
      }
    }

    let image;
    try {
      image = await generateReferenceSheet(story, notes, anchorImage);
    } catch (err) {
      if (err instanceof NanoBananaError) return errorResult(err.message);
      return errorResult(`Unexpected error calling nano banana: ${(err as Error).message}`);
    }

    const imageDir = join(dataDir, "images", story_id);
    await mkdir(imageDir, { recursive: true });
    const imagePath = join(imageDir, `reference-candidate-${Date.now()}.${imageExt(image.mimeType)}`);
    await writeFile(imagePath, image.bytes);
    return textResult({ story_id, candidate_path: imagePath });
  }
);

// ---------------------------------------------------------------------------
// approve_reference_image
// ---------------------------------------------------------------------------
server.registerTool(
  "approve_reference_image",
  {
    title: "Approve reference image",
    description:
      "Lock in an image as the story's approved character reference — from a generate_character_reference " +
      "candidate, or any image file of your own (e.g. a hand-drawn or uploaded reference for what the " +
      "characters should look like). The file is copied into the story's own data folder, so the original " +
      "can move or be deleted afterward. Every generate_image call afterward anchors character design on " +
      "this image instead of drifting across chunks.",
    inputSchema: {
      story_id: z.string().min(1),
      image_path: z.string().min(1),
    },
  },
  async ({ story_id, image_path }) => {
    let bytes: Buffer;
    try {
      bytes = await readFile(image_path);
    } catch (err) {
      return errorResult(`Could not read "${image_path}": ${(err as Error).message}`);
    }
    const ext = image_path.split(".").pop()?.toLowerCase() || "png";
    const imageDir = join(dataDir, "images", story_id);
    await mkdir(imageDir, { recursive: true });
    const storedPath = join(imageDir, `reference-approved.${ext}`);
    await writeFile(storedPath, bytes);

    const outcome = await updateStory(story_id, (s) => {
      s.reference_image = storedPath;
    });
    if (!outcome) return errorResult(`No story found with id "${story_id}".`);
    return textResult(summarize(outcome.story));
  }
);

// ---------------------------------------------------------------------------
// generate_image
//
// Calls nano banana (Gemini 2.5 Flash Image) directly, saves the result under
// data/images/, and attaches it to the chunk — the auto-call step from the
// spec's build order, instead of manually copy-pasting prompts into a UI.
// ---------------------------------------------------------------------------
server.registerTool(
  "generate_image",
  {
    title: "Generate image",
    description:
      "Render one chunk's illustration by calling nano banana (Gemini 2.5 Flash Image) with the story's " +
      "character_bible plus this chunk's image_prompt. If the story has an approved reference_image " +
      "(see approve_reference_image), it's used automatically to anchor character design — recommended " +
      "for any story with more than one or two chunks, since generation drifts otherwise. Optionally also " +
      "pass reference_chunk_id to ground the *setting* on another chunk's image (e.g. a revisited " +
      "location) — camera angle, framing, and pose are always left free to vary regardless of references, " +
      "and the model is instructed to pick a shot type that fits the scene rather than reusing the same " +
      "static composition. Saves the PNG locally under data/images/ and records it on the chunk, same " +
      "effect as attach_image. Requires GEMINI_API_KEY in the server's environment.",
    inputSchema: {
      story_id: z.string().min(1),
      chunk_id: z.string().min(1),
      reference_chunk_id: z.string().min(1).optional(),
    },
  },
  async ({ story_id, chunk_id, reference_chunk_id }) => {
    const story = await getStoryById(story_id);
    if (!story) return errorResult(`No story found with id "${story_id}".`);
    const chunk = story.chunks.find((c) => c.id === chunk_id);
    if (!chunk) return errorResult(`No chunk found with id "${chunk_id}" in story "${story_id}".`);

    let characterReference: { bytes: Buffer; mimeType: string } | undefined;
    if (story.reference_image) {
      try {
        characterReference = await loadImageRef(story.reference_image);
      } catch (err) {
        return errorResult(
          `Could not read approved reference_image at "${story.reference_image}": ${(err as Error).message}`
        );
      }
    }

    let sceneReference: { bytes: Buffer; mimeType: string } | undefined;
    if (reference_chunk_id) {
      const refChunk = story.chunks.find((c) => c.id === reference_chunk_id);
      if (!refChunk) {
        return errorResult(`No chunk found with id "${reference_chunk_id}" in story "${story_id}".`);
      }
      if (!refChunk.image_url) {
        return errorResult(`Reference chunk "${reference_chunk_id}" has no generated image yet.`);
      }
      try {
        sceneReference = await loadImageRef(refChunk.image_url);
      } catch (err) {
        return errorResult(`Could not read reference image at "${refChunk.image_url}": ${(err as Error).message}`);
      }
    }

    let image;
    try {
      image = await generateChunkImage({ story, chunk, characterReference, sceneReference });
    } catch (err) {
      if (err instanceof NanoBananaError) return errorResult(err.message);
      return errorResult(`Unexpected error calling nano banana: ${(err as Error).message}`);
    }

    const imageDir = join(dataDir, "images", story_id);
    await mkdir(imageDir, { recursive: true });
    const imagePath = join(imageDir, `${chunk_id}.${imageExt(image.mimeType)}`);
    await writeFile(imagePath, image.bytes);

    const outcome = await updateStory(story_id, (s) => {
      const c = s.chunks.find((c) => c.id === chunk_id)!;
      c.image_url = imagePath;
      c.status = "has_image";
      return c;
    });
    return textResult(outcome!.result);
  }
);

// ---------------------------------------------------------------------------
// rate_story
// ---------------------------------------------------------------------------
server.registerTool(
  "rate_story",
  {
    title: "Rate story",
    description:
      "Record how a story landed with Ян (e.g. \"loved\", \"liked\", \"meh\", \"disliked\") and optional notes " +
      "on what worked, to steer future prompts.",
    inputSchema: {
      id: z.string().min(1),
      reaction: z.string().min(1),
      notes: z.string().optional(),
    },
  },
  async ({ id, reaction, notes }) => {
    const outcome = await updateStory(id, (story) => {
      story.rating = reaction;
      if (notes !== undefined) story.notes = notes;
    });
    if (!outcome) return errorResult(`No story found with id "${id}".`);
    return textResult(summarize(outcome.story));
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("story-engine MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting story-engine MCP server:", err);
  process.exit(1);
});
