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
- `attach_image(story_id, chunk_id, image_url)` — record a nano banana result.
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

## Status vs. the spec's build order

1. ✅ Scaffolded server, `create_story` + `get_story`, flat JSON storage.
2. ⬜ Generate one full story end-to-end through a live Claude session and
   confirm the tool calls feel natural.
3. ⬜ Manually feed image prompts to nano banana; confirm consistency holds.
4. ✅ `attach_image` implemented (ready once step 3 produces URLs).
5. ✅ `list_stories` / `rate_story` implemented.
6. ⬜ Auto-call nano banana from the server; PDF/web assembly; TTS.
7. ⬜ iPad viewer (static site reading the story data, Add to Home Screen).

## Open questions (from the spec, still unresolved)

- Storage: stay on flat JSON, or move to Supabase to match the read-it-later
  project's stack?
- Image assembly: simple HTML page per story, or export to PDF?
- Where do finished books live — just files, or a small gallery view?
