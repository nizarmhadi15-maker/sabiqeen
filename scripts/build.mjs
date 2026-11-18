// يبني صفحة HTML حقيقية لكل مقالة وفتوى وصوت وفيديو وكتاب وموضوع،
// حتى يستطيع Google أرشفة كل صفحة لوحدها. يعمل تلقائياً في GitHub Actions.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "_site");
const ORIGIN = "https://sabiqeen.com";
const mod = async f => import("data:text/javascript;charset=utf-8," + encodeURIComponent(fs.readFileSync(path.join(ROOT, f), "utf8")));
const { firebaseConfig, SITE } = await mod("config.js");
const { I18N } = await mod("i18n.js");
const { PAGES } = await mod("pages.js");
const T = I18N.ar, NAME = SITE.name.ar;

// ---------- Firestore (قراءة عامة فقط عبر REST) ----------
const BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const KEY = `key=${firebaseConfig.apiKey}`;
const val = v => v == null ? null : "stringValue" in v ? v.stringValue : "timestampValue" in v ? v.timestampValue
  : "integerValue" in v ? +v.integerValue : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue
  : "arrayValue" in v ? (v.arrayValue.values || []).map(val) : "mapValue" in v ? obj(v.mapValue.fields || {}) : null;
const obj = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)]));
const docOf = d => ({ id: d.name.split("/").pop(), ...obj(d.fields || {}) });
async function list(coll) {
  const out = []; let tok = "";
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${BASE}/${coll}?pageSize=300&${KEY}${tok ? "&pageToken=" + tok : ""}`);
    if (!r.ok) { console.warn(coll, r.status, await r.text()); break; }
    const j = await r.json(); (j.documents || []).forEach(d => out.push(docOf(d)));
    if (!j.nextPageToken) break; tok = j.nextPageToken;
  }
  return out;
}
async function answered() {
  const r = await fetch(`${BASE}:runQuery?${KEY}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "questions" }], where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "answered" } } }, limit: 5000 } }) });
  if (!r.ok) { console.warn("questions", r.status, await r.text()); return []; }
  return (await r.json()).filter(x => x.document).map(x => docOf(x.document));
}

// ---------- أدوات ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = s => esc(s).replace(/\n/g, "<br>");
const plain = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const day = ts => ts ? String(ts).slice(0, 10) : "";
const ytId = u => (String(u || "").match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) || [])[1];
const thumb = u => ytId(u) ? `https://i.ytimg.com/vi/${ytId(u)}/hqdefault.jpg`
  : /res\.cloudinary\.com\/.+\/video\/upload\//.test(u || "") ? u.replace("/video/upload/", "/video/upload/so_2,w_640/").replace(/\.[a-z0-9]+(\?.*)?$/i, ".jpg") : "";
const hidden = x => (x.reporters || []).length >= 3;
const tpl = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function page({ url, title, desc, body, ld, type = "article" }) {
  const full = title ? `${title} | ${NAME}` : NAME, canon = ORIGIN + url;
  let h = tpl
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(full)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(desc)}`)
    .replace(/(<link rel="canonical" href=")[^"]*/, `$1${canon}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(full)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(desc)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${canon}`)
    .replace(/(<meta property="og:type" content=")[^"]*/, `$1${url === "/" ? "website" : type}`)
    .replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${body}</main>`);
  if (ld) h = h.replace("</head>", `  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n</head>`);
  const file = path.join(OUT, url, "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, h);
}
const crumb = (href, label) => `<div class="crumb"><a href="${href}">${esc(label)}</a></div>`;
const art = (inner) => `<article class="card article">${inner}</article>`;

// ---------- نسخ ملفات الموقع ----------
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
const SKIP = new Set(["_site", "scripts", ".github", ".git", "README.md", "firestore.rules", "node_modules"]);
for (const f of fs.readdirSync(ROOT)) if (!SKIP.has(f) && !f.startsWith(".")) fs.cpSync(path.join(ROOT, f), path.join(OUT, f), { recursive: true });
// أي رابط جديد لم يُبنَ بعد يفتح الموقع العادي
fs.writeFileSync(path.join(OUT, "404.html"), tpl.replace("<head>", '<head>\n  <meta name="robots" content="noindex">'));

// ---------- جلب المحتوى ----------
const [posts, audios, videos, books, threads, fatwas] = await Promise.all(["posts", "audios", "videos", "books", "threads"].map(list).concat(answered()));
const urls = [{ loc: "/", pri: "1.0", freq: "daily" }];
const add = (loc, last, pri = "0.7", freq = "weekly") => urls.push({ loc, last: day(last), pri, freq });
const sortNew = a => a.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));

const SECTIONS = [
  { key: "posts", route: "posts", items: posts, label: T.posts, sub: T.secPosts, type: "Article",
    body: p => `<div class="prose">${nl(p.body)}</div>`, by: p => p.name, desc: p => p.body },
  { key: "audios", route: "audio", items: audios, label: T.audio, sub: T.secAudio, type: "AudioObject",
    body: a => `${a.url ? `<audio controls preload="none" src="${esc(a.url)}"></audio>` : ""}${a.desc ? `<div class="prose">${nl(a.desc)}</div>` : ""}`, by: a => a.speaker, desc: a => a.desc || `${a.title} — ${a.speaker || ""}` },
  { key: "videos", route: "videos", items: videos, label: T.videos, sub: T.secVideos, type: "VideoObject",
    body: v => `${v.desc ? `<div class="prose">${nl(v.desc)}</div>` : ""}`, by: v => v.speaker, desc: v => v.desc || `${v.title} — ${v.speaker || ""}` },
  { key: "books", route: "books", items: books, label: T.books, sub: T.secBooks, type: "Book",
    body: b => `${b.desc ? `<div class="prose">${nl(b.desc)}</div>` : ""}`, by: b => b.author, desc: b => b.desc || `${b.title} — ${b.author || ""}` },
  { key: "threads", route: "forum", items: threads.filter(x => !hidden(x)), label: T.forum, sub: T.secForum, type: "DiscussionForumPosting",
    body: th => `<div class="prose">${nl(th.body)}</div>`, by: th => th.name, desc: th => th.body },
];

for (const S of SECTIONS) {
  sortNew(S.items);
  for (const it of S.items) {
    const url = `/${S.route}/${it.id}/`;
    page({ url, title: it.title, desc: plain(S.desc(it)), type: "article",
      body: art(`${crumb("/" + S.route, S.label)}<h1>${esc(it.title)}</h1><div class="meta">${esc(S.by(it) || "")}${it.createdAt ? " · " + day(it.createdAt) : ""}</div>${S.body(it)}`),
      ld: { "@context": "https://schema.org", "@type": S.type, name: it.title, headline: it.title, url: ORIGIN + url, inLanguage: "ar",
        ...(S.by(it) ? { author: { "@type": "Person", name: S.by(it) } } : {}), ...(it.createdAt ? { datePublished: it.createdAt, uploadDate: it.createdAt } : {}),
        ...(S.key === "videos" ? { description: plain(S.desc(it)) || it.title, ...(thumb(it.url) ? { thumbnailUrl: [thumb(it.url)] } : {}), ...(it.url && /res\.cloudinary\.com/.test(it.url) ? { contentUrl: it.url } : { embedUrl: it.url }) } : {}),
        ...(S.key === "audios" && it.url ? { contentUrl: it.url } : {}) } });
    add(url, it.updatedAt || it.createdAt);
  }
  page({ url: `/${S.route}/`, title: S.label, desc: S.sub, type: "website",
    body: `<div class="page-head"><h1>${esc(S.label)}</h1></div><p class="muted">${esc(S.sub)}</p><div class="list">${S.items.map(it => `<a class="item" href="/${S.route}/${it.id}"><h3>${esc(it.title)}</h3><div class="meta">${esc(S.by(it) || "")}</div></a>`).join("")}</div>` });
  add(`/${S.route}/`, S.items[0]?.createdAt, "0.8", "daily");
}

// الفتاوى (سؤال وجواب)
fatwas.sort((x, y) => String(y.answeredAt || "").localeCompare(String(x.answeredAt || "")));
for (const q of fatwas) {
  const url = `/fatwa/${q.id}/`, title = q.title || plain(q.body, 80), asker = q.showName === false ? T.anonymous : q.name;
  page({ url, title, desc: plain(q.answer || q.body),
    body: art(`${crumb("/fatwa", T.fatwa)}<h1>${esc(title)}</h1><div class="qa q"><div class="qa-label">${T.question}</div><div class="prose">${nl(q.body)}</div><div class="meta">${esc(asker || "")}</div></div><div class="qa a"><div class="qa-label">${T.answer}</div><div class="prose">${nl(q.answer)}</div><div class="meta">${T.answeredBy} <b>${esc(q.sheikhName || "")}</b> · ${day(q.answeredAt)}</div></div>`),
    ld: { "@context": "https://schema.org", "@type": "QAPage", mainEntity: { "@type": "Question", name: title, text: q.body, answerCount: 1, ...(q.createdAt ? { dateCreated: q.createdAt } : {}), author: { "@type": "Person", name: asker || T.anonymous },
      acceptedAnswer: { "@type": "Answer", text: q.answer, url: ORIGIN + url, ...(q.answeredAt ? { dateCreated: q.answeredAt } : {}), author: { "@type": "Person", name: q.sheikhName || NAME } } } } });
  add(url, q.answeredAt);
}
page({ url: "/fatwa/", title: T.fatwa, desc: T.secFatwa, type: "website",
  body: `<div class="page-head"><h1>${esc(T.fatwa)}</h1></div><p class="muted">${esc(T.secFatwa)}</p><div class="list">${fatwas.map(q => `<a class="item fatwa-item" href="/fatwa/${q.id}"><h3>${esc(q.title || plain(q.body, 80))}</h3><p>${esc(plain(q.answer, 140))}</p></a>`).join("")}</div>` });
add("/fatwa/", fatwas[0]?.answeredAt, "0.8", "daily");

// الصفحات الثابتة
for (const k of ["about", "terms", "privacy"]) {
  const P = PAGES[k].ar; page({ url: `/${k}/`, title: P.title, desc: plain(P.html.replace(/<[^>]+>/g, " ")), type: "website", body: `<article class="card narrow article static"><h1>${P.title}</h1><div class="prose">${P.html}</div></article>` });
  add(`/${k}/`, null, "0.4", "monthly");
}
for (const [k, title] of [["contact", T.contactUs], ["donate", T.donate], ["ask", T.ask]]) {
  page({ url: `/${k}/`, title, desc: `${title} — ${NAME}`, type: "website", body: `<div class="card narrow"><h1>${esc(title)}</h1></div>` });
  add(`/${k}/`, null, "0.5", "monthly");
}

// الصفحة الرئيسية: روابط لأحدث المحتوى
const latest = (arr, route, n = 8) => arr.slice(0, n).map(x => `<li><a href="/${route}/${x.id}">${esc(x.title || plain(x.body, 80))}</a></li>`).join("");
page({ url: "/", title: "", desc: tpl.match(/<meta name="description" content="([^"]*)/)[1], type: "website",
  body: `<section class="card"><h1>${esc(NAME)}</h1><p>${esc(SITE.tagline.ar)}</p>
    <h2>${T.fatwa}</h2><ul>${latest(fatwas, "fatwa")}</ul><h2>${T.posts}</h2><ul>${latest(posts, "posts")}</ul>
    <h2>${T.audio}</h2><ul>${latest(audios, "audio")}</ul><h2>${T.videos}</h2><ul>${latest(videos, "videos")}</ul>
    <h2>${T.books}</h2><ul>${latest(books, "books")}</ul><h2>${T.forum}</h2><ul>${latest(threads.filter(x => !hidden(x)), "forum")}</ul></section>` });

// خريطة الموقع
fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${ORIGIN}${u.loc}</loc>${u.last ? `<lastmod>${u.last}</lastmod>` : ""}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join("\n")}
</urlset>
`);
console.log(`Built ${urls.length} URLs: posts=${posts.length} audios=${audios.length} videos=${videos.length} books=${books.length} threads=${threads.length} fatwas=${fatwas.length}`);
