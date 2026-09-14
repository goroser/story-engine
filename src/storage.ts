import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Story } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/storage.js -> project root is one level up from dist/
const projectRoot = join(__dirname, "..");

const dataDir = process.env.STORY_ENGINE_DATA_DIR ?? join(projectRoot, "data");
const dataFile = join(dataDir, "stories.json");

// Serialize reads/writes so concurrent tool calls can't race on the JSON file.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}

async function ensureDataFile(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(dataFile, "utf-8");
  } catch {
    await writeFile(dataFile, "[]\n", "utf-8");
  }
}

async function readAll(): Promise<Story[]> {
  await ensureDataFile();
  const raw = await readFile(dataFile, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("stories.json is not an array");
    return parsed as Story[];
  } catch (err) {
    throw new Error(`Failed to parse ${dataFile}: ${(err as Error).message}`);
  }
}

async function writeAll(stories: Story[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(stories, null, 2) + "\n", "utf-8");
}

export function loadStories(): Promise<Story[]> {
  return serialize(readAll);
}

export function saveStory(story: Story): Promise<Story> {
  return serialize(async () => {
    const stories = await readAll();
    const idx = stories.findIndex((s) => s.id === story.id);
    if (idx >= 0) stories[idx] = story;
    else stories.push(story);
    await writeAll(stories);
    return story;
  });
}

export function getStoryById(id: string): Promise<Story | undefined> {
  return serialize(async () => {
    const stories = await readAll();
    return stories.find((s) => s.id === id);
  });
}

/** Load, mutate, and persist a story in one serialized step (avoids read-modify-write races). */
export function updateStory<T>(
  id: string,
  mutate: (story: Story) => T
): Promise<{ story: Story; result: T } | undefined> {
  return serialize(async () => {
    const stories = await readAll();
    const idx = stories.findIndex((s) => s.id === id);
    if (idx < 0) return undefined;
    const story = stories[idx];
    const result = mutate(story);
    stories[idx] = story;
    await writeAll(stories);
    return { story, result };
  });
}

export { dataDir, dataFile };
