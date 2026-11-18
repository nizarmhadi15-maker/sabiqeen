import { firebaseConfig, SITE, ADMIN_EMAILS } from "./config.js";
import { I18N } from "./i18n.js";
import { PAGES } from "./pages.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
  updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

// ---------- state & helpers ----------
let user = null, profile = null, authReady = false;
let lang = localStorage.getItem("lang") || SITE.defaultLang || "ar";
const t = k => I18N[lang][k] ?? I18N.ar[k] ?? k;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = s => esc(s).replace(/\n/g, "<br>");
const safeUrl = u => /^https?:\/\//i.test(u || "") ? esc(u) : "";
const excerpt = (s, n = 160) => { s = String(s || ""); return esc(s.length > n ? s.slice(0, n) + "…" : s); };
const fmtDate = ts => ts?.toDate ? ts.toDate().toLocaleDateString(lang === "ar" ? "ar" : "en-GB", { year: "numeric", month: "long", day: "numeric" }) : "";
const ms = ts => ts?.toMillis ? ts.toMillis() : Date.now();
const role = () => profile?.role || "user";
const isAdmin = () => !!user && (role() === "admin" ||
  (user.emailVerified && ADMIN_EMAILS.map(e => e.toLowerCase()).includes((user.email || "").toLowerCase())));
const isSheikh = () => isAdmin() || role() === "sheikh";
const isBanned = () => !!user && !isAdmin() && role() === "banned";
const myName = () => profile?.name || user?.displayName || (user?.email || "").split("@")[0];
const siteName = () => SITE.name[lang] || SITE.name.ar;

const CATS = {
  questions: ["ibadat", "muamalat", "family", "aqeedah", "other"],
  threads: ["general", "quran", "hadith", "fiqh", "seerah", "other"],
  audios: ["quran", "lectures", "khutab", "lessons"],
  books: ["quran_sci", "hadith", "fiqh", "aqeedah", "seerah", "other"]
};
const ROUTE_OF = { posts: "posts", audios: "audio", books: "books", threads: "forum", questions: "fatwa" };

const ICON = {
  posts: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/>',
  audio: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
  books: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 7h6"/>',
  forum: '<path d="M4 5h12v9H8l-4 3z"/><path d="M16 9h4v9l-3-2h-7v-2"/>',
  fatwa: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>'
};
const icon = (k, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

function avatar(name, photo, size = 34) {
  const p = safeUrl(photo);
  return p ? `<img class="av" src="${p}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`
    : `<span class="av" style="width:${size}px;height:${size}px">${esc((name || "?").trim().charAt(0))}</span>`;
}
function toast(msg, bad = false) {
  const el = $("#toast"); el.textContent = msg; el.className = "show" + (bad ? " bad" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.className = "", 3200);
}
function errMsg(e) {
  const c = e?.code || "";
  if (/invalid-credential|wrong-password|user-not-found/.test(c)) return t("err_auth");
  if (/email-already-in-use/.test(c)) return t("err_exists");
  if (/weak-password/.test(c)) return t("err_weak");
  if (/invalid-email/.test(c)) return t("err_email");
  if (/permission-denied/.test(c)) return t("err_perm");
  return t("error") + (e?.message ? ": " + e.message : "");
}
function requireLogin() {
  if (user) return true;
  sessionStorage.setItem("after", location.hash);
  location.hash = "#/login";
  return false;
}
const main = () => $("#app");
const denied = () => main().innerHTML = `<div class="empty">${t("noAccess")}</div>`;
const sheikhBadge = r => r === "sheikh" || r === "admin" ? `<span class="badge">${t("sheikh")}</span>` : "";

async function latest(coll, n = 50) {
  const s = await getDocs(query(collection(db, coll), orderBy("createdAt", "desc"), limit(n)));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function answeredFatwas(n = 300) {
  const s = await getDocs(query(collection(db, "questions"), where("status", "==", "answered"), limit(500)));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.answeredAt) - ms(a.answeredAt)).slice(0, n);
}
async function getOne(coll, id) {
  const s = await getDoc(doc(db, coll, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// ---------- layout ----------
function renderShell() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = siteName();
  $("#brandName").textContent = siteName();
  $("#footer").innerHTML = `<b>${esc(siteName())}</b> — ${esc(SITE.tagline[lang])}<nav class="foot-links"><a href="#/about">${t("aboutUs")}</a><a href="#/contact">${t("contactUs")}</a><a href="#/terms">${t("terms")}</a><a href="#/privacy">${t("privacy")}</a></nav><small>© ${new Date().getFullYear()} ${t("footer")}</small>`;
  const links = [["home", "#/"], ["posts", "#/posts"], ["audio", "#/audio"], ["books", "#/books"], ["forum", "#/forum"], ["fatwa", "#/fatwa"]];
  $("#nav").innerHTML = links.map(([k, h]) => `<a href="${h}" data-k="${k}">${t(k)}</a>`).join("") +
    `<a href="#/ask" class="nav-ask">${t("ask")}</a>` +
    (user && isSheikh() ? `<a href="#/panel" class="nav-staff" data-k="panel">${t("panel")}</a>` : "") +
    (user && isAdmin() ? `<a href="#/admin" class="nav-staff" data-k="admin">${t("admin")}</a>` : "");
  $("#langBtn").textContent = lang === "ar" ? "EN" : "ع";
  $("#userbox").innerHTML = !authReady ? "" : user
    ? `${isSheikh() ? `<a class="btn ghost sm" href="#/panel">${t("panel")}</a>` : ""}${isAdmin() ? `<a class="btn ghost sm" href="#/admin">${t("admin")}</a>` : ""}
       <a class="me" href="#/profile" title="${esc(myName())}">${avatar(myName(), user.photoURL)}</a>`
    : `<a class="btn sm" href="#/login">${t("login")}</a>`;
}
$("#langBtn").onclick = () => { lang = lang === "ar" ? "en" : "ar"; localStorage.setItem("lang", lang); renderShell(); route(); };
$("#menuBtn").onclick = () => document.body.classList.toggle("nav-open");
document.addEventListener("play", e => $$("audio").forEach(a => a !== e.target && a.pause()), true);

// ---------- router ----------
let routeId = 0;
async function route() {
  const my = ++routeId;
  document.body.classList.remove("nav-open");
  const [p, id, extra] = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.k === (p || "home") || (p === "fatwa" && a.dataset.k === "fatwa")));
  main().innerHTML = `<div class="loading"><span class="spin"></span>${t("loading")}</div>`;
  window.scrollTo(0, 0);
  if (!authReady) return;
  try {
    const r = await (async () => {
      switch (p) {
        case undefined: case "home": return pageHome();
        case "posts": return id ? viewPost(id) : listPosts();
        case "audio": return id ? viewAudio(id) : listAudio();
        case "books": return id ? viewBook(id) : listBooks();
        case "forum": return id ? viewThread(id) : listForum();
        case "fatwa": return id ? viewFatwa(id) : listFatwa();
        case "ask": return pageAsk();
        case "login": return pageLogin();
        case "profile": return pageProfile();
        case "panel": return pagePanel();
        case "admin": return pageAdmin();
        case "new": return pageNew(id);
        case "edit": return pageNew(id, extra);
        case "about": case "terms": case "privacy": return pageStatic(p);
        case "contact": return pageContact();
        default: main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
      }
    })();
    return r;
  } catch (e) {
    console.error(e);
    if (my === routeId) main().innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
  }
}
window.addEventListener("hashchange", route);

// ---------- auth ----------
onAuthStateChanged(auth, async u => {
  user = u; profile = null;
  if (u) {
    try {
      const ref = doc(db, "users", u.uid);
      let s = await getDoc(ref);
      if (!s.exists()) {
        await setDoc(ref, { name: u.displayName || (u.email || "").split("@")[0], email: u.email || "", photo: u.photoURL || "", role: "user", createdAt: serverTimestamp() });
        s = await getDoc(ref);
      }
      profile = s.data();
    } catch (e) { console.error(e); }
  }
  authReady = true;
  renderShell();
  route();
});

function afterLogin() {
  const to = sessionStorage.getItem("after"); sessionStorage.removeItem("after");
  location.hash = to && !to.includes("login") ? to : "#/";
}

function pageLogin() {
  if (user) return afterLogin();
  let mode = "login";
  const draw = () => {
    main().innerHTML = `
    <div class="auth card">
      <h1>${mode === "reset" ? t("forgot") : mode === "register" ? t("register") : t("login")}</h1>
      ${mode !== "reset" ? `
      <button class="btn google" id="gBtn"><svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>${t("google")}</button>
      <div class="or"><span>${t("or")}</span></div>` : ""}
      <form id="aForm" class="form">
        ${mode === "register" ? `<label>${t("name")}<input name="name" required maxlength="60"></label>` : ""}
        <label>${t("email")}<input name="email" type="email" required autocomplete="email"></label>
        ${mode !== "reset" ? `<label>${t("password")}<input name="pw" type="password" required minlength="6" autocomplete="${mode === "register" ? "new-password" : "current-password"}"></label>` : ""}
        <button class="btn wide">${mode === "reset" ? t("sendReset") : mode === "register" ? t("createAccount") : t("login")}</button>
      </form>
      <div class="auth-links">
        ${mode === "login" ? `<a href="#" data-m="reset">${t("forgot")}</a><a href="#" data-m="register">${t("register")}</a>`
        : `<a href="#" data-m="login">${t("backToLogin")}</a>`}
      </div>
    </div>`;
    $$(".auth-links a").forEach(a => a.onclick = e => { e.preventDefault(); mode = a.dataset.m; draw(); });
    const g = $("#gBtn");
    if (g) g.onclick = async () => {
      const prov = new GoogleAuthProvider();
      try { await signInWithPopup(auth, prov); afterLogin(); }
      catch (e) {
        if (/popup-blocked|operation-not-supported/.test(e.code)) return signInWithRedirect(auth, prov);
        if (!/popup-closed|cancelled-popup/.test(e.code)) toast(errMsg(e), true);
      }
    };
    $("#aForm").onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const btn = e.target.querySelector("button"); btn.disabled = true;
      try {
        if (mode === "reset") { await sendPasswordResetEmail(auth, f.email.trim()); toast(t("resetSent")); mode = "login"; draw(); return; }
        if (mode === "register") {
          const cred = await createUserWithEmailAndPassword(auth, f.email.trim(), f.pw);
          const name = f.name.trim();
          await updateProfile(cred.user, { displayName: name });
          await setDoc(doc(db, "users", cred.user.uid), { name, email: cred.user.email, photo: "", role: "user", createdAt: serverTimestamp() });
          profile = { ...(profile || {}), name, role: "user" };
          renderShell();
        } else {
          await signInWithEmailAndPassword(auth, f.email.trim(), f.pw);
        }
        afterLogin();
      } catch (err) { toast(errMsg(err), true); btn.disabled = false; }
    };
  };
  draw();
}

// ---------- comments ----------
async function comments(el, coll, id, kind = "comments") {
  const col = collection(db, coll, id, "comments");
  el.innerHTML = `<h3>${t(kind)} <span class="count"></span></h3><div class="clist"></div>
    ${isBanned() ? `<p class="login-hint">${t("bannedMsg")}</p>` : user ? `<form class="cform">${avatar(myName(), user.photoURL)}<textarea required maxlength="3000" placeholder="${t(kind === "replies" ? "writeReply" : "writeComment")}"></textarea><button class="btn sm">${t("send")}</button></form>`
      : `<a class="login-hint" href="#/login" onclick="sessionStorage.setItem('after',location.hash)">${t("loginToComment")}</a>`}`;
  const load = async () => {
    const s = await getDocs(query(col, orderBy("createdAt", "asc"), limit(500)));
    const list = s.docs.map(d => ({ id: d.id, ...d.data() }));
    $(".count", el).textContent = list.length ? `(${list.length})` : "";
    $(".clist", el).innerHTML = list.length ? list.map(c => `
      <div class="comment${c.badge ? " is-sheikh" : ""}">
        ${avatar(c.name, c.photo)}
        <div class="cbody">
          <div class="cmeta"><b>${esc(c.name)}</b>${sheikhBadge(c.badge)}<span>${fmtDate(c.createdAt)}</span>
            ${user && (c.uid === user.uid || isAdmin()) ? `<button class="link danger" data-del="${c.id}">${t("delete")}</button>` : ""}</div>
          <div class="ctext">${nl(c.text)}</div>
        </div>
      </div>`).join("") : `<p class="muted">${t("noComments")}</p>`;
    $$("[data-del]", el).forEach(b => b.onclick = async () => {
      if (!confirm(t("confirmDelete"))) return;
      try { await deleteDoc(doc(col, b.dataset.del)); load(); } catch (e) { toast(errMsg(e), true); }
    });
  };
  const f = $(".cform", el);
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const ta = $("textarea", f), text = ta.value.trim(); if (!text) return;
    const btn = $("button", f); btn.disabled = true;
    try {
      const data = { text, uid: user.uid, name: myName(), photo: user.photoURL || "", createdAt: serverTimestamp() };
      if (isSheikh()) data.badge = "sheikh";
      await addDoc(col, data); ta.value = ""; await load();
    } catch (err) { toast(errMsg(err), true); }
    btn.disabled = false;
  };
  await load();
}

// ---------- generic list page ----------
function listPage({ titleKey, action, cats, items, render, wrap = "list" }) {
  main().innerHTML = `
    <div class="page-head"><h1>${t(titleKey)}</h1>${action ? `<a class="btn" href="${action.href}">${action.label}</a>` : ""}</div>
    <div class="toolbar"><input class="search" type="search" placeholder="${t("search")}">
      ${cats ? `<div class="chips">${["all", ...cats].map(c => `<button class="chip${c === "all" ? " on" : ""}" data-c="${c}">${t(c === "all" ? "all" : "cat_" + c)}</button>`).join("")}</div>` : ""}
    </div>
    <div class="${wrap}" id="items"></div>`;
  let cat = "all", q = "";
  const draw = () => {
    const f = items.filter(i => (cat === "all" || i.category === cat) &&
      (!q || [i.title, i.body, i.author, i.speaker, i.desc, i.answer, i.name].join(" ").toLowerCase().includes(q)));
    $("#items").innerHTML = f.length ? f.map(render).join("") : `<div class="empty">${t("empty")}</div>`;
  };
  $(".search").oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
  $$(".chip").forEach(c => c.onclick = () => { $$(".chip").forEach(x => x.classList.remove("on")); c.classList.add("on"); cat = c.dataset.c; draw(); });
  draw();
}
const catTag = c => c ? `<span class="tag">${t("cat_" + c)}</span>` : "";
const meta = (name, ts, extra = "") => `<div class="meta">${esc(name || "")}${name ? " · " : ""}${fmtDate(ts)}${extra}</div>`;

const TYPE_OF = { posts: "post", audios: "audio", books: "book", threads: "thread" };
function delBtn(coll, item) {
  const can = user && !isBanned() && (isAdmin() || (coll !== "threads" ? isSheikh() : item.uid === user.uid));
  return can ? `<a class="btn ghost sm" href="#/edit/${TYPE_OF[coll]}/${item.id}">${t("edit")}</a><button class="btn ghost sm danger" id="delItem">${t("delete")}</button>` : "";
}
function bindDel(coll, id, back) {
  const b = $("#delItem"); if (!b) return;
  b.onclick = async () => {
    if (!confirm(t("confirmDelete"))) return;
    try { await deleteDoc(doc(db, coll, id)); location.hash = back; } catch (e) { toast(errMsg(e), true); }
  };
}

// ---------- home ----------
async function pageHome() {
  const [posts, audios, books, fats, threads] = await Promise.all([
    latest("posts", 3), latest("audios", 4), latest("books", 6), answeredFatwas(4), latest("threads", 4)]);
  const secs = [["posts", "#/posts", "secPosts"], ["audio", "#/audio", "secAudio"], ["books", "#/books", "secBooks"], ["forum", "#/forum", "secForum"], ["fatwa", "#/fatwa", "secFatwa"]];
  const block = (key, href, html) => `<section class="block"><div class="block-head"><h2>${t(key)}</h2><a href="${href}">${t("viewAll")} ←</a></div>${html}</section>`;
  main().innerHTML = `
    <section class="hero">
      <div class="hero-in">
        <p class="eyebrow">${esc(siteName())}</p>
        <h1>${t("heroTitle")}</h1>
        <p>${t("heroSub")}</p>
        <div class="hero-btns"><a class="btn gold" href="#/ask">${t("ask")}</a><a class="btn ghost light" href="#/fatwa">${t("browseFatwas")}</a></div>
      </div>
    </section>
    <div class="secs">${secs.map(([k, h, d]) => `<a class="sec" href="${h}">${icon(k)}<b>${t(k)}</b><small>${t(d)}</small></a>`).join("")}</div>
    <div class="home-grid">
      <div>
        ${block("latestFatwas", "#/fatwa", fats.length ? `<div class="list">${fats.map(fatwaItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
        ${block("latestPosts", "#/posts", posts.length ? `<div class="list">${posts.map(postItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
      </div>
      <div>
        ${block("latestAudio", "#/audio", audios.length ? `<div class="list">${audios.map(audioItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
        ${block("latestThreads", "#/forum", threads.length ? `<div class="list">${threads.map(threadItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
      </div>
    </div>
    ${block("latestBooks", "#/books", books.length ? `<div class="bookgrid">${books.map(bookItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}`;
}

// ---------- posts ----------
const postItem = p => `<a class="item" href="#/posts/${p.id}"><h3>${esc(p.title)}</h3><p>${excerpt(p.body)}</p>${meta(p.name, p.createdAt)}</a>`;
async function listPosts() {
  const items = await latest("posts", 200);
  listPage({ titleKey: "posts", items, render: postItem, action: isSheikh() ? { href: "#/new/post", label: "+ " + t("newPost") } : null });
}
async function viewPost(id) {
  const p = await getOne("posts", id); if (!p) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="#/posts">${t("posts")}</a></div>
    <h1>${esc(p.title)}</h1>${meta(p.name, p.createdAt)}<div class="prose">${nl(p.body)}</div>
    <div class="actions">${delBtn("posts", p)}</div></article><section class="card" id="cm"></section>`;
  bindDel("posts", id, "#/posts");
  await comments($("#cm"), "posts", id);
}

// ---------- audio ----------
const audioItem = a => `<div class="item audio-item"><div class="ai-head">${icon("audio", "ic sm")}<div><a href="#/audio/${a.id}"><h3>${esc(a.title)}</h3></a>
  <div class="meta">${esc(a.speaker || "")} ${catTag(a.category)}</div></div></div>${safeUrl(a.url) ? `<audio controls preload="none" src="${safeUrl(a.url)}"></audio>` : ""}</div>`;
async function listAudio() {
  const items = await latest("audios", 300);
  listPage({ titleKey: "audio", items, render: audioItem, cats: CATS.audios, action: isSheikh() ? { href: "#/new/audio", label: "+ " + t("newAudio") } : null });
}
async function viewAudio(id) {
  const a = await getOne("audios", id); if (!a) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="#/audio">${t("audio")}</a></div>
    <h1>${esc(a.title)}</h1><div class="meta">${esc(a.speaker || "")} · ${fmtDate(a.createdAt)} ${catTag(a.category)}</div>
    ${safeUrl(a.url) ? `<audio class="big" controls src="${safeUrl(a.url)}"></audio><a class="btn ghost sm" href="${safeUrl(a.url)}" download target="_blank" rel="noopener">${t("download")}</a>` : ""}
    ${a.desc ? `<div class="prose">${nl(a.desc)}</div>` : ""}<div class="actions">${delBtn("audios", a)}</div></article><section class="card" id="cm"></section>`;
  bindDel("audios", id, "#/audio");
  await comments($("#cm"), "audios", id);
}

// ---------- books ----------
const cover = b => safeUrl(b.cover) ? `<img src="${safeUrl(b.cover)}" alt="" loading="lazy">` : `<div class="nocover">${icon("books")}<span>${esc(b.title)}</span></div>`;
const bookItem = b => `<a class="book" href="#/books/${b.id}"><div class="cv">${cover(b)}</div><h3>${esc(b.title)}</h3><small>${esc(b.author || "")}</small></a>`;
async function listBooks() {
  const items = await latest("books", 300);
  listPage({ titleKey: "books", items, render: bookItem, cats: CATS.books, wrap: "bookgrid", action: isSheikh() ? { href: "#/new/book", label: "+ " + t("newBook") } : null });
}
async function viewBook(id) {
  const b = await getOne("books", id); if (!b) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  const u = safeUrl(b.url);
  main().innerHTML = `<article class="card article book-view"><div class="crumb"><a href="#/books">${t("books")}</a></div>
    <div class="bv"><div class="cv">${cover(b)}</div><div>
      <h1>${esc(b.title)}</h1><div class="meta">${esc(b.author || "")} ${catTag(b.category)}</div>
      ${b.desc ? `<div class="prose">${nl(b.desc)}</div>` : ""}
      ${u ? `<div class="hero-btns"><a class="btn" href="${u}" target="_blank" rel="noopener">${t("read")}</a><a class="btn ghost" href="${u}" download target="_blank" rel="noopener">${t("download")}</a></div>` : ""}
      <div class="actions">${delBtn("books", b)}</div></div></div></article><section class="card" id="cm"></section>`;
  bindDel("books", id, "#/books");
  await comments($("#cm"), "books", id);
}

// ---------- forum ----------
const threadItem = th => `<a class="item" href="#/forum/${th.id}"><h3>${esc(th.title)}</h3><p>${excerpt(th.body, 120)}</p>${meta(th.name, th.createdAt, " " + catTag(th.category))}</a>`;
async function listForum() {
  const items = await latest("threads", 300);
  listPage({ titleKey: "forum", items, render: threadItem, cats: CATS.threads, action: isBanned() ? null : { href: "#/new/thread", label: "+ " + t("newThread") } });
}
async function viewThread(id) {
  const th = await getOne("threads", id); if (!th) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="#/forum">${t("forum")}</a></div>
    <h1>${esc(th.title)}</h1><div class="author-row">${avatar(th.name, th.photo)}${meta(th.name, th.createdAt, " " + catTag(th.category))}</div>
    <div class="prose">${nl(th.body)}</div><div class="actions">${delBtn("threads", th)}</div></article><section class="card" id="cm"></section>`;
  bindDel("threads", id, "#/forum");
  await comments($("#cm"), "threads", id, "replies");
}

// ---------- fatwa ----------
const qName = q => q.showName === false ? t("anonymous") : q.name;
const fatwaItem = q => `<a class="item fatwa-item" href="#/fatwa/${q.id}"><span class="qmark">؟</span><div><h3>${esc(q.title || excerpt(q.body, 80))}</h3>
  <p>${excerpt(q.answer, 140)}</p>${meta(q.sheikhName ? t("answeredBy") + " " + q.sheikhName : "", q.answeredAt, " " + catTag(q.category))}</div></a>`;
async function listFatwa() {
  const items = await answeredFatwas();
  listPage({ titleKey: "fatwa", items, render: fatwaItem, cats: CATS.questions, action: { href: "#/ask", label: t("ask") } });
}
async function viewFatwa(id) {
  const q = await getOne("questions", id); if (!q) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  const done = q.status === "answered";
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="#/fatwa">${t("fatwa")}</a> ${catTag(q.category)}</div>
    <h1>${esc(q.title || t("question"))}</h1>
    <div class="qa q"><div class="qa-label">${t("question")}</div><div class="prose">${nl(q.body)}</div>${meta(qName(q), q.createdAt)}</div>
    ${done ? `<div class="qa a"><div class="qa-label">${t("answer")}</div><div class="prose">${nl(q.answer)}</div>
      <div class="meta">${t("answeredBy")} <b>${esc(q.sheikhName)}</b> · ${fmtDate(q.answeredAt)}</div></div>`
      : `<div class="status pending">${t("pending")}</div>`}
    ${isSheikh() ? `<details class="edit-ans"${done ? "" : " open"}><summary>${done ? t("editAnswer") : t("publishAnswer")}</summary>
      <form class="form" id="ansForm"><textarea name="answer" rows="8" required>${esc(q.answer || "")}</textarea><button class="btn">${t("publishAnswer")}</button></form></details>` : ""}
    <div class="actions">${user && (isAdmin() || (q.uid === user.uid && !done)) ? `<button class="btn ghost sm danger" id="delItem">${t("delete")}</button>` : ""}</div>
    </article>${done ? `<section class="card" id="cm"></section>` : ""}`;
  bindDel("questions", id, "#/fatwa");
  const af = $("#ansForm");
  if (af) af.onsubmit = async e => { e.preventDefault(); await answerQuestion(q, af.answer.value, q.title); viewFatwa(id); };
  if (done) await comments($("#cm"), "questions", id);
}
async function answerQuestion(q, answer, title) {
  answer = answer.trim(); if (!answer) return;
  const data = { answer, status: "answered", sheikhUid: user.uid, sheikhName: myName(), answeredAt: serverTimestamp() };
  if (title !== undefined) data.title = String(title).trim().slice(0, 200);
  try { await updateDoc(doc(db, "questions", q.id), data); toast(t("saved")); } catch (e) { toast(errMsg(e), true); throw e; }
}
function pageAsk() {
  if (!requireLogin()) return;
  if (isBanned()) return main().innerHTML = `<div class="empty">${t("bannedMsg")}</div>`;
  main().innerHTML = `<div class="card narrow"><h1>${t("ask")}</h1><p class="muted">${t("askNote")}</p>
    <form class="form" id="askForm">
      <label>${t("category")}<select name="category">${CATS.questions.map(c => `<option value="${c}">${t("cat_" + c)}</option>`).join("")}</select></label>
      <label>${t("qTitle")}<input name="title" required maxlength="200"></label>
      <label>${t("yourQuestion")}<textarea name="body" rows="8" required maxlength="5000"></textarea></label>
      <label class="check"><input type="checkbox" name="hide"> ${t("hideName")}</label>
      <button class="btn wide">${t("send")}</button></form></div>`;
  $("#askForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    e.target.querySelector("button").disabled = true;
    try {
      await addDoc(collection(db, "questions"), {
        title: f.title.trim(), body: f.body.trim(), category: f.category, uid: user.uid, name: myName(),
        showName: !f.hide, status: "pending", createdAt: serverTimestamp()
      });
      toast(t("askSent")); location.hash = "#/profile";
    } catch (err) { toast(errMsg(err), true); e.target.querySelector("button").disabled = false; }
  };
}

// ---------- add content ----------
const FORMS = {
  post: { coll: "posts", staff: true, title: "newPost", fields: [{ k: "title" }, { k: "body", type: "textarea", rows: 14 }] },
  audio: { coll: "audios", staff: true, title: "newAudio", fields: [{ k: "title" }, { k: "speaker" }, { k: "url", type: "url", label: "audioUrl" }, { k: "category", type: "select", opts: CATS.audios }, { k: "desc", type: "textarea", opt: true }] },
  book: { coll: "books", staff: true, title: "newBook", fields: [{ k: "title" }, { k: "author" }, { k: "url", type: "url", label: "pdfUrl" }, { k: "cover", type: "url", opt: true }, { k: "category", type: "select", opts: CATS.books }, { k: "desc", type: "textarea", opt: true }] },
  thread: { coll: "threads", staff: false, title: "newThread", fields: [{ k: "title" }, { k: "category", type: "select", opts: CATS.threads }, { k: "body", type: "textarea", rows: 10 }] }
};
async function pageNew(type, editId) {
  const F = FORMS[type]; if (!F) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  if (!requireLogin()) return;
  if (isBanned()) return main().innerHTML = `<div class="empty">${t("bannedMsg")}</div>`;
  if (F.staff && !isSheikh()) return denied();
  let item = null;
  if (editId) {
    item = await getOne(F.coll, editId);
    if (!item) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
    if (!F.staff && !isAdmin() && item.uid !== user.uid) return denied();
  }
  const v = k => esc(item?.[k] ?? "");
  const field = f => {
    const lbl = `${t(f.label || f.k)}${f.opt ? ` <small>(${t("optional")})</small>` : ""}`, req = f.opt ? "" : "required";
    if (f.type === "textarea") return `<label>${lbl}<textarea name="${f.k}" rows="${f.rows || 5}" ${req}>${v(f.k)}</textarea></label>`;
    if (f.type === "select") return `<label>${lbl}<select name="${f.k}">${f.opts.map(o => `<option value="${o}"${item?.[f.k] === o ? " selected" : ""}>${t("cat_" + o)}</option>`).join("")}</select></label>`;
    return `<label>${lbl}<input name="${f.k}" value="${v(f.k)}" type="${f.type || "text"}" ${req} ${f.type === "url" ? 'dir="ltr" placeholder="https://"' : 'maxlength="200"'}></label>`;
  };
  main().innerHTML = `<div class="card narrow"><h1>${item ? t("edit") + ": " + esc(item.title) : t(F.title)}</h1><form class="form" id="newForm">${F.fields.map(field).join("")}<button class="btn wide">${t("save")}</button></form></div>`;
  $("#newForm").onsubmit = async e => {
    e.preventDefault();
    const data = {};
    F.fields.forEach(f => data[f.k] = String(new FormData(e.target).get(f.k) || "").trim());
    e.target.querySelector("button").disabled = true;
    try {
      if (item) {
        await updateDoc(doc(db, F.coll, editId), { ...data, updatedAt: serverTimestamp() });
        toast(t("saved")); location.hash = `#/${ROUTE_OF[F.coll]}/${editId}`;
      } else {
        Object.assign(data, { uid: user.uid, name: myName(), photo: user.photoURL || "", createdAt: serverTimestamp() });
        const r = await addDoc(collection(db, F.coll), data); location.hash = `#/${ROUTE_OF[F.coll]}/${r.id}`;
      }
    } catch (err) { toast(errMsg(err), true); e.target.querySelector("button").disabled = false; }
  };
}

// ---------- static pages ----------
function pageStatic(key) {
  const P = PAGES[key][lang] || PAGES[key].ar;
  document.title = P.title + " | " + siteName();
  main().innerHTML = `<article class="card narrow article static"><h1>${P.title}</h1><div class="prose">${P.html}</div></article>`;
}
function pageContact() {
  main().innerHTML = `<div class="card narrow"><h1>${t("contactUs")}</h1><p class="muted">${t("contactNote")}</p>
    <form class="form" id="ctForm">
      <label>${t("name")}<input name="name" required maxlength="80" value="${esc(user ? myName() : "")}"></label>
      <label>${t("email")}<input name="email" type="email" required maxlength="120" dir="ltr" value="${esc(user?.email || "")}"></label>
      <label>${t("subject")}<select name="subject">${["general", "suggestion", "problem", "deleteAccount", "joinSheikh"].map(k => `<option value="${k}">${t("subj_" + k)}</option>`).join("")}</select></label>
      <label>${t("message")}<textarea name="text" rows="7" required maxlength="3000"></textarea></label>
      <button class="btn wide">${t("send")}</button></form></div>`;
  $("#ctForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), btn = $("button", e.target); btn.disabled = true;
    try {
      await addDoc(collection(db, "messages"), { name: f.name.trim(), email: f.email.trim(), subject: f.subject, text: f.text.trim(), uid: user?.uid || "", createdAt: serverTimestamp() });
      main().innerHTML = `<div class="card narrow"><h1>${t("contactUs")}</h1><p>${t("msgSent")}</p><a class="btn" href="#/">${t("home")}</a></div>`;
    } catch (err) { toast(errMsg(err), true); btn.disabled = false; }
  };
}

// ---------- profile ----------
async function pageProfile() {
  if (!requireLogin()) return;
  const s = await getDocs(query(collection(db, "questions"), where("uid", "==", user.uid), limit(200)));
  const qs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const r = isAdmin() ? "admin" : role();
  main().innerHTML = `<div class="card narrow profile">
      <div class="author-row">${avatar(myName(), user.photoURL, 56)}<div><h1>${esc(myName())}</h1><div class="meta" dir="ltr">${esc(user.email || "")}</div>
      <span class="badge ${r}">${t("role_" + r)}</span></div></div>
      <form class="form inline" id="nameForm"><label>${t("name")}<input name="name" value="${esc(myName())}" required maxlength="60"></label><button class="btn sm">${t("save")}</button></form>
      <button class="btn ghost sm danger" id="outBtn">${t("logout")}</button>
    </div>
    <div class="card narrow"><div class="page-head"><h2>${t("myQuestions")}</h2><a class="btn sm" href="#/ask">${t("ask")}</a></div>
      ${qs.length ? `<div class="list">${qs.map(q => `<a class="item row" href="#/fatwa/${q.id}"><h3>${esc(q.title || excerpt(q.body, 80))}</h3>
        <span class="status ${q.status}">${t(q.status)}</span></a>`).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`}</div>`;
  $("#outBtn").onclick = async () => { await signOut(auth); location.hash = "#/"; };
  $("#nameForm").onsubmit = async e => {
    e.preventDefault(); const name = e.target.name.value.trim();
    try {
      await updateDoc(doc(db, "users", user.uid), { name }); await updateProfile(user, { displayName: name });
      profile = { ...profile, name }; renderShell(); toast(t("saved")); pageProfile();
    } catch (err) { toast(errMsg(err), true); }
  };
}

// ---------- sheikh panel ----------
async function pagePanel() {
  if (!requireLogin()) return; if (!isSheikh()) return denied();
  const s = await getDocs(query(collection(db, "questions"), where("status", "==", "pending"), limit(300)));
  const qs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  main().innerHTML = `
    <div class="page-head"><h1>${t("panel")}</h1></div>
    <div class="card"><h2>${t("addContent")}</h2><div class="hero-btns">
      <a class="btn ghost" href="#/new/post">+ ${t("newPost")}</a><a class="btn ghost" href="#/new/audio">+ ${t("newAudio")}</a><a class="btn ghost" href="#/new/book">+ ${t("newBook")}</a></div></div>
    <h2 class="sub">${t("pendingQuestions")} (${qs.length})</h2>
    ${qs.length ? qs.map(q => `<div class="card pq" data-id="${q.id}">
      <div class="meta">${esc(q.name)}${q.showName === false ? ` (${t("hideName")})` : ""} · ${fmtDate(q.createdAt)} ${catTag(q.category)}</div>
      <form class="form"><label>${t("title")}<input name="title" value="${esc(q.title || "")}" maxlength="200"></label>
      <div class="qa q"><div class="prose">${nl(q.body)}</div></div>
      <textarea name="answer" rows="6" required placeholder="${t("writeAnswer")}"></textarea>
      <div class="row-btns"><button class="btn">${t("publishAnswer")}</button>
      ${isAdmin() ? `<button type="button" class="btn ghost sm danger" data-del>${t("delete")}</button>` : ""}</div></form></div>`).join("")
      : `<div class="empty">${t("noPending")}</div>`}`;
  $$(".pq").forEach(card => {
    const q = qs.find(x => x.id === card.dataset.id), f = $("form", card);
    f.onsubmit = async e => { e.preventDefault(); $("button", f).disabled = true;
      try { await answerQuestion(q, f.answer.value, f.title.value); card.remove(); } catch { $("button", f).disabled = false; } };
    const d = $("[data-del]", card);
    if (d) d.onclick = async () => { if (!confirm(t("confirmDelete"))) return;
      try { await deleteDoc(doc(db, "questions", q.id)); card.remove(); } catch (e) { toast(errMsg(e), true); } };
  });
}

// ---------- admin ----------
async function loadInbox() {
  const box = $("#inbox"); if (!box) return;
  const msgs = await latest("messages", 200);
  box.innerHTML = msgs.length ? msgs.map(m => `<div class="item msg"><div class="cmeta"><b>${esc(m.name)}</b><span dir="ltr">${esc(m.email)}</span><span class="tag">${t("subj_" + m.subject)}</span><span>${fmtDate(m.createdAt)}</span>
    <button class="link danger" data-mdel="${m.id}">${t("delete")}</button></div><div class="ctext">${nl(m.text)}</div></div>`).join("") : `<div class="empty sm">${t("empty")}</div>`;
  $$("[data-mdel]", box).forEach(b => b.onclick = async () => {
    if (!confirm(t("confirmDelete"))) return;
    try { await deleteDoc(doc(db, "messages", b.dataset.mdel)); loadInbox(); } catch (e) { toast(errMsg(e), true); }
  });
}
async function pageAdmin() {
  if (!requireLogin()) return; if (!isAdmin()) return denied();
  const users = await latest("users", 500);
  main().innerHTML = `<div class="page-head"><h1>${t("admin")} — ${t("users")} (${users.length})</h1></div>
    <div class="toolbar"><input class="search" type="search" placeholder="${t("searchUsers")}"></div>
    <div class="card"><table class="tbl"><tbody id="urows"></tbody></table></div>
    <h2 class="sub">${t("inbox")}</h2><div id="inbox" class="list"></div>`;
  loadInbox();
  const draw = q => {
    const effRole = u => ADMIN_EMAILS.map(e => e.toLowerCase()).includes((u.email || "").toLowerCase()) ? "admin" : (u.role || "user");
    $("#urows").innerHTML = users.filter(u => !q || (u.name + " " + u.email).toLowerCase().includes(q)).map(u => {
      const r = effRole(u), me = u.id === user.uid, owner = r === "admin" && u.role !== "admin";
      return `<tr><td><div class="author-row">${avatar(u.name, u.photo)}<div><b>${esc(u.name)}</b> <span class="badge ${r}">${t("role_" + r)}</span>${me ? ` <small class="muted">(${t("you")})</small>` : ""}
        <div class="meta" dir="ltr">${esc(u.email)}</div></div></div></td>
      <td>${me || owner ? "" : `<select data-uid="${u.id}">${["user", "sheikh", "admin", "banned"].map(x => `<option value="${x}"${r === x ? " selected" : ""}>${t("role_" + x)}</option>`).join("")}</select>`}</td></tr>`;
    }).join("");
    $$("#urows select").forEach(s => s.onchange = async () => {
      try { await updateDoc(doc(db, "users", s.dataset.uid), { role: s.value }); users.find(u => u.id === s.dataset.uid).role = s.value; toast(t("saved")); draw($(".search").value.trim().toLowerCase()); }
      catch (e) { toast(errMsg(e), true); }
    });
  };
  $(".search").oninput = e => draw(e.target.value.trim().toLowerCase());
  draw("");
}

renderShell();
route();
