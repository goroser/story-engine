// Renders a story as a single self-contained, flippable HTML "book" page.
import type { Story } from "./types.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * imageRelPaths maps chunk id -> path to the image file, relative to the
 * output HTML file's own directory (so the page works via a plain file://
 * open, no server needed).
 */
export function renderBookHtml(story: Story, imageRelPaths: Record<string, string | undefined>): string {
  const chunks = [...story.chunks].sort((a, b) => a.order - b.order);
  const coverImage = chunks[0]?.id ? imageRelPaths[chunks[0].id] : undefined;

  const pages: string[] = [];

  // Cover
  pages.push(`
    <section class="page cover" data-page="0">
      ${coverImage ? `<img class="cover-image" src="${escapeHtml(coverImage)}" alt="">` : ""}
      <div class="cover-overlay">
        <h1>${escapeHtml(story.title)}</h1>
        <p class="cover-sub">${escapeHtml(story.theme)}${story.age_level ? ` · ${escapeHtml(story.age_level)}` : ""}</p>
      </div>
    </section>`);

  // Spreads
  chunks.forEach((chunk, i) => {
    const imgSrc = imageRelPaths[chunk.id];
    pages.push(`
    <section class="page spread" data-page="${i + 1}">
      <div class="spread-image">
        ${
          imgSrc
            ? `<img src="${escapeHtml(imgSrc)}" alt="">`
            : `<div class="missing-image">No image yet</div>`
        }
      </div>
      <div class="spread-text">
        <p>${escapeHtml(chunk.text)}</p>
      </div>
    </section>`);
  });

  // End page
  pages.push(`
    <section class="page end" data-page="${chunks.length + 1}">
      <div class="end-content">
        <p class="the-end">Конец</p>
        <p class="end-title">${escapeHtml(story.title)}</p>
      </div>
    </section>`);

  const totalPages = pages.length;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(story.title)}</title>
<style>
  :root {
    color-scheme: light;
    --paper: #fbf6ec;
    --ink: #3a2e22;
    --accent: #c96a3b;
    --muted: #8a7b64;
    --shadow: rgba(58, 46, 34, 0.18);
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    height: 100%;
    background: #2b2620;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, serif;
    color: var(--ink);
    overflow: hidden;
    -webkit-user-select: none;
    user-select: none;
  }
  #book {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .page {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.35s ease;
  }
  .page.active {
    opacity: 1;
    visibility: visible;
  }

  /* Cover */
  .cover {
    align-items: center;
    justify-content: flex-end;
    /* stays position:absolute from .page — already a positioning context
       for .cover-image/.cover-overlay below, don't override it here */
  }
  .cover-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cover-overlay {
    position: relative;
    z-index: 1;
    width: 100%;
    padding: 32px 28px calc(64px + env(safe-area-inset-bottom));
    background: linear-gradient(to top, rgba(20,15,10,0.85) 0%, rgba(20,15,10,0.55) 60%, transparent 100%);
    text-align: center;
  }
  .cover h1 {
    margin: 0 0 8px;
    color: #fff8ec;
    font-size: clamp(28px, 6vw, 48px);
    text-shadow: 0 2px 10px rgba(0,0,0,0.4);
  }
  .cover-sub {
    margin: 0;
    color: #f0e6d2;
    font-size: clamp(14px, 2.5vw, 18px);
    letter-spacing: 0.02em;
  }

  /* Spread */
  .spread {
    flex-direction: column;
  }
  .spread-image {
    flex: 1 1 60%;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #eee4d0;
    overflow: hidden;
  }
  .spread-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .missing-image {
    color: var(--muted);
    font-style: italic;
  }
  .spread-text {
    flex: 0 0 auto;
    padding: 20px 28px calc(24px + env(safe-area-inset-bottom));
    max-height: 40%;
    overflow-y: auto;
  }
  .spread-text p {
    margin: 0;
    font-size: clamp(16px, 2.6vw, 22px);
    line-height: 1.5;
    text-align: center;
  }

  /* End */
  .end {
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .the-end {
    font-size: clamp(30px, 6vw, 52px);
    color: var(--accent);
    margin: 0 0 12px;
  }
  .end-title {
    color: var(--muted);
    font-size: clamp(14px, 2.5vw, 18px);
    margin: 0;
  }

  /* Nav */
  .nav-zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 30%;
    z-index: 5;
    cursor: pointer;
  }
  .nav-zone.prev { left: 0; }
  .nav-zone.next { right: 0; }

  .arrow-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 6;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    border: none;
    background: rgba(58,46,34,0.55);
    color: #fbf6ec;
    font-size: 20px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .arrow-btn:disabled { opacity: 0.25; cursor: default; }
  .arrow-btn.prev { left: 14px; }
  .arrow-btn.next { right: 14px; }

  .progress {
    position: absolute;
    left: 50%;
    bottom: calc(10px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    gap: 6px;
  }
  .progress .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(58,46,34,0.25);
  }
  .progress .dot.current {
    background: var(--accent);
    width: 16px;
  }
  .page.cover ~ .progress, .page.end ~ .progress {}
</style>
</head>
<body>
  <div id="book">
    ${pages.join("\n")}
    <button class="arrow-btn prev" aria-label="Previous page">&#8249;</button>
    <button class="arrow-btn next" aria-label="Next page">&#8250;</button>
    <div class="nav-zone prev" aria-hidden="true"></div>
    <div class="nav-zone next" aria-hidden="true"></div>
    <div class="progress"></div>
  </div>
<script>
(function () {
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var total = pages.length;
  var current = 0;
  var progress = document.querySelector('.progress');
  var prevBtn = document.querySelector('.arrow-btn.prev');
  var nextBtn = document.querySelector('.arrow-btn.next');

  for (var i = 0; i < total; i++) {
    var dot = document.createElement('div');
    dot.className = 'dot';
    progress.appendChild(dot);
  }
  var dots = Array.prototype.slice.call(progress.children);

  function render() {
    for (var i = 0; i < total; i++) {
      pages[i].classList.toggle('active', i === current);
      dots[i].classList.toggle('current', i === current);
    }
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === total - 1;
  }

  function go(delta) {
    var next = current + delta;
    if (next < 0 || next >= total) return;
    current = next;
    render();
  }

  prevBtn.addEventListener('click', function () { go(-1); });
  nextBtn.addEventListener('click', function () { go(1); });
  document.querySelector('.nav-zone.prev').addEventListener('click', function () { go(-1); });
  document.querySelector('.nav-zone.next').addEventListener('click', function () { go(1); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === ' ') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });

  // Swipe
  var touchStartX = null;
  document.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touchStartX = null;
  }, { passive: true });

  render();
})();
</script>
</body>
</html>
`;
}
