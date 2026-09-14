# Story Engine MCP

An MCP server that stores illustrated stories for Ян: narrative text broken into
"chunks," each paired with an image-generation prompt, ready to hand to nano
banana (Gemini 2.5 Flash Image) for artwork.

**Who writes the story?** The connected assistant (Claude) does — this server
has no LLM credentials of its own. In a chat session with this server attached,
Claude drafts the story, the character/style bible, and each chunk's image
prompt, then calls `create_story` to persist the result. That keeps the server
a thin, dependency-free data layer.

## Tools

- `create_story(title, theme, age_level, character_bible, chunks[])` — save a
  freshly written story. `character_bible` is the fixed character/style/palette
  description; prepend it to each chunk's `image_prompt` before sending to
  nano banana, for consistent character rendering across pages.
- `get_story(id)` — full story with all chunks, prompts, and image URLs.
- `list_stories(theme?, character?, rating?)` — lightweight summaries, filterable.
- `regenerate_chunk(story_id, chunk_id, text?, image_prompt?)` — redo one
  chunk's text and/or image prompt in place. Changing the prompt clears any
  previously attached image, since it no longer matches.
- `attach_image(story_id, chunk_id, image_url)` — record a nano banana result
  generated outside the server (e.g. by hand in AI Studio).
- `generate_image(story_id, chunk_id, reference_chunk_id?)` — call nano banana
  (Gemini 2.5 Flash Image) directly: `character_bible` + the chunk's
  `image_prompt`, optionally grounded on another chunk's already-generated
  image via `reference_chunk_id` for character/setting consistency (camera
  angle and pose are deliberately left free to vary, per the spec). Saves the
  PNG under `data/images/<story_id>/<chunk_id>.png` and attaches it — same
  effect as `attach_image`, just automatic. Requires `GEMINI_API_KEY`.
- `rate_story(id, reaction, notes?)` — log how it landed (e.g. `"loved"`), to
  steer future prompts.

## Storage

Flat JSON at `data/stories.json` (created on first run), matching step 1 of
the build order in the project spec. `data/` is gitignored since it's local,
personal content — back it up separately if you want to keep it. Override the
location with `STORY_ENGINE_DATA_DIR` if needed.

## Setup

```bash
npm install
npm run build
```

To use `generate_image`, put a Gemini API key in `.env` (gitignored, not
committed):

```
GEMINI_API_KEY=your-key-here
```

Get one at [Google AI Studio](https://aistudio.google.com/apikey). Note:
Gemini's image models (nano banana) require **billing enabled** on the
associated Cloud project — the free tier's request quota for image models is
0, so an API-key-only free-tier project will get a `RESOURCE_EXHAUSTED` error
with `limit: 0` on every call until billing is turned on.

Register it with Claude Code / Claude Desktop by pointing at the built entry
point:

```json
{
  "mcpServers": {
    "story-engine": {
      "command": "node",
      "args": ["/Users/romangorbatov/code/story-engine/dist/index.js"]
    }
  }
}
```

(For Claude Code: `claude mcp add story-engine -- node /Users/romangorbatov/code/story-engine/dist/index.js`)

## Manual testing

`scripts/try-generate-image.mjs` calls `generate_image` over a real MCP
stdio connection, without needing a full chat session:

```bash
node scripts/try-generate-image.mjs <story_id> <chunk_id> [reference_chunk_id]
```

## Status vs. the spec's build order

1. ✅ Scaffolded server, `create_story` + `get_story`, flat JSON storage.
2. ✅ Generated one full story ("Хэри Маклери и муравьед", 10 chunks) through
   a live Claude session via the real tool calls.
3. 🟡 `generate_image` calls nano banana directly and is verified against the
   real API (correct model, request shape, error handling) — but the current
   `GEMINI_API_KEY`'s project has no billing enabled, so every call currently
   returns `RESOURCE_EXHAUSTED` (free-tier image quota is 0). Enable billing
   on the key's Google Cloud project, then re-run to confirm consistency
   holds across chunks.
4. ✅ `attach_image` implemented and exercised.
5. ✅ `list_stories` / `rate_story` implemented.
6. 🟡 Auto-call nano banana from the server — done (`generate_image`), blocked
   on billing above. PDF/web assembly and TTS still open.
7. ⬜ iPad viewer (static site reading the story data, Add to Home Screen).

## Open questions (from the spec, still unresolved)

- Storage: stay on flat JSON, or move to Supabase to match the read-it-later
  project's stack?
- Image assembly: simple HTML page per story, or export to PDF?
- Where do finished books live — just files, or a small gallery view?
