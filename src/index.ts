#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateChunkImage, NanoBananaError } from "./nanobanana.js";
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
      "Render one chunk's illustration by calling nano banana (Gemini 2.5 Flash Image) with the " +
      "story's character_bible plus this chunk's image_prompt. Optionally pass reference_chunk_id " +
      "to ground it on another chunk's already-generated image, for consistent character/setting " +
      "look across the book (camera angle and pose are still left free to vary). Saves the PNG " +
      "locally under data/images/ and records it on the chunk, same effect as attach_image. " +
      "Requires GEMINI_API_KEY in the server's environment.",
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

    let referenceImage: { bytes: Buffer; mimeType: string } | undefined;
    if (reference_chunk_id) {
      const refChunk = story.chunks.find((c) => c.id === reference_chunk_id);
      if (!refChunk) {
        return errorResult(`No chunk found with id "${reference_chunk_id}" in story "${story_id}".`);
      }
      if (!refChunk.image_url) {
        return errorResult(`Reference chunk "${reference_chunk_id}" has no generated image yet.`);
      }
      try {
        const bytes = await readFile(refChunk.image_url);
        referenceImage = { bytes, mimeType: "image/png" };
      } catch (err) {
        return errorResult(`Could not read reference image at "${refChunk.image_url}": ${(err as Error).message}`);
      }
    }

    let image;
    try {
      image = await generateChunkImage({ story, chunk, referenceImage });
    } catch (err) {
      if (err instanceof NanoBananaError) return errorResult(err.message);
      return errorResult(`Unexpected error calling nano banana: ${(err as Error).message}`);
    }

    const ext = image.mimeType.includes("png") ? "png" : image.mimeType.split("/")[1] || "png";
    const imageDir = join(dataDir, "images", story_id);
    await mkdir(imageDir, { recursive: true });
    const imagePath = join(imageDir, `${chunk_id}.${ext}`);
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
