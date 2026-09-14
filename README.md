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
- `generate_character_reference(story_id, notes?, anchor_image_path?)` —
  render a candidate character/model sheet from `character_bible` alone
  (neutral pose, no scene), for review before illustrating any chunk.
  Optionally pass `anchor_image_path` (e.g. a photo/drawing you provide of
  one character, from `data/uploads/`) to lock that character's exact design
  and draw the rest of the cast to match it. Doesn't touch the story; call it
  as many times as you like.
- `approve_reference_image(story_id, image_path)` — lock in a reference image
  as the story's approved character design: a `generate_character_reference`
  candidate, or any image file of your own (e.g. a reference you drew or
  found). The file is copied into the story's data folder. Every
  `generate_image` call afterward anchors character design on this image
  instead of drifting.
- `update_character_bible(story_id, character_bible)` — replace the bible
  text, e.g. after approving a reference image whose art style differs from
  the original description (chunk `image_prompt`s are untouched).
- `generate_image(story_id, chunk_id, reference_chunk_id?)` — call nano banana
  (Gemini 2.5 Flash Image) directly: `character_bible` + the chunk's
  `image_prompt`. If the story has an approved `reference_image`, it's used
  automatically to anchor character design. `reference_chunk_id` optionally
  grounds the *setting* on another chunk's image (e.g. a revisited location).
  Camera angle, shot type, and pose are always left free to vary — the prompt
  explicitly tells nano banana to pick a composition that fits the scene
  rather than reusing the same static shot. Saves the PNG under
  `data/images/<story_id>/<chunk_id>.png` and attaches it — same effect as
  `attach_image`, just automatic. Requires `GEMINI_API_KEY`.
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

## Uploading your own character reference

To ground generation on your own reference image instead of one nano banana
invents from the bible text, drop the file in `data/uploads/` (created for
this, gitignored) and approve it:

```bash
node scripts/try-tool.mjs approve_reference_image '{"story_id":"<id>","image_path":"data/uploads/your-file.png"}'
```

**A note on copyrighted characters:** if a story uses a real, published
character (name and/or likeness from an existing book, show, etc.), treat
any reference image or generated art the same way you'd treat a scan of the
book itself — fine for a private family keepsake, not something to publish,
print for sale, or post publicly. `story-engine` doesn't enforce this; it's
on you per-story.

## Manual testing

`scripts/try-tool.mjs` calls any tool over a real MCP stdio connection,
without needing a full chat session:

```bash
node scripts/try-tool.mjs <tool_name> '<json args>'
# e.g.
node scripts/try-tool.mjs generate_character_reference '{"story_id":"<id>"}'
node scripts/try-tool.mjs generate_image '{"story_id":"<id>","chunk_id":"<id>"}'
```

`scripts/try-generate-image.mjs <story_id> <chunk_id> [reference_chunk_id]`
is a thin positional-args wrapper around `generate_image` specifically.

## Status vs. the spec's build order

1. ✅ Scaffolded server, `create_story` + `get_story`, flat JSON storage.
2. ✅ Generated one full story ("Хэри Маклери и муравьед", 10 chunks) through
   a live Claude session via the real tool calls.
3. ✅ Generated all 10 images for the test story via `generate_image` and
   confirmed consistency holds — see note below on the reference technique.
4. ✅ `attach_image` implemented and exercised.
5. ✅ `list_stories` / `rate_story` implemented.
6. 🟡 Auto-call nano banana from the server — done (`generate_image`). PDF/web
   assembly and TTS still open.
7. ⬜ iPad viewer (static site reading the story data, Add to Home Screen).

### Consistency lessons learned

Three rounds of feedback reshaped how character consistency and camera
variety work here:

1. **Don't chain reference images off the previous story chunk.** Early
   version anchored each new chunk on whatever the immediately preceding
   chunk looked like. That propagates drift — including intentionally faint
   or partial renders (one chunk's prompt called for a character to appear
   only as a background silhouette, and every later chunk that referenced
   its predecessor inherited that washed-out look for several pages, even
   once the text said the character was fully present) and general per-call
   variance (by chunk 3, the character's proportions and markings had
   already drifted from the bible). **Fix:** generate a dedicated character
   reference sheet from `character_bible` alone (`generate_character_reference`),
   review it, lock it in (`approve_reference_image`), and anchor every
   chunk on *that one approved image* — never on other chunks' output.
2. **Without explicit instruction, nano banana defaults to the same static
   wide shot for every scene.** `generate_image`'s prompt now explicitly
   asks for a shot type and angle that fits each specific moment (wide /
   medium / close-up, high or low angle, over-the-shoulder, etc.) and
   permits changing location when the story does, instead of reusing the
   same camera position and background across the whole book.
3. **A generic "vary the camera" system instruction isn't enough on its own
   if several chunks' `image_prompt` text is itself generic and similar**
   (e.g. six consecutive scenes all set at the same riverbank, each prompt
   just describing who's standing where). The model has little to latch onto
   for variety when the scene description doesn't suggest one. **Fix:**
   rewrite the repetitive `image_prompt`s themselves with an explicit shot
   call-out per chunk (close-up on faces, over-the-shoulder, wide shot from
   behind, top-down on a water reflection, low dynamic angle for action,
   etc.) via `regenerate_chunk`, then re-run `generate_image`. When output
   has a fixable root cause in the prompt/text rather than just needing a
   stronger system instruction, propose and make that rewrite rather than
   only flagging the symptom.

## Open questions (from the spec, still unresolved)

- Storage: stay on flat JSON, or move to Supabase to match the read-it-later
  project's stack?
- Image assembly: simple HTML page per story, or export to PDF?
- Where do finished books live — just files, or a small gallery view?
