// Exports a static, deployable site: an index gallery + one book page per
// story with its images, into site/ (gitignored build output). Run after
// `npm run build` so dist/book.js exists.
import { mkdir, readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBookHtml } from "../dist/book.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const dataDir = join(projectRoot, "data");
const siteDir = join(projectRoot, "site");

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function main() {
  const stories = JSON.parse(await readFile(join(dataDir, "stories.json"), "utf-8"));

  await mkdir(join(siteDir, "books"), { recursive: true });
  await mkdir(join(siteDir, "images"), { recursive: true });

  const galleryEntries = [];

  for (const story of stories) {
    const chunks = [...story.chunks].sort((a, b) => a.order - b.order);
    const hasAnyImage = chunks.some((c) => c.image_url);
    if (!hasAnyImage) continue; // skip stories with nothing illustrated yet

    const storyImageDir = join(siteDir, "images", story.id);
    await mkdir(storyImageDir, { recursive: true });

    const imageRelPaths = {};
    for (const chunk of chunks) {
      if (!chunk.image_url) continue;
      const ext = chunk.image_url.split(".").pop();
      const destName = `${chunk.id}.${ext}`;
      await copyFile(chunk.image_url, join(storyImageDir, destName));
      // relative to site/books/<story_id>.html
      imageRelPaths[chunk.id] = `../images/${story.id}/${destName}`;
    }

    const html = renderBookHtml(story, imageRelPaths);
    await writeFile(join(siteDir, "books", `${story.id}.html`), html, "utf-8");

    galleryEntries.push({
      id: story.id,
      title: story.title,
      theme: story.theme,
      ageLevel: story.age_level,
      coverRel: imageRelPaths[chunks[0]?.id] ? `images/${story.id}/${chunks[0].id}.${chunks[0].image_url.split(".").pop()}` : null,
      pageCount: chunks.length + 2,
    });
  }

  const cards = galleryEntries
    .map(
      (e) => `
      <a class="card" href="books/${e.id}.html">
        ${e.coverRel ? `<img src="${escapeHtml(e.coverRel)}" alt="">` : `<div class="no-cover"></div>`}
        <div class="card-body">
          <h2>${escapeHtml(e.title)}</h2>
          <p>${escapeHtml(e.theme)}${e.ageLevel ? ` · ${escapeHtml(e.ageLevel)}` : ""} · ${e.pageCount} стр.</p>
        </div>
      </a>`
    )
    .join("\n");

  const indexHtml = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Истории</title>
<meta name="robots" content="noindex, nofollow">
<link rel="apple-touch-icon" href="icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Истории">
<style>
  :root { color-scheme: light; --paper:#fbf6ec; --ink:#3a2e22; --accent:#c96a3b; --muted:#8a7b64; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--paper);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, serif;
    padding: max(20px, env(safe-area-inset-top)) 20px 40px;
  }
  h1 { text-align: center; font-size: clamp(24px, 5vw, 36px); margin: 12px 0 28px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 20px;
    max-width: 1000px;
    margin: 0 auto;
  }
  .card {
    display: block;
    text-decoration: none;
    color: inherit;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(58,46,34,0.12);
  }
  .card img, .no-cover {
    width: 100%;
    aspect-ratio: 4/3;
    object-fit: cover;
    display: block;
    background: #eee4d0;
  }
  .card-body { padding: 12px 14px 16px; }
  .card-body h2 { margin: 0 0 4px; font-size: 17px; }
  .card-body p { margin: 0; font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
  <h1>📖 Истории</h1>
  <div class="grid">
    ${cards || "<p style='text-align:center;color:var(--muted)'>Пока нет иллюстрированных историй.</p>"}
  </div>
</body>
</html>
`;

  await writeFile(join(siteDir, "index.html"), indexHtml, "utf-8");
  console.log(`Exported ${galleryEntries.length} stories to ${siteDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
