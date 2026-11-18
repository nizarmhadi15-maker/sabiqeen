import { firebaseConfig, SITE, ADMIN_EMAILS, UPLOAD } from "./config.js";
import { I18N } from "./i18n.js";
import { PAGES } from "./pages.js";
import { DEFAULT_WORDS, findBad, hasLink, buildPattern, HIDE_AFTER_REPORTS, COOLDOWN_SEC, isDisposable, nameKey } from "./moderation.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
  updateProfile, signOut, sendEmailVerification, reload
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, arrayUnion, writeBatch, increment, getCountFromServer,
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

// ---------- auto moderation ----------
let MOD_WORDS = DEFAULT_WORDS;
getDoc(doc(db, "settings", "moderation")).then(s => { if (s.exists() && Array.isArray(s.data().words)) MOD_WORDS = s.data().words; }).catch(() => {});
const needsVerify = () => !!user && !user.emailVerified && !isAdmin();
function checkContent(...texts) {
  if (needsVerify()) return t("verifyFirst");
  const all = texts.join(" \n ");
  if (findBad(all, MOD_WORDS)) return t("badWords");
  if (!isSheikh() && hasLink(all)) return t("noLinks");
  if (!isSheikh()) {
    let last = 0; try { last = +localStorage.getItem("lastPost") || 0; } catch {}
    const wait = Math.ceil(COOLDOWN_SEC - (Date.now() - last) / 1000);
    if (wait > 0) return t("slowDown").replace("{s}", wait);
  }
  return null;
}
const markPosted = () => { try { localStorage.setItem("lastPost", Date.now()); } catch {} };

// ---------- analytics (privacy-friendly, no external services) ----------
const TZ_CC = {
  "Asia/Gaza": "PS", "Asia/Hebron": "PS", "Asia/Jerusalem": "JRS", "Asia/Amman": "JO", "Africa/Cairo": "EG", "Asia/Riyadh": "SA",
  "Asia/Dubai": "AE", "Asia/Qatar": "QA", "Asia/Kuwait": "KW", "Asia/Bahrain": "BH", "Asia/Muscat": "OM", "Asia/Aden": "YE",
  "Asia/Baghdad": "IQ", "Asia/Damascus": "SY", "Asia/Beirut": "LB", "Africa/Tripoli": "LY", "Africa/Tunis": "TN", "Africa/Algiers": "DZ",
  "Africa/Casablanca": "MA", "Africa/Khartoum": "SD", "Africa/Nouakchott": "MR", "Africa/Mogadishu": "SO", "Africa/Djibouti": "DJ",
  "Europe/Istanbul": "TR", "Asia/Tehran": "IR", "Asia/Karachi": "PK", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Dhaka": "BD",
  "Asia/Jakarta": "ID", "Asia/Kuala_Lumpur": "MY", "Asia/Singapore": "SG", "Asia/Kabul": "AF", "Asia/Tashkent": "UZ",
  "Europe/London": "GB", "Europe/Paris": "FR", "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE", "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Europe/Vienna": "AT", "Europe/Zurich": "CH",
  "Europe/Moscow": "RU", "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Sao_Paulo": "BR", "America/Mexico_City": "MX", "Australia/Sydney": "AU", "Australia/Melbourne": "AU",
  "Africa/Lagos": "NG", "Africa/Nairobi": "KE", "Africa/Johannesburg": "ZA", "Africa/Dakar": "SN", "Asia/Tokyo": "JP", "Asia/Shanghai": "CN"
};
const todayId = (d = new Date()) => d.toISOString().slice(0, 10);
function bump(field) { try { setDoc(doc(db, "stats", todayId()), { [field]: increment(1) }, { merge: true }).catch(() => {}); } catch {} }
function trackView(page) {
  try {
    const day = todayId(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "", cc = TZ_CC[tz] || "XX";
    let isNew = false; try { if (localStorage.getItem("seen") !== day) { localStorage.setItem("seen", day); isNew = true; } } catch {}
    const dev = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
    const data = { views: increment(1), pages: { [page || "home"]: increment(1) } };
    if (isNew) Object.assign(data, { visitors: increment(1), countries: { [cc]: increment(1) }, devices: { [dev]: increment(1) } });
    setDoc(doc(db, "stats", day), data, { merge: true }).catch(() => {});
  } catch {}
}
const isHidden = x => (x.reporters || []).length >= HIDE_AFTER_REPORTS;
async function report(path, item, routeHash) {
  if (!requireLogin()) return false;
  try {
    await updateDoc(doc(db, path), { reporters: arrayUnion(user.uid) });
    const n = new Set([...(item.reporters || []), user.uid]).size;
    if (n >= HIDE_AFTER_REPORTS && (item.reporters || []).length < HIDE_AFTER_REPORTS)
      await addDoc(collection(db, "flags"), { path, route: routeHash, text: String(item.text || item.body || "").slice(0, 500), title: item.title || "", name: item.name || "", uid: user.uid, createdAt: serverTimestamp() });
    toast(t("reportThanks")); return true;
  } catch (e) { toast(errMsg(e), true); return false; }
}
const myName = () => profile?.name || user?.displayName || (user?.email || "").split("@")[0];
const siteName = () => SITE.name[lang] || SITE.name.ar;

const CATS = {
  questions: ["ibadat", "muamalat", "family", "aqeedah", "other"],
  threads: ["general", "quran", "hadith", "fiqh", "seerah", "other"],
  audios: ["quran", "lectures", "khutab", "lessons"],
  videos: ["lectures", "khutab", "lessons", "quran"],
  books: ["quran_sci", "hadith", "fiqh", "aqeedah", "seerah", "other"]
};
const ROUTE_OF = { posts: "posts", audios: "audio", videos: "videos", books: "books", threads: "forum", questions: "fatwa" };

const ICON = {
  posts: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  donate: '<path d="M12 21s-7-4.4-9.3-9A5.2 5.2 0 0 1 12 6.3 5.2 5.2 0 0 1 21.3 12C19 16.6 12 21 12 21z"/>',
  videos: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  audio: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
  books: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 7h6"/>',
  forum: '<path d="M4 5h12v9H8l-4 3z"/><path d="M16 9h4v9l-3-2h-7v-2"/>',
  fatwa: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>'
};
const icon = (k, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

const myPhoto = () => (profile && "photo" in profile ? profile.photo : user?.photoURL) || "";
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
  sessionStorage.setItem("after", location.pathname);
  go("/login");
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
  $("#footer").innerHTML = `<b>${esc(siteName())}</b> — ${esc(SITE.tagline[lang])}<nav class="foot-links"><a href="/about">${t("aboutUs")}</a><a href="/donate">${t("donate")}</a><a href="/contact">${t("contactUs")}</a><a href="/terms">${t("terms")}</a><a href="/privacy">${t("privacy")}</a></nav><small>© ${new Date().getFullYear()} ${t("footer")}</small>`;
  const links = [["home", "/"], ["posts", "/posts"], ["audio", "/audio"], ["videos", "/videos"], ["books", "/books"], ["forum", "/forum"], ["fatwa", "/fatwa"]];
  $("#nav").innerHTML = links.map(([k, h]) => `<a href="${h}" data-k="${k}">${t(k)}</a>`).join("") +
    `<a href="/ask" class="nav-ask">${t("ask")}</a>` + `<a href="/donate" class="nav-donate" data-k="donate">${t("donate")}</a>` +
    (user && isSheikh() ? `<a href="/panel" class="nav-staff" data-k="panel">${t("panel")}</a>` : "") +
    (user && isAdmin() ? `<a href="/admin" class="nav-staff" data-k="admin">${t("admin")}</a><a href="/stats" class="nav-staff" data-k="stats">${t("stats")}</a>` : "");
  $("#langBtn").textContent = lang === "ar" ? "EN" : "ع";
  $("#userbox").innerHTML = !authReady ? "" : user
    ? `${isSheikh() ? `<a class="btn ghost sm" href="/panel">${t("panel")}</a>` : ""}${isAdmin() ? `<a class="btn ghost sm" href="/admin">${t("admin")}</a>` : ""}
       <a class="me" href="/profile" title="${esc(myName())}">${avatar(myName(), myPhoto())}</a>`
    : `<a class="btn sm" href="/login">${t("login")}</a>`;
}
$("#langBtn").onclick = () => { lang = lang === "ar" ? "en" : "ar"; localStorage.setItem("lang", lang); renderShell(); route(); };
$("#menuBtn").onclick = () => document.body.classList.toggle("nav-open");
document.addEventListener("play", e => $$("audio").forEach(a => a !== e.target && a.pause()), true);

// ---------- router ----------
let routeId = 0;
async function route() {
  const my = ++routeId;
  document.body.classList.remove("nav-open");
  const [p, id, extra] = location.pathname.replace(/\/index\.html$/, "").split("/").filter(Boolean).map(decodeURIComponent);
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.k === (p || "home") || (p === "fatwa" && a.dataset.k === "fatwa")));
  main().innerHTML = `<div class="loading"><span class="spin"></span>${t("loading")}</div>`;
  window.scrollTo(0, 0);
  if (!authReady) return;
  if (!isAdmin()) trackView(p);
  try {
    const r = await (async () => {
      switch (p) {
        case undefined: case "home": return pageHome();
        case "posts": return id ? viewPost(id) : listPosts();
        case "audio": return id ? viewAudio(id) : listAudio();
        case "videos": return id ? viewVideo(id) : listVideos();
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
        case "donate": return pageDonate();
        case "stats": return pageStats();
        default: main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
      }
    })();
    if (my === routeId) setPageMeta(p);
    return r;
  } catch (e) {
    console.error(e);
    if (my === routeId) main().innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
  }
}
// روابط عادية بدون # (مناسبة لمحركات البحث)
function go(h) {
  h = String(h || "/").replace(/^#/, "") || "/";
  if (h !== location.pathname + location.search) history.pushState(null, "", h);
  route();
}
window.addEventListener("popstate", route);
// الروابط القديمة التي فيها / تتحوّل تلقائياً
function fromHash() { if (location.hash.startsWith("#/")) { history.replaceState(null, "", location.hash.slice(1) || "/"); return true; } return false; }
fromHash();
window.addEventListener("hashchange", () => { if (fromHash()) route(); });
document.addEventListener("click", e => {
  const a = e.target.closest("a[href]"); if (!a) return;
  const h = a.getAttribute("href");
  if (!h.startsWith("/") || h.startsWith("//") || a.target || a.hasAttribute("download") || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  e.preventDefault(); go(h);
});
// عنوان الصفحة ووصفها حسب المحتوى المعروض
function setPageMeta(p) {
  const h = $("#app h1"), name = siteName();
  document.title = p && h ? `${h.textContent.trim()} | ${name}` : name;
  const d = ($("#app .prose") || {}).textContent;
  const m = document.querySelector('meta[name="description"]');
  if (m && d) m.content = d.trim().replace(/\s+/g, " ").slice(0, 160);
  const c = document.querySelector('link[rel="canonical"]');
  if (c) c.href = location.origin + (location.pathname.endsWith("/") ? location.pathname : location.pathname + "/");
}

// ---------- auth ----------
// أسماء فريدة: كل اسم محجوز في usernames/{مفتاح الاسم}
async function nameOwner(name) { const s = await getDoc(doc(db, "usernames", nameKey(name))); return s.exists() ? s.data().uid : null; }
async function freeName(base, uid) {
  base = (base || "").trim() || "عضو";
  for (let i = 1; i <= 50; i++) {
    const n = i === 1 ? base : `${base} ${i}`, o = await nameOwner(n);
    if (!o || o === uid) return n;
  }
  return `${base} ${Date.now() % 100000}`;
}
// إنشاء ملف المستخدم مع حجز الاسم في عملية واحدة
async function createProfile(u, name) {
  const b = writeBatch(db), key = nameKey(name);
  b.set(doc(db, "usernames", key), { uid: u.uid });
  b.set(doc(db, "users", u.uid), { name, nameKey: key, email: u.email || "", photo: u.photoURL || "", role: "user", createdAt: serverTimestamp() });
  await b.commit(); bump("signups");
}
// تغيير الاسم: حجز الجديد وتحرير القديم
async function changeName(newName) {
  const key = nameKey(newName), old = profile?.nameKey, b = writeBatch(db);
  if (key !== old) {
    b.set(doc(db, "usernames", key), { uid: user.uid });
    if (old) b.delete(doc(db, "usernames", old));
  }
  b.update(doc(db, "users", user.uid), { name: newName, nameKey: key });
  await b.commit();
}
onAuthStateChanged(auth, async u => {
  user = u; profile = null;
  if (u) {
    try {
      const ref = doc(db, "users", u.uid);
      let s = await getDoc(ref);
      if (!s.exists()) {
        if (isDisposable(u.email)) { toast(t("tempEmail"), true); await signOut(auth); return; }
        await createProfile(u, await freeName(u.displayName || (u.email || "").split("@")[0], u.uid));
        s = await getDoc(ref);
      }
      profile = s.data();
      // الحسابات القديمة: حجز أسمائها تلقائياً
      if (!profile.nameKey) {
        try { const o = await nameOwner(profile.name); if (!o || o === u.uid) { profile = { ...profile }; await changeName(profile.name); profile.nameKey = nameKey(profile.name); } } catch (e) { console.warn(e); }
      }
    } catch (e) { console.error(e); }
  }
  authReady = true;
  renderShell();
  route();
});

function afterLogin() {
  const to = sessionStorage.getItem("after"); sessionStorage.removeItem("after");
  go(to && !to.includes("login") ? to : "/");
}

const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="M3 3l18 18"/></svg>';
const pwField = (n, lbl, ac) => `<label>${lbl}<span class="pw-wrap"><input name="${n}" type="password" required minlength="6" autocomplete="${ac}" dir="ltr"><button type="button" class="pw-eye" title="${t("showPw")}" aria-label="${t("showPw")}">${EYE}</button></span></label>`;
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
        ${mode !== "reset" ? pwField("pw", t("password"), mode === "register" ? "new-password" : "current-password") : ""}
        ${mode === "register" ? pwField("pw2", t("pwConfirm"), "new-password") : ""}
        <button class="btn wide">${mode === "reset" ? t("sendReset") : mode === "register" ? t("createAccount") : t("login")}</button>
      </form>
      <div class="auth-links">
        ${mode === "login" ? `<a href="#" data-m="reset">${t("forgot")}</a><a href="#" data-m="register">${t("register")}</a>`
        : `<a href="#" data-m="login">${t("backToLogin")}</a>`}
      </div>
    </div>`;
    $$(".pw-eye").forEach(b => b.onclick = () => { const i = b.previousElementSibling, show = i.type === "password"; i.type = show ? "text" : "password"; b.classList.toggle("on", show); });
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
          const name = f.name.trim();
          if (f.pw !== f.pw2) { toast(t("pwMismatch"), true); btn.disabled = false; return; }
          if (findBad(name, MOD_WORDS)) { toast(t("badWords"), true); btn.disabled = false; return; }
          if (nameKey(name).length < 2) { toast(t("nameShort"), true); btn.disabled = false; return; }
          if (isDisposable(f.email)) { toast(t("tempEmail"), true); btn.disabled = false; return; }
          if (await nameOwner(name)) { toast(t("nameTaken"), true); btn.disabled = false; return; }
          const cred = await createUserWithEmailAndPassword(auth, f.email.trim(), f.pw);
          await updateProfile(cred.user, { displayName: name });
          try { await createProfile(cred.user, name); }
          catch (err) { await createProfile(cred.user, await freeName(name, cred.user.uid)); }
          const ps = await getDoc(doc(db, "users", cred.user.uid)); profile = ps.data();
          try { await sendEmailVerification(cred.user); } catch {}
          toast(t("verifySent"));
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
    ${isBanned() ? `<p class="login-hint">${t("bannedMsg")}</p>` : user ? `<form class="cform">${avatar(myName(), myPhoto())}<textarea required maxlength="3000" placeholder="${t(kind === "replies" ? "writeReply" : "writeComment")}"></textarea><button class="btn sm">${t("send")}</button></form>`
      : `<a class="login-hint" href="/login" onclick="sessionStorage.setItem('after',location.pathname)">${t("loginToComment")}</a>`}`;
  const load = async () => {
    const s = await getDocs(query(col, orderBy("createdAt", "asc"), limit(500)));
    const list = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => isAdmin() || !isHidden(c));
    $(".count", el).textContent = list.length ? `(${list.length})` : "";
    $(".clist", el).innerHTML = list.length ? list.map(c => `
      <div class="comment${c.badge ? " is-sheikh" : ""}${isHidden(c) ? " hidden-c" : ""}">
        ${avatar(c.name, c.photo)}
        <div class="cbody">
          <div class="cmeta"><b>${esc(c.name)}</b>${sheikhBadge(c.badge)}<span>${fmtDate(c.createdAt)}</span>
            ${isHidden(c) ? `<span class="tag bad">${t("hiddenByReports")}</span><button class="link" data-restore="${c.id}">${t("restore")}</button>` : ""}
            ${user && c.uid !== user.uid && !(c.reporters || []).includes(user.uid) && !isBanned() ? `<button class="link muted" data-rep="${c.id}">${t("report")}</button>` : ""}
            ${user && (c.uid === user.uid || isAdmin()) ? `<button class="link danger" data-del="${c.id}">${t("delete")}</button>` : ""}</div>
          <div class="ctext">${nl(c.text)}</div>
        </div>
      </div>`).join("") : `<p class="muted">${t("noComments")}</p>`;
    $$("[data-del]", el).forEach(b => b.onclick = async () => {
      if (!confirm(t("confirmDelete"))) return;
      try { await deleteDoc(doc(col, b.dataset.del)); load(); } catch (e) { toast(errMsg(e), true); }
    });
    $$("[data-rep]", el).forEach(b => b.onclick = async () => {
      if (!confirm(t("confirmReport"))) return;
      const c = list.find(x => x.id === b.dataset.rep);
      if (await report(`${coll}/${id}/comments/${c.id}`, c, `/${ROUTE_OF[coll]}/${id}`)) load();
    });
    $$("[data-restore]", el).forEach(b => b.onclick = async () => {
      try { await updateDoc(doc(col, b.dataset.restore), { reporters: [] }); load(); } catch (e) { toast(errMsg(e), true); }
    });
  };
  const f = $(".cform", el);
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const ta = $("textarea", f), text = ta.value.trim(); if (!text) return;
    const bad = checkContent(text); if (bad) return toast(bad, true);
    const btn = $("button", f); btn.disabled = true;
    try {
      const data = { text, uid: user.uid, name: myName(), photo: myPhoto(), createdAt: serverTimestamp() };
      if (isSheikh()) data.badge = "sheikh";
      await addDoc(col, data); markPosted(); bump("comments"); ta.value = ""; await load();
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

const TYPE_OF = { posts: "post", audios: "audio", videos: "video", books: "book", threads: "thread" };
function delBtn(coll, item) {
  const can = user && !isBanned() && (isAdmin() || (coll !== "threads" ? isSheikh() : item.uid === user.uid));
  return can ? `<a class="btn ghost sm" href="/edit/${TYPE_OF[coll]}/${item.id}">${t("edit")}</a><button class="btn ghost sm danger" id="delItem">${t("delete")}</button>` : "";
}
function bindDel(coll, id, back) {
  const b = $("#delItem"); if (!b) return;
  b.onclick = async () => {
    if (!confirm(t("confirmDelete"))) return;
    try { await deleteDoc(doc(db, coll, id)); go(back); } catch (e) { toast(errMsg(e), true); }
  };
}

// ---------- home ----------
async function pageHome() {
  const [posts, audios, books, fats, threads, videos] = await Promise.all([
    latest("posts", 3), latest("audios", 4), latest("books", 6), answeredFatwas(4), latest("threads", 4), latest("videos", 4)]);
  const secs = [["posts", "/posts", "secPosts"], ["audio", "/audio", "secAudio"], ["videos", "/videos", "secVideos"], ["books", "/books", "secBooks"], ["forum", "/forum", "secForum"], ["fatwa", "/fatwa", "secFatwa"]];
  const block = (key, href, html) => `<section class="block"><div class="block-head"><h2>${t(key)}</h2><a href="${href}">${t("viewAll")} ←</a></div>${html}</section>`;
  main().innerHTML = `
    <section class="hero">
      <div class="hero-in">
        <p class="eyebrow">${esc(siteName())}</p>
        <h1>${t("heroTitle")}</h1>
        <p>${t("heroSub")}</p>
        <div class="hero-btns"><a class="btn gold" href="/ask">${t("ask")}</a><a class="btn ghost light" href="/fatwa">${t("browseFatwas")}</a></div>
      </div>
    </section>
    <div class="secs">${secs.map(([k, h, d]) => `<a class="sec" href="${h}">${icon(k)}<b>${t(k)}</b><small>${t(d)}</small></a>`).join("")}</div>
    <div class="home-grid">
      <div>
        ${block("latestFatwas", "/fatwa", fats.length ? `<div class="list">${fats.map(fatwaItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
        ${block("latestPosts", "/posts", posts.length ? `<div class="list">${posts.map(postItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
      </div>
      <div>
        ${block("latestAudio", "/audio", audios.length ? `<div class="list">${audios.map(audioItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
        ${block("latestThreads", "/forum", threads.length ? `<div class="list">${threads.map(threadItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
      </div>
    </div>
    ${block("latestVideos", "/videos", videos.length ? `<div class="videogrid">${videos.map(videoItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
    ${block("latestBooks", "/books", books.length ? `<div class="bookgrid">${books.map(bookItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}`;
}

// ---------- posts ----------
const postItem = p => `<a class="item" href="/posts/${p.id}"><h3>${esc(p.title)}</h3><p>${excerpt(p.body)}</p>${meta(p.name, p.createdAt)}</a>`;
async function listPosts() {
  const items = await latest("posts", 200);
  listPage({ titleKey: "posts", items, render: postItem, action: isSheikh() ? { href: "/new/post", label: "+ " + t("newPost") } : null });
}
async function viewPost(id) {
  const p = await getOne("posts", id); if (!p) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="/posts">${t("posts")}</a></div>
    <h1>${esc(p.title)}</h1>${meta(p.name, p.createdAt)}<div class="prose">${nl(p.body)}</div>
    <div class="actions">${delBtn("posts", p)}</div></article><section class="card" id="cm"></section>`;
  bindDel("posts", id, "/posts");
  await comments($("#cm"), "posts", id);
}

// ---------- audio ----------
const audioItem = a => `<div class="item audio-item"><div class="ai-head">${icon("audio", "ic sm")}<div><a href="/audio/${a.id}"><h3>${esc(a.title)}</h3></a>
  <div class="meta">${esc(a.speaker || "")} ${catTag(a.category)}</div></div></div>${safeUrl(a.url) ? `<audio controls preload="none" src="${safeUrl(a.url)}"></audio>` : ""}</div>`;
async function listAudio() {
  const items = await latest("audios", 300);
  listPage({ titleKey: "audio", items, render: audioItem, cats: CATS.audios, action: isSheikh() ? { href: "/new/audio", label: "+ " + t("newAudio") } : null });
}
async function viewAudio(id) {
  const a = await getOne("audios", id); if (!a) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="/audio">${t("audio")}</a></div>
    <h1>${esc(a.title)}</h1><div class="meta">${esc(a.speaker || "")} · ${fmtDate(a.createdAt)} ${catTag(a.category)}</div>
    ${safeUrl(a.url) ? `<audio class="big" controls src="${safeUrl(a.url)}"></audio><a class="btn ghost sm" href="${safeUrl(a.url)}" download target="_blank" rel="noopener">${t("download")}</a>` : ""}
    ${a.desc ? `<div class="prose">${nl(a.desc)}</div>` : ""}<div class="actions">${delBtn("audios", a)}</div></article><section class="card" id="cm"></section>`;
  bindDel("audios", id, "/audio");
  await comments($("#cm"), "audios", id);
}

// ---------- videos ----------
function ytId(u) {
  const m = String(u || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : "";
}
const isDirectVideo = u => /res\.cloudinary\.com\/.+\/video\/upload\//.test(u || "") || /\.(mp4|webm|m4v|mov|ogv)(\?.*)?$/i.test(u || "");
const cloudThumb = u => /res\.cloudinary\.com\/.+\/video\/upload\//.test(u || "") ? u.replace("/video/upload/", "/video/upload/so_2,w_480,c_fill,h_270/").replace(/\.[a-z0-9]+(\?.*)?$/i, ".jpg") : "";
const videoItem = v => {
  const y = ytId(v.url), ct = cloudThumb(v.url);
  return `<a class="vcard" href="/videos/${v.id}"><div class="vthumb">${y ? `<img src="https://i.ytimg.com/vi/${y}/hqdefault.jpg" alt="" loading="lazy">` : ct ? `<img src="${esc(ct)}" alt="" loading="lazy">` : icon("videos")}<span class="play">▶</span></div>
    <h3>${esc(v.title)}</h3><small>${esc(v.speaker || "")} ${catTag(v.category)}</small></a>`;
};
async function listVideos() {
  const items = await latest("videos", 300);
  listPage({ titleKey: "videos", items, render: videoItem, cats: CATS.videos, wrap: "videogrid", action: isSheikh() ? { href: "/new/video", label: "+ " + t("newVideo") } : null });
}
async function viewVideo(id) {
  const v = await getOne("videos", id); if (!v) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  const y = ytId(v.url), u = safeUrl(v.url);
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="/videos">${t("videos")}</a></div>
    <h1>${esc(v.title)}</h1><div class="meta">${esc(v.speaker || "")} · ${fmtDate(v.createdAt)} ${catTag(v.category)}</div>
    ${y ? `<div class="vframe"><iframe src="https://www.youtube-nocookie.com/embed/${y}" title="${esc(v.title)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`
      : u && isDirectVideo(v.url) ? `<div class="vframe"><video controls preload="metadata" playsinline src="${u}"${cloudThumb(v.url) ? ` poster="${esc(cloudThumb(v.url))}"` : ""}></video></div>`
      : u ? `<a class="btn" href="${u}" target="_blank" rel="noopener">${t("watch")}</a>` : ""}
    ${v.desc ? `<div class="prose">${nl(v.desc)}</div>` : ""}<div class="actions">${delBtn("videos", v)}</div></article><section class="card" id="cm"></section>`;
  bindDel("videos", id, "/videos");
  await comments($("#cm"), "videos", id);
}

// ---------- books ----------
const cover = b => safeUrl(b.cover) ? `<img src="${safeUrl(b.cover)}" alt="" loading="lazy">` : `<div class="nocover">${icon("books")}<span>${esc(b.title)}</span></div>`;
const bookItem = b => `<a class="book" href="/books/${b.id}"><div class="cv">${cover(b)}</div><h3>${esc(b.title)}</h3><small>${esc(b.author || "")}</small></a>`;
async function listBooks() {
  const items = await latest("books", 300);
  listPage({ titleKey: "books", items, render: bookItem, cats: CATS.books, wrap: "bookgrid", action: isSheikh() ? { href: "/new/book", label: "+ " + t("newBook") } : null });
}
async function viewBook(id) {
  const b = await getOne("books", id); if (!b) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  const u = safeUrl(b.url);
  main().innerHTML = `<article class="card article book-view"><div class="crumb"><a href="/books">${t("books")}</a></div>
    <div class="bv"><div class="cv">${cover(b)}</div><div>
      <h1>${esc(b.title)}</h1><div class="meta">${esc(b.author || "")} ${catTag(b.category)}</div>
      ${b.desc ? `<div class="prose">${nl(b.desc)}</div>` : ""}
      ${u ? `<div class="hero-btns"><a class="btn" href="${u}" target="_blank" rel="noopener">${t("read")}</a><a class="btn ghost" href="${u}" download target="_blank" rel="noopener">${t("download")}</a></div>` : ""}
      <div class="actions">${delBtn("books", b)}</div></div></div></article><section class="card" id="cm"></section>`;
  bindDel("books", id, "/books");
  await comments($("#cm"), "books", id);
}

// ---------- forum ----------
const threadItem = th => `<a class="item" href="/forum/${th.id}"><h3>${esc(th.title)}</h3><p>${excerpt(th.body, 120)}</p>${meta(th.name, th.createdAt, " " + catTag(th.category))}</a>`;
async function listForum() {
  const items = (await latest("threads", 300)).filter(x => isAdmin() || !isHidden(x));
  listPage({ titleKey: "forum", items, render: threadItem, cats: CATS.threads, action: isBanned() ? null : { href: "/new/thread", label: "+ " + t("newThread") } });
}
async function viewThread(id) {
  const th = await getOne("threads", id); if (!th) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  if (isHidden(th) && !isAdmin()) return main().innerHTML = `<div class="empty">${t("hiddenByReports")}</div>`;
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="/forum">${t("forum")}</a></div>
    <h1>${esc(th.title)}</h1><div class="author-row">${avatar(th.name, th.photo)}${meta(th.name, th.createdAt, " " + catTag(th.category))}</div>
    <div class="prose">${nl(th.body)}</div><div class="actions">${delBtn("threads", th)}
      ${isHidden(th) ? `<span class="tag bad">${t("hiddenByReports")}</span><button class="btn ghost sm" id="restTh">${t("restore")}</button>` : ""}
      ${user && th.uid !== user.uid && !(th.reporters || []).includes(user.uid) && !isBanned() ? `<button class="btn ghost sm" id="repTh">${t("report")}</button>` : ""}</div></article><section class="card" id="cm"></section>`;
  bindDel("threads", id, "/forum");
  const rb = $("#repTh"); if (rb) rb.onclick = async () => { if (confirm(t("confirmReport")) && await report(`threads/${id}`, th, `/forum/${id}`)) rb.remove(); };
  const rs = $("#restTh"); if (rs) rs.onclick = async () => { try { await updateDoc(doc(db, "threads", id), { reporters: [] }); viewThread(id); } catch (e) { toast(errMsg(e), true); } };
  await comments($("#cm"), "threads", id, "replies");
}

// ---------- fatwa ----------
const qName = q => q.showName === false ? t("anonymous") : q.name;
const fatwaItem = q => `<a class="item fatwa-item" href="/fatwa/${q.id}"><span class="qmark">؟</span><div><h3>${esc(q.title || excerpt(q.body, 80))}</h3>
  <p>${excerpt(q.answer, 140)}</p>${meta(q.sheikhName ? t("answeredBy") + " " + q.sheikhName : "", q.answeredAt, " " + catTag(q.category))}</div></a>`;
async function listFatwa() {
  const items = await answeredFatwas();
  listPage({ titleKey: "fatwa", items, render: fatwaItem, cats: CATS.questions, action: { href: "/ask", label: t("ask") } });
}
async function viewFatwa(id) {
  const q = await getOne("questions", id); if (!q) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  const done = q.status === "answered";
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="/fatwa">${t("fatwa")}</a> ${catTag(q.category)}</div>
    <h1>${esc(q.title || t("question"))}</h1>
    <div class="qa q"><div class="qa-label">${t("question")}</div><div class="prose">${nl(q.body)}</div>${meta(qName(q), q.createdAt)}</div>
    ${done ? `<div class="qa a"><div class="qa-label">${t("answer")}</div><div class="prose">${nl(q.answer)}</div>
      <div class="meta">${t("answeredBy")} <b>${esc(q.sheikhName)}</b> · ${fmtDate(q.answeredAt)}</div></div>`
      : `<div class="status pending">${t("pending")}</div>`}
    ${isSheikh() ? `<details class="edit-ans"${done ? "" : " open"}><summary>${done ? t("editAnswer") : t("publishAnswer")}</summary>
      <form class="form" id="ansForm"><textarea name="answer" rows="8" required>${esc(q.answer || "")}</textarea><button class="btn">${t("publishAnswer")}</button></form></details>` : ""}
    <div class="actions">${user && (isAdmin() || (q.uid === user.uid && !done)) ? `<button class="btn ghost sm danger" id="delItem">${t("delete")}</button>` : ""}</div>
    </article>${done ? `<section class="card" id="cm"></section>` : ""}`;
  bindDel("questions", id, "/fatwa");
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
    const bad = checkContent(f.title, f.body); if (bad) return toast(bad, true);
    e.target.querySelector("button").disabled = true;
    try {
      await addDoc(collection(db, "questions"), {
        title: f.title.trim(), body: f.body.trim(), category: f.category, uid: user.uid, name: myName(),
        showName: !f.hide, status: "pending", createdAt: serverTimestamp()
      });
      markPosted(); bump("questions"); toast(t("askSent")); go("/profile");
    } catch (err) { toast(errMsg(err), true); e.target.querySelector("button").disabled = false; }
  };
}

// ---------- add content ----------
// ---------- رفع الملفات إلى Cloudinary ----------
const canUpload = () => !!(UPLOAD?.cloudName && UPLOAD?.videoPreset);
function cloudUpload(file, res, onProgress) {
  return new Promise((ok, fail) => {
    const fd = new FormData(); fd.append("file", file); fd.append("upload_preset", UPLOAD.videoPreset);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${UPLOAD.cloudName}/${res}/upload`);
    xhr.upload.onprogress = ev => { if (ev.lengthComputable && onProgress) onProgress(Math.round(ev.loaded / ev.total * 100)); };
    xhr.onload = () => { try { const r = JSON.parse(xhr.responseText); if (r.secure_url) return ok(r.secure_url); } catch {} fail(new Error("upload")); };
    xhr.onerror = () => fail(new Error("upload"));
    xhr.send(fd);
  });
}

const FORMS = {
  post: { coll: "posts", staff: true, title: "newPost", fields: [{ k: "title" }, { k: "body", type: "textarea", rows: 14 }] },
  video: { coll: "videos", staff: true, title: "newVideo", fields: [{ k: "title" }, { k: "speaker" }, { k: "url", type: "url", label: "videoUrl", opt: true, upload: "video" }, { k: "category", type: "select", opts: CATS.videos }, { k: "desc", type: "textarea", opt: true }] },
  audio: { coll: "audios", staff: true, title: "newAudio", fields: [{ k: "title" }, { k: "speaker" }, { k: "url", type: "hidden", upload: "audio" }, { k: "category", type: "select", opts: CATS.audios }, { k: "desc", type: "textarea", opt: true }] },
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
    const inp = f.type === "hidden" ? `<input type="hidden" name="${f.k}" value="${v(f.k)}">`
      : `<label>${lbl}<input name="${f.k}" value="${v(f.k)}" type="${f.type || "text"}" ${req} ${f.type === "url" ? 'dir="ltr" placeholder="https://"' : 'maxlength="200"'}></label>`;
    if (!f.upload) return inp;
    const au = f.upload === "audio";
    return inp + (canUpload()
      ? `<div class="upbox" data-kind="${f.upload}"><b>${t(au ? "uploadAudio" : "uploadVideo")}</b>${au && item?.url ? `<small class="muted">${t("currentFile")}</small><audio controls preload="none" src="${safeUrl(item.url)}"></audio>` : ""}<input type="file" id="upFile" accept="${au ? "audio/*" : "video/*"}"><div class="upbar"><i id="upBar"></i></div><small id="upMsg" class="muted">${t("uploadHint").replace("{mb}", UPLOAD.maxMB || 100)}</small></div>`
      : `<small class="muted">${t("uploadSoon")}</small>`);
  };
  main().innerHTML = `<div class="card narrow"><h1>${item ? t("edit") + ": " + esc(item.title) : t(F.title)}</h1><form class="form" id="newForm">${F.fields.map(field).join("")}<button class="btn wide">${t("save")}</button></form></div>`;
  const up = $("#upFile");
  if (up) up.onchange = async () => {
    const file = up.files[0]; if (!file) return;
    const au = up.closest(".upbox").dataset.kind === "audio";
    const msg = $("#upMsg"), bar = $("#upBar"), save = $("#newForm > button"), mb = UPLOAD.maxMB || 100;
    if (file.size > mb * 1048576) { msg.textContent = t(au ? "audioTooBig" : "uploadTooBig").replace("{mb}", mb); up.value = ""; return; }
    save.disabled = true; up.disabled = true;
    try {
      const url = await cloudUpload(file, "video", p => { bar.style.width = p + "%"; msg.textContent = `${t("uploading")} ${p}%`; });
      $("#newForm [name=url]").value = url; msg.textContent = t(au ? "audioDone" : "uploadDone"); bar.style.width = "100%";
    } catch { msg.textContent = t(au ? "audioFail" : "uploadFail"); bar.style.width = "0"; }
    save.disabled = false; up.disabled = false;
  };
  $("#newForm").onsubmit = async e => {
    e.preventDefault();
    const data = {};
    F.fields.forEach(f => data[f.k] = String(new FormData(e.target).get(f.k) || "").trim());
    if (F.fields.some(f => f.upload) && !data.url) return toast(t(type === "audio" ? "audioRequired" : "urlOrUpload"), true);
    const bad = checkContent(...F.fields.filter(f => f.type !== "url" && f.type !== "select").map(f => data[f.k])); if (bad) return toast(bad, true);
    e.target.querySelector("button").disabled = true;
    try {
      if (item) {
        await updateDoc(doc(db, F.coll, editId), { ...data, updatedAt: serverTimestamp() });
        toast(t("saved")); go(`/${ROUTE_OF[F.coll]}/${editId}`);
      } else {
        Object.assign(data, { uid: user.uid, name: myName(), photo: myPhoto(), createdAt: serverTimestamp() });
        const r = await addDoc(collection(db, F.coll), data); markPosted(); bump(F.coll === "threads" ? "threads" : "content"); go(`/${ROUTE_OF[F.coll]}/${r.id}`);
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
    ${SITE.contactEmail ? `<p class="contact-mail">${t("orEmail")} <a href="mailto:${esc(SITE.contactEmail)}" dir="ltr">${esc(SITE.contactEmail)}</a></p>` : ""}
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
      main().innerHTML = `<div class="card narrow"><h1>${t("contactUs")}</h1><p>${t("msgSent")}</p><a class="btn" href="/">${t("home")}</a></div>`;
    } catch (err) { toast(errMsg(err), true); btn.disabled = false; }
  };
}

// ---------- stats dashboard ----------
const CC_NAME = { PS: ["فلسطين", "Palestine", "🇵🇸"], JRS: ["توقيت القدس", "Jerusalem time", "🕌"], JO: ["الأردن", "Jordan", "🇯🇴"], EG: ["مصر", "Egypt", "🇪🇬"], SA: ["السعودية", "Saudi Arabia", "🇸🇦"],
  AE: ["الإمارات", "UAE", "🇦🇪"], QA: ["قطر", "Qatar", "🇶🇦"], KW: ["الكويت", "Kuwait", "🇰🇼"], BH: ["البحرين", "Bahrain", "🇧🇭"], OM: ["عُمان", "Oman", "🇴🇲"], YE: ["اليمن", "Yemen", "🇾🇪"],
  IQ: ["العراق", "Iraq", "🇮🇶"], SY: ["سوريا", "Syria", "🇸🇾"], LB: ["لبنان", "Lebanon", "🇱🇧"], LY: ["ليبيا", "Libya", "🇱🇾"], TN: ["تونس", "Tunisia", "🇹🇳"], DZ: ["الجزائر", "Algeria", "🇩🇿"],
  MA: ["المغرب", "Morocco", "🇲🇦"], SD: ["السودان", "Sudan", "🇸🇩"], MR: ["موريتانيا", "Mauritania", "🇲🇷"], SO: ["الصومال", "Somalia", "🇸🇴"], DJ: ["جيبوتي", "Djibouti", "🇩🇯"],
  TR: ["تركيا", "Turkey", "🇹🇷"], IR: ["إيران", "Iran", "🇮🇷"], PK: ["باكستان", "Pakistan", "🇵🇰"], IN: ["الهند", "India", "🇮🇳"], BD: ["بنغلاديش", "Bangladesh", "🇧🇩"],
  ID: ["إندونيسيا", "Indonesia", "🇮🇩"], MY: ["ماليزيا", "Malaysia", "🇲🇾"], SG: ["سنغافورة", "Singapore", "🇸🇬"], AF: ["أفغانستان", "Afghanistan", "🇦🇫"], UZ: ["أوزبكستان", "Uzbekistan", "🇺🇿"],
  GB: ["بريطانيا", "UK", "🇬🇧"], FR: ["فرنسا", "France", "🇫🇷"], DE: ["ألمانيا", "Germany", "🇩🇪"], ES: ["إسبانيا", "Spain", "🇪🇸"], IT: ["إيطاليا", "Italy", "🇮🇹"], NL: ["هولندا", "Netherlands", "🇳🇱"],
  BE: ["بلجيكا", "Belgium", "🇧🇪"], SE: ["السويد", "Sweden", "🇸🇪"], NO: ["النرويج", "Norway", "🇳🇴"], DK: ["الدنمارك", "Denmark", "🇩🇰"], AT: ["النمسا", "Austria", "🇦🇹"], CH: ["سويسرا", "Switzerland", "🇨🇭"],
  RU: ["روسيا", "Russia", "🇷🇺"], US: ["أمريكا", "USA", "🇺🇸"], CA: ["كندا", "Canada", "🇨🇦"], BR: ["البرازيل", "Brazil", "🇧🇷"], MX: ["المكسيك", "Mexico", "🇲🇽"], AU: ["أستراليا", "Australia", "🇦🇺"],
  NG: ["نيجيريا", "Nigeria", "🇳🇬"], KE: ["كينيا", "Kenya", "🇰🇪"], ZA: ["جنوب أفريقيا", "South Africa", "🇿🇦"], SN: ["السنغال", "Senegal", "🇸🇳"], JP: ["اليابان", "Japan", "🇯🇵"], CN: ["الصين", "China", "🇨🇳"],
  XX: ["دول أخرى", "Other", "🌍"] };
const ccLabel = c => { const n = CC_NAME[c] || CC_NAME.XX; return `${n[2]} ${lang === "ar" ? n[0] : n[1]}`; };
async function pageStats() {
  if (!requireLogin()) return; if (!isAdmin()) return denied();
  let range = +(sessionStorage.getItem("statsRange") || 28);
  const days = Array.from({ length: 90 }, (_, i) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - (89 - i)); return todayId(d); });
  const docs = await Promise.all(days.map(id => getDoc(doc(db, "stats", id)).then(s => ({ id, ...(s.exists() ? s.data() : {}) })).catch(() => ({ id }))));
  const counts = {};
  await Promise.all(["users", "posts", "audios", "videos", "books", "threads"].map(c => getCountFromServer(collection(db, c)).then(r => counts[c] = r.data().count).catch(() => counts[c] = "—")));
  await getCountFromServer(query(collection(db, "questions"), where("status", "==", "answered"))).then(r => counts.answered = r.data().count).catch(() => counts.answered = "—");
  await getCountFromServer(query(collection(db, "questions"), where("status", "==", "pending"))).then(r => counts.pending = r.data().count).catch(() => counts.pending = "—");
  const draw = () => {
    const cur = docs.slice(-range), prev = docs.slice(-2 * range, -range);
    const sum = (arr, f) => arr.reduce((a, d) => a + (d[f] || 0), 0);
    const merge = (arr, f) => { const o = {}; arr.forEach(d => Object.entries(d[f] || {}).forEach(([k, v]) => o[k] = (o[k] || 0) + v)); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
    const delta = f => { const a = sum(cur, f), b = sum(prev, f); if (!b) return a ? `<span class="up">▲ ${t("new")}</span>` : ""; const p = Math.round((a - b) / b * 100); return `<span class="${p >= 0 ? "up" : "down"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}%</span>`; };
    const today = docs[docs.length - 1];
    const kpis = [["views", "statViews"], ["visitors", "statVisitors"], ["signups", "statSignups"], ["comments", "statComments"], ["questions", "statQuestions"], ["threads", "statThreads"]];
    const maxV = Math.max(1, ...cur.map(d => d.views || 0));
    const W = 760, H = 180, bw = W / cur.length;
    const bars = cur.map((d, i) => { const h = (d.views || 0) / maxV * (H - 20), hv = (d.visitors || 0) / maxV * (H - 20);
      return `<g><title>${d.id}: ${d.views || 0} ${t("statViews")} · ${d.visitors || 0} ${t("statVisitors")}</title><rect x="${i * bw + 1}" y="${H - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" class="bar"/><rect x="${i * bw + bw * .25}" y="${H - hv}" width="${Math.max(1, bw * .5 - 1)}" height="${hv}" rx="2" class="bar2"/></g>`; }).join("");
    const listBox = (rows, label, total) => rows.length ? rows.slice(0, 10).map(([k, v]) => `<div class="srow"><span>${label(k)}</span><b>${v}</b><i style="width:${Math.round(v / total * 100)}%"></i></div>`).join("") : `<div class="empty sm">${t("noData")}</div>`;
    const cs = merge(cur, "countries"), ps = merge(cur, "pages"), ds = merge(cur, "devices");
    const vTot = sum(cur, "visitors") || 1, pTot = sum(cur, "views") || 1;
    main().innerHTML = `<div class="page-head"><h1>${icon("stats", "ic")} ${t("stats")}</h1>
        <div class="chips">${[7, 28, 90].map(r => `<button class="chip${r === range ? " on" : ""}" data-r="${r}">${t("lastDays").replace("{n}", r)}</button>`).join("")}</div></div>
      <div class="kpis">${kpis.map(([f, k]) => `<div class="kpi"><small>${t(k)}</small><b>${sum(cur, f).toLocaleString()}</b>${delta(f)}</div>`).join("")}</div>
      <div class="card"><div class="page-head"><h3>${t("statViews")} / ${t("statVisitors")}</h3><small class="muted">${t("today")}: ${today.views || 0} · ${today.visitors || 0}</small></div>
        <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>
        <div class="chart-x"><span>${cur[0].id}</span><span>${cur[cur.length - 1].id}</span></div>
        <div class="legend"><span><i class="bar"></i>${t("statViews")}</span><span><i class="bar2"></i>${t("statVisitors")}</span></div></div>
      <div class="stats-grid">
        <div class="card"><h3>${t("statCountries")}</h3>${listBox(cs, ccLabel, vTot)}</div>
        <div class="card"><h3>${t("statPages")}</h3>${listBox(ps, k => t(k) || k, pTot)}</div>
        <div class="card"><h3>${t("statDevices")}</h3>${listBox(ds, k => k === "mobile" ? "📱 " + t("mobile") : "💻 " + t("desktop"), vTot)}</div>
        <div class="card"><h3>${t("statContent")}</h3>
          ${[["users", "statMembers"], ["posts", "posts"], ["videos", "videos"], ["audios", "audio"], ["books", "books"], ["threads", "forum"], ["answered", "answered"], ["pending", "pending"]]
            .map(([c, k]) => `<div class="srow"><span>${t(k)}</span><b>${counts[c]}</b></div>`).join("")}</div>
      </div>
      <p class="muted small-note">${t("statsNote")}</p>`;
    $$(".chip[data-r]").forEach(b => b.onclick = () => { range = +b.dataset.r; sessionStorage.setItem("statsRange", range); draw(); });
  };
  draw();
}

// ---------- donate ----------
async function getDonate() { const s = await getDoc(doc(db, "settings", "donate")); return s.exists() ? s.data() : { methods: [], message: "" }; }
async function pageDonate() {
  const d = await getDonate(), methods = (d.methods || []).filter(m => m.title && m.details);
  main().innerHTML = `<section class="donate-hero"><div>${icon("donate", "ic big")}</div><h1>${t("donateTitle")}</h1>
      <p>${d.message ? nl(d.message) : t("donateIntro")}</p>
      <blockquote>${t("donateVerse")}</blockquote></section>
    <div class="donate-grid">
      ${methods.length ? methods.map((m, i) => `<div class="card dmethod"><h3>${esc(m.title)}</h3>
        <div class="dval" dir="auto">${nl(m.details)}</div>
        ${m.note ? `<p class="muted">${nl(m.note)}</p>` : ""}
        <button class="btn sm" data-copy="${i}">${t("copy")}</button></div>`).join("")
      : `<div class="card dmethod soon"><h3>${t("donateSoon")}</h3><p class="muted">${t("donateSoonNote")}</p><a class="btn ghost sm" href="/contact">${t("contactUs")}</a></div>`}
    </div>
    <div class="card narrow"><h3>${t("donateWhere")}</h3><ul class="dlist">${t("donateUses")}</ul></div>`;
  $$("[data-copy]").forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(methods[+b.dataset.copy].details); toast(t("copied")); } catch { toast(t("copyFail"), true); }
  });
}

// ---------- profile ----------
async function pageProfile() {
  if (!requireLogin()) return;
  const s = await getDocs(query(collection(db, "questions"), where("uid", "==", user.uid), limit(200)));
  const qs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const r = isAdmin() ? "admin" : role();
  main().innerHTML = `<div class="card narrow profile">
      <div class="author-row">${avatar(myName(), myPhoto(), 88)}<div><h1>${esc(myName())}</h1><div class="meta" dir="ltr">${esc(user.email || "")}</div>
      <span class="badge ${r}">${t("role_" + r)}</span></div></div>
      ${canUpload() ? `<div class="photo-row"><label class="btn ghost sm">${t("changePhoto")}<input type="file" id="phFile" accept="image/*" hidden></label>${myPhoto() ? `<button class="btn ghost sm danger" id="phDel">${t("removePhoto")}</button>` : ""}<small class="muted" id="phMsg"></small></div>` : ""}
      ${needsVerify() ? `<div class="verify-box"><p>${t("verifyBox")}</p><div class="row-btns"><button class="btn sm" id="vDone">${t("verifyDone")}</button><button class="btn ghost sm" id="vResend">${t("verifyResend")}</button></div></div>` : ""}
      <form class="form inline" id="nameForm"><label>${t("name")}<input name="name" value="${esc(myName())}" required maxlength="60"></label><button class="btn sm">${t("save")}</button></form>
      <button class="btn ghost sm danger" id="outBtn">${t("logout")}</button>
    </div>
    <div class="card narrow"><div class="page-head"><h2>${t("myQuestions")}</h2><a class="btn sm" href="/ask">${t("ask")}</a></div>
      ${qs.length ? `<div class="list">${qs.map(q => `<a class="item row" href="/fatwa/${q.id}"><h3>${esc(q.title || excerpt(q.body, 80))}</h3>
        <span class="status ${q.status}">${t(q.status)}</span></a>`).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`}</div>`;
  $("#outBtn").onclick = async () => { await signOut(auth); go("/"); };
  const setPhoto = async url => {
    await updateDoc(doc(db, "users", user.uid), { photo: url });
    try { await updateProfile(user, { photoURL: url || null }); } catch {}
    profile = { ...profile, photo: url }; renderShell(); toast(t("photoSaved")); pageProfile();
  };
  const ph = $("#phFile"); if (ph) ph.onchange = async () => {
    const f = ph.files[0]; if (!f) return;
    if (!/^image\//.test(f.type)) return;
    if (f.size > (UPLOAD.photoMB || 5) * 1048576) { ph.value = ""; return toast(t("photoTooBig"), true); }
    const m = $("#phMsg"); m.textContent = t("photoUploading");
    try {
      const url = await cloudUpload(f, "image", p => m.textContent = `${t("photoUploading")} ${p}%`);
      await setPhoto(url.replace("/image/upload/", "/image/upload/c_fill,g_face,w_256,h_256,q_auto,f_auto/"));
    } catch (e) { m.textContent = ""; toast(t("uploadFail"), true); }
  };
  const pd = $("#phDel"); if (pd) pd.onclick = () => setPhoto("").catch(e => toast(errMsg(e), true));
  const vd = $("#vDone"); if (vd) vd.onclick = async () => {
    await reload(user); await user.getIdToken(true);
    if (user.emailVerified) { toast(t("verifyOk")); renderShell(); pageProfile(); } else toast(t("verifyNot"), true);
  };
  const vr = $("#vResend"); if (vr) vr.onclick = async () => { try { await sendEmailVerification(user); toast(t("verifySent")); } catch (e) { toast(errMsg(e), true); } };
  $("#nameForm").onsubmit = async e => {
    e.preventDefault(); const name = e.target.name.value.trim();
    if (findBad(name, MOD_WORDS)) return toast(t("badWords"), true);
    try {
      if (nameKey(name) !== profile?.nameKey) { const o = await nameOwner(name); if (o && o !== user.uid) return toast(t("nameTaken"), true); }
      await changeName(name); await updateProfile(user, { displayName: name });
      profile = { ...profile, name, nameKey: nameKey(name) }; renderShell(); toast(t("saved")); pageProfile();
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
      <a class="btn ghost" href="/new/post">+ ${t("newPost")}</a><a class="btn ghost" href="/new/audio">+ ${t("newAudio")}</a><a class="btn ghost" href="/new/video">+ ${t("newVideo")}</a><a class="btn ghost" href="/new/book">+ ${t("newBook")}</a></div></div>
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
async function loadDonateEditor() {
  const box = $("#donEdit"); if (!box) return;
  const d = await getDonate(); let rows = (d.methods || []).slice();
  const draw = () => {
    box.innerHTML = `<p class="muted">${t("donateAdminHelp")}</p>
      <label class="form"><span>${t("donateMsg")}</span><textarea id="donMsg" rows="3" placeholder="${t("donateIntro")}">${esc(d.message || "")}</textarea></label>
      <div id="donRows">${rows.map((m, i) => `<div class="drow" data-i="${i}">
        <input data-f="title" placeholder="${t("dTitle")}" value="${esc(m.title || "")}">
        <textarea data-f="details" rows="2" dir="auto" placeholder="${t("dDetails")}">${esc(m.details || "")}</textarea>
        <input data-f="note" placeholder="${t("dNote")}" value="${esc(m.note || "")}">
        <button class="link danger" data-rm="${i}">${t("delete")}</button></div>`).join("")}</div>
      <div class="row-btns"><button class="btn ghost sm" id="donAdd">+ ${t("dAdd")}</button><button class="btn" id="donSave">${t("save")}</button></div>`;
    const sync = () => $$(".drow", box).forEach(r => { const i = +r.dataset.i; $$("[data-f]", r).forEach(inp => rows[i][inp.dataset.f] = inp.value.trim()); });
    $("#donAdd").onclick = () => { sync(); d.message = $("#donMsg").value; rows.push({ title: "", details: "", note: "" }); draw(); };
    $$("[data-rm]", box).forEach(b => b.onclick = () => { sync(); d.message = $("#donMsg").value; rows.splice(+b.dataset.rm, 1); draw(); });
    $("#donSave").onclick = async () => {
      sync(); const methods = rows.filter(m => m.title && m.details);
      try { await setDoc(doc(db, "settings", "donate"), { methods, message: $("#donMsg").value.trim(), updatedAt: serverTimestamp() }); toast(t("saved")); }
      catch (e) { toast(errMsg(e), true); }
    };
  };
  draw();
}
async function loadFlags() {
  const box = $("#flags"); if (!box) return;
  const fl = await latest("flags", 100);
  box.innerHTML = fl.length ? fl.map(f => `<div class="item msg"><div class="cmeta"><b>${esc(f.name)}</b><span>${fmtDate(f.createdAt)}</span>
    <a href="${esc((f.route || "/").replace(/^#/, ""))}">${t("view")}</a>
    <button class="link" data-fok="${f.id}">${t("restore")}</button>
    <button class="link danger" data-fdel="${f.id}">${t("deleteContent")}</button></div>
    ${f.title ? `<b>${esc(f.title)}</b>` : ""}<div class="ctext">${nl(f.text)}</div></div>`).join("") : `<div class="empty sm">${t("noFlags")}</div>`;
  const get = id => fl.find(x => x.id === id);
  $$("[data-fok]", box).forEach(b => b.onclick = async () => {
    const f = get(b.dataset.fok);
    try { await updateDoc(doc(db, f.path), { reporters: [] }).catch(() => {}); await deleteDoc(doc(db, "flags", f.id)); loadFlags(); } catch (e) { toast(errMsg(e), true); }
  });
  $$("[data-fdel]", box).forEach(b => b.onclick = async () => {
    if (!confirm(t("confirmDelete"))) return;
    const f = get(b.dataset.fdel);
    try { await deleteDoc(doc(db, f.path)); await deleteDoc(doc(db, "flags", f.id)); loadFlags(); } catch (e) { toast(errMsg(e), true); }
  });
}
async function pageAdmin() {
  if (!requireLogin()) return; if (!isAdmin()) return denied();
  const users = await latest("users", 500);
  main().innerHTML = `<div class="page-head"><h1>${t("admin")} — ${t("users")} (${users.length})</h1><a class="btn gold" href="/stats">${icon("stats", "ic sm")} ${t("stats")}</a></div>
    <div class="toolbar"><input class="search" type="search" placeholder="${t("searchUsers")}"></div>
    <div class="card"><table class="tbl"><tbody id="urows"></tbody></table></div>
    <h2 class="sub">${t("flagged")}</h2><div id="flags" class="list"></div>
    <h2 class="sub">${t("inbox")}</h2><div id="inbox" class="list"></div>
    <h2 class="sub">${t("donateSettings")}</h2>
    <div class="card" id="donEdit"></div>
    <h2 class="sub">${t("moderation")}</h2>
    <div class="card"><p class="muted">${t("bannedWordsHelp")}</p>
      <textarea id="modWords" rows="10" dir="auto">${esc(MOD_WORDS.join("\n"))}</textarea>
      <div class="row-btns" style="margin-top:10px"><button class="btn" id="saveWords">${t("save")}</button>
      <small class="muted">${t("autoRules").replace("{n}", HIDE_AFTER_REPORTS).replace("{s}", COOLDOWN_SEC)}</small></div></div>`;
  loadInbox(); loadFlags(); loadDonateEditor();
  $("#saveWords").onclick = async () => {
    const words = [...new Set($("#modWords").value.split(/\n+/).map(w => w.trim()).filter(Boolean))];
    try { await setDoc(doc(db, "settings", "moderation"), { words, pattern: buildPattern(words), updatedAt: serverTimestamp() }); MOD_WORDS = words; toast(t("saved")); }
    catch (e) { toast(errMsg(e), true); }
  };
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
