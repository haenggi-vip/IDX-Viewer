import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = dirname(fileURLToPath(import.meta.url));
const markdownPath = join(root, "Anwenderdokumentation.md");
const outputPath = join(root, "help.html");

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

const markdown = await readFile(markdownPath, "utf8");
let article = await marked.parse(markdown, { gfm: true });
const usedIds = new Map();

article = article.replace(
  /href="Benutzerdokumentation\.md(?:#[^"]*)?"/g,
  'href="Benutzerdokumentation_detailliert.docx"',
);

article = article.replace(
  /<h([1-4])>([\s\S]*?)<\/h\1>/g,
  (match, level, content) => {
    const baseId = slugify(content);
    const occurrence = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, occurrence + 1);
    const id = occurrence === 0 ? baseId : `${baseId}-${occurrence + 1}`;
    return `<h${level} id="${id}">${content}</h${level}>`;
  },
);

article = article.replace(
  /<img src="([^"]+)" alt="([^"]*)">/g,
  '<a class="help-image-link" href="$1" target="_blank" rel="noopener"><img src="$1" alt="$2" loading="lazy"></a>',
);

const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IDX Viewer – Hilfe</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17212b;
      --muted: #5f6d79;
      --line: #d8e0e6;
      --panel: #f4f7f9;
      --accent: #087ca7;
      --accent-dark: #075d7b;
      --warning: #fff5cc;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      color: var(--ink);
      background: #fff;
      font: 15px/1.58 "Segoe UI", Arial, sans-serif;
    }
    .help-topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 58px;
      padding: 9px 18px;
      color: #fff;
      background: #1e272e;
      border-bottom: 3px solid #0fbcf9;
    }
    .help-topbar strong { font-size: 18px; letter-spacing: .01em; }
    .help-topbar span { color: #b9c5ce; font-size: 13px; }
    .help-topbar-actions { display: flex; gap: 8px; margin-left: auto; }
    .help-topbar a, .help-topbar button {
      min-height: 36px;
      padding: 7px 12px;
      border: 1px solid #63717c;
      border-radius: 6px;
      color: #fff;
      background: #34424d;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      text-decoration: none;
    }
    .help-topbar a:hover, .help-topbar button:hover {
      background: #087ca7;
      border-color: #0fbcf9;
    }
    .help-layout {
      display: grid;
      grid-template-columns: 270px minmax(0, 920px);
      justify-content: center;
      gap: 34px;
      padding: 28px 28px 72px;
    }
    .help-nav {
      position: sticky;
      top: 86px;
      align-self: start;
      max-height: calc(100vh - 112px);
      overflow: auto;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
    }
    .help-nav strong {
      display: block;
      margin-bottom: 9px;
      color: var(--accent-dark);
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .help-nav a {
      display: block;
      padding: 5px 8px;
      border-radius: 5px;
      color: #334451;
      font-size: 13px;
      line-height: 1.25;
      text-decoration: none;
    }
    .help-nav a:hover, .help-nav a.active {
      color: #fff;
      background: var(--accent);
    }
    .help-article { min-width: 0; }
    .help-article h1 {
      margin: 0 0 4px;
      color: #132a3a;
      font-size: clamp(30px, 5vw, 46px);
      line-height: 1.08;
    }
    .help-article h2 {
      scroll-margin-top: 82px;
      margin: 50px 0 14px;
      padding-bottom: 8px;
      color: #163b52;
      border-bottom: 2px solid #bad7e3;
      font-size: 25px;
      line-height: 1.2;
    }
    .help-article h3 {
      scroll-margin-top: 82px;
      margin: 30px 0 9px;
      color: var(--accent-dark);
      font-size: 19px;
    }
    .help-article h4 { color: #294b5f; }
    .help-article p { margin: 8px 0 13px; }
    .help-article li { margin: 4px 0; }
    .help-article a { color: #087ca7; }
    .help-article code {
      padding: 2px 5px;
      border-radius: 4px;
      color: #733c00;
      background: #fff0d8;
      font: 13px Consolas, monospace;
    }
    .help-article pre {
      overflow: auto;
      padding: 14px 16px;
      border: 1px solid #d7dde2;
      border-radius: 8px;
      background: #f3f5f7;
    }
    .help-article pre code { padding: 0; color: #26333d; background: none; }
    .help-article table {
      width: 100%;
      margin: 14px 0 22px;
      border-spacing: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .help-article th, .help-article td {
      padding: 9px 11px;
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    .help-article th { color: #163b52; background: #e6f1f5; }
    .help-article tr:last-child td { border-bottom: 0; }
    .help-article th:last-child, .help-article td:last-child { border-right: 0; }
    .help-image-link {
      display: block;
      margin: 19px 0 28px;
      border: 1px solid #b8c7d1;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 6px 20px rgba(21, 47, 63, .12);
      background: #eef3f6;
    }
    .help-image-link img { display: block; width: 100%; height: auto; }
    .help-image-link:focus { outline: 3px solid #0fbcf9; outline-offset: 3px; }
    blockquote {
      margin: 16px 0;
      padding: 10px 16px;
      border-left: 4px solid #e0b420;
      background: var(--warning);
    }
    @media (max-width: 900px) {
      .help-layout { grid-template-columns: 1fr; padding: 18px 16px 60px; }
      .help-nav { position: static; max-height: 240px; }
      .help-topbar span { display: none; }
    }
    @media (max-width: 600px) {
      .help-topbar { align-items: flex-start; flex-wrap: wrap; }
      .help-topbar-actions { width: 100%; margin-left: 0; }
      .help-topbar a, .help-topbar button { flex: 1; text-align: center; }
      .help-article table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <header class="help-topbar">
    <strong>IDX Viewer Hilfe</strong>
    <span>Praxisorientierte Bedienungsanleitung mit Klickmarkierungen</span>
    <div class="help-topbar-actions">
      <a href="Anwenderdokumentation.docx" download>Word-Dokument herunterladen</a>
      <button id="close-help" type="button">Hilfe schließen</button>
    </div>
  </header>
  <div class="help-layout">
    <nav class="help-nav" aria-label="Hilfethemen">
      <strong>Hilfethemen</strong>
      <div id="help-navigation"></div>
    </nav>
    <main class="help-article">${article}</main>
  </div>
  <script>
    const navigation = document.getElementById("help-navigation");
    const headings = Array.from(document.querySelectorAll(".help-article h2"));
    headings.forEach((heading) => {
      const link = document.createElement("a");
      link.href = "#" + heading.id;
      link.textContent = heading.textContent;
      navigation.appendChild(link);
    });

    const links = Array.from(navigation.querySelectorAll("a"));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => {
          link.classList.toggle("active", link.hash === "#" + entry.target.id);
        });
      });
    }, { rootMargin: "-80px 0px -75% 0px" });
    headings.forEach((heading) => observer.observe(heading));

    function closeHelp() {
      if (window.parent !== window) {
        window.parent.postMessage("idx-help-close", "*");
      } else {
        window.close();
      }
    }
    document.getElementById("close-help").addEventListener("click", closeHelp);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeHelp();
    });
  </script>
</body>
</html>
`;

await writeFile(outputPath, html, "utf8");
console.log(`Erzeugt: ${outputPath}`);
