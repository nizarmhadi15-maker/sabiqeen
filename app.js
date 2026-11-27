import { firebaseConfig, SITE, ADMIN_EMAILS, UPLOAD, CAPTCHA } from "./config.js?v=20261127c";
import { I18N } from "./i18n.js?v=20261127c";
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
// اللغة: المحفوظة، ثم /en، ثم لغة المتصفح (عربي ← عربي، غير ذلك ← إنجليزي)
const browserLang = () => { const ls = navigator.languages?.length ? navigator.languages : [navigator.language || ""]; return ls.some(l => /^ar\b/i.test(l)) ? "ar" : "en"; };
let lang = /^\/en(\/|$)/.test(location.pathname) ? "en" : localStorage.getItem("lang") || browserLang() || SITE.defaultLang || "ar";
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
// كل المناطق الزمنية في العالم ← رمز الدولة (من قاعدة بيانات IANA)
const TZ_PRE = { a: "Africa/", m: "America/", s: "Asia/", e: "Europe/", u: "Australia/", p: "Pacific/", i: "Indian/", t: "Atlantic/", n: "Antarctica/", r: "Arctic/", _: "" };
const TZ_CC = {};
"AD=e:Andorra;AE=s:Dubai;AF=s:Kabul;AG=m:Antigua;AI=m:Anguilla;AL=e:Tirane;AM=s:Yerevan;AO=a:Luanda;AQ=n:Casey,n:Davis,n:DumontDUrville,n:Mawson,n:McMurdo,n:Palmer,n:Rothera,n:South_Pole,n:Syowa,n:Troll,n:Vostok;AR=m:Argentina/Buenos_Aires,m:Argentina/Catamarca,m:Argentina/ComodRivadavia,m:Argentina/Cordoba,m:Argentina/Jujuy,m:Argentina/La_Rioja,m:Argentina/Mendoza,m:Argentina/Rio_Gallegos,m:Argentina/Salta,m:Argentina/San_Juan,m:Argentina/San_Luis,m:Argentina/Tucuman,m:Argentina/Ushuaia,m:Buenos_Aires,m:Catamarca,m:Cordoba,m:Jujuy,m:Mendoza,m:Rosario;AS=p:Pago_Pago,p:Samoa,_:US/Samoa;AT=e:Vienna;AU=n:Macquarie,u:ACT,u:Adelaide,u:Brisbane,u:Broken_Hill,u:Canberra,u:Currie,u:Darwin,u:Eucla,u:Hobart,u:LHI,u:Lindeman,u:Lord_Howe,u:Melbourne,u:NSW,u:North,u:Perth,u:Queensland,u:South,u:Sydney,u:Tasmania,u:Victoria,u:West,u:Yancowinna;AW=m:Aruba;AX=e:Mariehamn;AZ=s:Baku;BA=e:Sarajevo;BB=m:Barbados;BD=s:Dacca,s:Dhaka;BE=e:Brussels;BF=a:Ouagadougou;BG=e:Sofia;BH=s:Bahrain;BI=a:Bujumbura;BJ=a:Porto-Novo;BL=m:St_Barthelemy;BM=t:Bermuda;BN=s:Brunei;BO=m:La_Paz;BQ=m:Kralendijk;BR=m:Araguaina,m:Bahia,m:Belem,m:Boa_Vista,m:Campo_Grande,m:Cuiaba,m:Eirunepe,m:Fortaleza,m:Maceio,m:Manaus,m:Noronha,m:Porto_Acre,m:Porto_Velho,m:Recife,m:Rio_Branco,m:Santarem,m:Sao_Paulo,_:Brazil/Acre,_:Brazil/DeNoronha,_:Brazil/East,_:Brazil/West;BS=m:Nassau;BT=s:Thimbu,s:Thimphu;BW=a:Gaborone;BY=e:Minsk;BZ=m:Belize;CA=m:Atikokan,m:Blanc-Sablon,m:Cambridge_Bay,m:Coral_Harbour,m:Creston,m:Dawson,m:Dawson_Creek,m:Edmonton,m:Fort_Nelson,m:Glace_Bay,m:Goose_Bay,m:Halifax,m:Inuvik,m:Iqaluit,m:Moncton,m:Montreal,m:Nipigon,m:Pangnirtung,m:Rainy_River,m:Rankin_Inlet,m:Regina,m:Resolute,m:St_Johns,m:Swift_Current,m:Thunder_Bay,m:Toronto,m:Vancouver,m:Whitehorse,m:Winnipeg,m:Yellowknife,_:Canada/Atlantic,_:Canada/Central,_:Canada/Eastern,_:Canada/Mountain,_:Canada/Newfoundland,_:Canada/Pacific,_:Canada/Saskatchewan,_:Canada/Yukon;CC=i:Cocos;CD=a:Kinshasa,a:Lubumbashi;CF=a:Bangui;CG=a:Brazzaville;CH=e:Zurich;CI=a:Abidjan;CK=p:Rarotonga;CL=m:Coyhaique,m:Punta_Arenas,m:Santiago,_:Chile/Continental,_:Chile/EasterIsland,p:Easter;CM=a:Douala;CN=s:Chongqing,s:Chungking,s:Harbin,s:Kashgar,s:Shanghai,s:Urumqi,_:PRC;CO=m:Bogota;CR=m:Costa_Rica;CU=m:Havana,_:Cuba;CV=t:Cape_Verde;CW=m:Curacao;CX=i:Christmas;CY=s:Famagusta,s:Nicosia,e:Nicosia;CZ=e:Prague;DE=e:Berlin,e:Busingen;DJ=a:Djibouti;DK=e:Copenhagen;DM=m:Dominica;DO=m:Santo_Domingo;DZ=a:Algiers;EC=m:Guayaquil,p:Galapagos;EE=e:Tallinn;EG=a:Cairo,_:Egypt;EH=a:El_Aaiun;ER=a:Asmara,a:Asmera;ES=a:Ceuta,t:Canary,e:Madrid;ET=a:Addis_Ababa;FI=e:Helsinki;FJ=p:Fiji;FK=t:Stanley;FM=p:Chuuk,p:Kosrae,p:Pohnpei,p:Ponape,p:Truk,p:Yap;FO=t:Faeroe,t:Faroe;FR=e:Paris;GA=a:Libreville;GB=e:Belfast,e:London,_:GB,_:GB-Eire;GD=m:Grenada;GE=s:Tbilisi;GF=m:Cayenne;GG=e:Guernsey;GH=a:Accra;GI=e:Gibraltar;GL=m:Danmarkshavn,m:Godthab,m:Nuuk,m:Scoresbysund,m:Thule;GM=a:Banjul;GN=a:Conakry;GP=m:Guadeloupe;GQ=a:Malabo;GR=e:Athens;GS=t:South_Georgia;GT=m:Guatemala;GU=p:Guam;GW=a:Bissau;GY=m:Guyana;HK=s:Hong_Kong,_:Hongkong;HN=m:Tegucigalpa;HR=e:Zagreb;HT=m:Port-au-Prince;HU=e:Budapest;ID=s:Jakarta,s:Jayapura,s:Makassar,s:Pontianak,s:Ujung_Pandang;IE=_:Eire,e:Dublin;IM=e:Isle_of_Man;IN=s:Calcutta,s:Kolkata;IO=i:Chagos;IQ=s:Baghdad;IR=s:Tehran,_:Iran;IS=t:Reykjavik,_:Iceland;IT=e:Rome;JE=e:Jersey;JM=m:Jamaica,_:Jamaica;JO=s:Amman;JP=s:Tokyo,_:Japan;JRS=s:Jerusalem,s:Tel_Aviv,_:Israel;KE=a:Nairobi;KG=s:Bishkek;KH=s:Phnom_Penh;KI=p:Enderbury,p:Kanton,p:Kiritimati,p:Tarawa;KM=i:Comoro;KN=m:St_Kitts;KP=s:Pyongyang;KR=s:Seoul,_:ROK;KW=s:Kuwait;KY=m:Cayman;KZ=s:Almaty,s:Aqtau,s:Aqtobe,s:Atyrau,s:Oral,s:Qostanay,s:Qyzylorda;LA=s:Vientiane;LB=s:Beirut;LC=m:St_Lucia;LI=e:Vaduz;LK=s:Colombo;LR=a:Monrovia;LS=a:Maseru;LT=e:Vilnius;LU=e:Luxembourg;LV=e:Riga;LY=a:Tripoli,_:Libya;MA=a:Casablanca;MC=e:Monaco;MD=e:Chisinau,e:Tiraspol;ME=e:Podgorica;MF=m:Marigot;MG=i:Antananarivo;MH=_:Kwajalein,p:Kwajalein,p:Majuro;MK=e:Skopje;ML=a:Bamako,a:Timbuktu;MM=s:Rangoon,s:Yangon;MN=s:Choibalsan,s:Hovd,s:Ulaanbaatar,s:Ulan_Bator;MO=s:Macao,s:Macau;MP=p:Saipan;MQ=m:Martinique;MR=a:Nouakchott;MS=m:Montserrat;MT=e:Malta;MU=i:Mauritius;MV=i:Maldives;MW=a:Blantyre;MX=m:Bahia_Banderas,m:Cancun,m:Chihuahua,m:Ciudad_Juarez,m:Ensenada,m:Hermosillo,m:Matamoros,m:Mazatlan,m:Merida,m:Mexico_City,m:Monterrey,m:Ojinaga,m:Santa_Isabel,m:Tijuana,_:Mexico/BajaNorte,_:Mexico/BajaSur,_:Mexico/General;MY=s:Kuala_Lumpur,s:Kuching;MZ=a:Maputo;NA=a:Windhoek;NC=p:Noumea;NE=a:Niamey;NF=p:Norfolk;NG=a:Lagos;NI=m:Managua;NL=e:Amsterdam;NO=t:Jan_Mayen,e:Oslo;NP=s:Kathmandu,s:Katmandu;NR=p:Nauru;NU=p:Niue;NZ=_:NZ,_:NZ-CHAT,p:Auckland,p:Chatham;OM=s:Muscat;PA=m:Panama;PE=m:Lima;PF=p:Gambier,p:Marquesas,p:Tahiti;PG=p:Bougainville,p:Port_Moresby;PH=s:Manila;PK=s:Karachi;PL=e:Warsaw,_:Poland;PM=m:Miquelon;PN=p:Pitcairn;PR=m:Puerto_Rico;PS=s:Gaza,s:Hebron;PT=t:Azores,t:Madeira,e:Lisbon,_:Portugal;PW=p:Palau;PY=m:Asuncion;QA=s:Qatar;RE=i:Reunion;RO=e:Bucharest;RS=e:Belgrade;RU=s:Anadyr,s:Barnaul,s:Chita,s:Irkutsk,s:Kamchatka,s:Khandyga,s:Krasnoyarsk,s:Magadan,s:Novokuznetsk,s:Novosibirsk,s:Omsk,s:Sakhalin,s:Srednekolymsk,s:Tomsk,s:Ust-Nera,s:Vladivostok,s:Yakutsk,s:Yekaterinburg,e:Astrakhan,e:Kaliningrad,e:Kirov,e:Moscow,e:Samara,e:Saratov,e:Ulyanovsk,e:Volgograd,_:W-SU;RW=a:Kigali;SA=s:Riyadh;SB=p:Guadalcanal;SC=i:Mahe;SD=a:Khartoum;SE=e:Stockholm;SG=s:Singapore,_:Singapore;SH=t:St_Helena;SI=e:Ljubljana;SJ=r:Longyearbyen;SK=e:Bratislava;SL=a:Freetown;SM=e:San_Marino;SN=a:Dakar;SO=a:Mogadishu;SR=m:Paramaribo;SS=a:Juba;ST=a:Sao_Tome;SV=m:El_Salvador;SX=m:Lower_Princes;SY=s:Damascus;SZ=a:Mbabane;TC=m:Grand_Turk;TD=a:Ndjamena;TF=i:Kerguelen;TG=a:Lome;TH=s:Bangkok;TJ=s:Dushanbe;TK=p:Fakaofo;TL=s:Dili;TM=s:Ashgabat,s:Ashkhabad;TN=a:Tunis;TO=p:Tongatapu;TR=s:Istanbul,e:Istanbul,_:Turkey;TT=m:Port_of_Spain;TV=p:Funafuti;TW=s:Taipei,_:ROC;TZ=a:Dar_es_Salaam;UA=e:Kiev,e:Kyiv,e:Simferopol,e:Uzhgorod,e:Zaporozhye;UG=a:Kampala;UM=p:Midway,p:Wake;US=m:Adak,m:Anchorage,m:Atka,m:Boise,m:Chicago,m:Denver,m:Detroit,m:Fort_Wayne,m:Indiana/Indianapolis,m:Indiana/Knox,m:Indiana/Marengo,m:Indiana/Petersburg,m:Indiana/Tell_City,m:Indiana/Vevay,m:Indiana/Vincennes,m:Indiana/Winamac,m:Indianapolis,m:Juneau,m:Kentucky/Louisville,m:Kentucky/Monticello,m:Knox_IN,m:Los_Angeles,m:Louisville,m:Menominee,m:Metlakatla,m:New_York,m:Nome,m:North_Dakota/Beulah,m:North_Dakota/Center,m:North_Dakota/New_Salem,m:Phoenix,m:Shiprock,m:Sitka,m:Yakutat,_:Navajo,p:Honolulu,p:Johnston,_:US/Alaska,_:US/Aleutian,_:US/Arizona,_:US/Central,_:US/East-Indiana,_:US/Eastern,_:US/Hawaii,_:US/Indiana-Starke,_:US/Michigan,_:US/Mountain,_:US/Pacific;UY=m:Montevideo;UZ=s:Samarkand,s:Tashkent;VA=e:Vatican;VC=m:St_Vincent;VE=m:Caracas;VG=m:Tortola;VI=m:St_Thomas,m:Virgin;VN=s:Ho_Chi_Minh,s:Saigon;VU=p:Efate;WF=p:Wallis;WS=p:Apia;YE=s:Aden;YT=i:Mayotte;ZA=a:Johannesburg;ZM=a:Lusaka;ZW=a:Harare".split(";").forEach(g => { const [cc, zs] = g.split("="); zs.split(",").forEach(z => { const [p, n] = z.split(":"); TZ_CC[TZ_PRE[p] + n] = cc; }); });
const todayId = (d = new Date()) => d.toISOString().slice(0, 10);
function bump(field) { try { setDoc(doc(db, "stats", todayId()), { [field]: increment(1) }, { merge: true }).catch(() => {}); } catch {} }
function trackView(page) {
  try {
    const day = todayId(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const bot = navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|python|curl|wget|facebookexternalhit|whatsapp|telegram/i.test(navigator.userAgent);
    const cc = bot ? "BOT" : TZ_CC[tz] || (/^(UTC|Etc\/|GMT|Universal|Zulu)/.test(tz) ? "UTC" : "XX");
    let isNew = false; try { if (localStorage.getItem("seen") !== day) { localStorage.setItem("seen", day); isNew = true; } } catch {}
    const dev = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
    if (bot) { setDoc(doc(db, "stats", day), { countries: { BOT: increment(1) } }, { merge: true }).catch(() => {}); return; }
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
  books: ["quran_sci", "hadith", "aqeedah", "fiqh", "seerah", "tazkiya", "lugha", "family", "dawah", "other"]
};
const SUBCATS = {
  quran_sci: ["tafsir", "tajweed", "ulum_quran", "masahif"], hadith: ["hadith_mutun", "hadith_shuruh", "mustalah", "rijal"],
  aqeedah: ["tawheed", "asma_sifat", "firaq", "iman"], fiqh: ["ibadat", "muamalat", "usul_fiqh", "qawaid", "fatawa_books"],
  seerah: ["seerah_nabawiya", "sahaba", "tarikh", "tarajim"], tazkiya: ["raqaiq", "akhlaq", "adhkar"],
  lugha: ["nahw", "balagha", "adab_arabi", "maajim"], family: ["zawaj", "tarbiya", "marah"], dawah: ["dawah_gen", "adyan", "mawaiz"], other: ["general"]
};
const BOOK_LANGS = ["ar", "en", "fr", "tr", "ur", "id", "ms", "fa", "other"];
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
async function publishedBooks(n = 300) {
  const s = await getDocs(query(collection(db, "books"), where("status", "==", "published"), limit(1000)));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, n);
}
async function answeredFatwas(n = 300) {
  const s = await getDocs(query(collection(db, "questions"), where("status", "==", "answered"), limit(Math.max(n, 500))));
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
  const bookDD = `<div class="nav-dd"><a href="/books" data-k="books">${t("books")}</a><button type="button" class="dd-tog" aria-label="${t("bookCats")}">▾</button>
    <div class="dd"><a href="/books">📚 ${t("allBooks")}</a>${CATS.books.map(c => `<a href="/books?c=${c}">${t("cat_" + c)}</a>`).join("")}</div></div>`;
  $("#nav").innerHTML = links.map(([k, h]) => k === "books" ? bookDD : `<a href="${h}" data-k="${k}">${t(k)}</a>`).join("") +
    `<a href="/ask" class="nav-ask">${t("ask")}</a>` + `<a href="/donate" class="nav-donate" data-k="donate">${t("donate")}</a>` +
    (user && isSheikh() ? `<a href="/panel" class="nav-staff" data-k="panel">${t("panel")}</a>` : "") +
    (user && isAdmin() ? `<a href="/admin" class="nav-staff" data-k="admin">${t("admin")}</a><a href="/stats" class="nav-staff" data-k="stats">${t("stats")}</a>` : "");
  $("#langBtn").textContent = lang === "ar" ? "EN" : "ع";
  $("#userbox").innerHTML = !authReady ? "" : user
    ? `${isSheikh() ? `<a class="btn ghost sm" href="/panel">${t("panel")}</a>` : ""}${isAdmin() ? `<a class="btn ghost sm" href="/admin">${t("admin")}</a>` : ""}
       <a class="me" href="/profile" title="${esc(myName())}">${avatar(myName(), myPhoto())}</a>`
    : `<a class="btn sm" href="/login">${t("login")}</a>`;
}
$("#langBtn").onclick = () => { lang = lang === "ar" ? "en" : "ar"; localStorage.setItem("lang", lang); if (/^\/en(\/|$)/.test(location.pathname)) history.replaceState(null, "", lang === "en" ? "/en/" : "/"); renderShell(); route(); };
$("#menuBtn").onclick = () => document.body.classList.toggle("nav-open");
document.addEventListener("click", e => {
  const tg = e.target.closest(".dd-tog");
  if (tg) { e.preventDefault(); tg.parentElement.classList.toggle("open"); return; }
  if (!e.target.closest(".nav-dd")) $$(".nav-dd.open").forEach(x => x.classList.remove("open"));
  else if (e.target.closest(".dd a")) $$(".nav-dd.open").forEach(x => x.classList.remove("open"));
});
document.addEventListener("play", e => $$("audio").forEach(a => a !== e.target && a.pause()), true);

// ---------- router ----------
let routeId = 0;
async function route() {
  const my = ++routeId;
  document.body.classList.remove("nav-open");
  let [p, id, extra] = location.pathname.replace(/\/index\.html$/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (p === "en") { [p, id, extra] = [id, extra]; if (lang !== "en") { lang = "en"; renderShell(); } }
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
        case "audio": return id === "scholars" ? pageScholars() : id === "scholar" ? pageScholar(extra || "") : id ? viewAudio(id) : listAudio();
        case "videos": return id ? viewVideo(id) : listVideos();
        case "books": return id ? viewBook(id) : listBooks();
        case "forum": return id ? viewThread(id) : listForum();
        case "fatwa": return id ? viewFatwa(id) : listFatwa();
        case "ask": return pageAsk();
        case "login": return pageLogin();
        case "profile": return pageProfile();
        case "publisher": return pagePublisher();
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
        ${mode !== "login" ? capBox() : ""}
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
    const cap = captcha($(".cf-box", $("#aForm")));
    $("#aForm").onsubmit = async e => {
      e.preventDefault();
      if (!cap.ok()) return toast(t("captchaNeed"), true);
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
function listPage({ titleKey, action, cats, items, render, wrap = "list", countKey, startCat = "all", side = "", top = "", tabs = "", chipsHidden = false, after }) {
  const chipHtml = cats && !chipsHidden ? `<div class="chips${tabs ? " tabs" : ""}">${["all", ...cats].map(c => `<button class="chip${c === startCat ? " on" : ""}" data-c="${c}">${t(c === "all" ? (tabs ? "allOf_" + titleKey : "all") : "cat_" + c)}</button>`).join("")}${tabs}</div>` : "";
  main().innerHTML = withSide(`
    <div class="page-head"><h1>${t(titleKey)}</h1>${action ? `<a class="btn" href="${action.href}">${action.label}</a>` : ""}</div>
    ${top}
    <div class="toolbar">${tabs ? chipHtml : ""}<input class="search" type="search" placeholder="${t("search")}">${tabs ? "" : chipHtml}</div>
    ${countKey ? `<div class="list-count" id="lcount"></div>` : ""}
    <div class="${wrap}" id="items"></div>`, side);
  let cat = startCat, q = "";
  const draw = () => {
    const f = items.filter(i => (cat === "all" || i.category === cat) &&
      (!q || [i.title, i.body, i.author, i.speaker, i.desc, i.answer, i.name].join(" ").toLowerCase().includes(q)));
    $("#items").innerHTML = f.length ? f.map(render).join("") : `<div class="empty">${t("empty")}</div>`;
    if (countKey) $("#lcount").innerHTML = f.length === items.length ? `${t(countKey)}: <b>${items.length}</b>` : `${t(countKey)}: <b>${f.length}</b> ${t("ofTotal")} ${items.length}`;
  };
  $(".search").oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
  $$(".chip[data-c]").forEach(c => c.onclick = () => { $$(".chip[data-c]").forEach(x => x.classList.remove("on")); c.classList.add("on"); cat = c.dataset.c; draw(); });
  draw(); startTickers(); if (after) after();
  return {
    setCat: c => { cat = c; $$(".chip[data-c]").forEach(x => x.classList.toggle("on", x.dataset.c === c)); $$("[data-side-cat]").forEach(x => x.classList.toggle("on", x.dataset.sideCat === c)); draw(); $("#items").scrollIntoView({ behavior: "smooth", block: "start" }); },
    setQ: v => { q = v.trim().toLowerCase(); const si = $(".search"); if (si) si.value = v; draw(); $("#items").scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
}

// ---------- side boxes (like islamweb) ----------
const fmtN = n => Number(n || 0).toLocaleString("en-US");
const withSide = (mainHtml, side) => side ? `<div class="with-side"><div class="ws-main">${mainHtml}</div><aside class="ws-side">${side}</aside></div>` : mainHtml;
const SEC_OF = { posts: ["posts", "/posts/"], audios: ["audio", "/audio/"], videos: ["videos", "/videos/"], books: ["books", "/books/"], threads: ["forum", "/forum/"], questions: ["fatwa", "/fatwa/"] };
const plainText = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const tkRow = (coll, x) => { const [k, base] = SEC_OF[coll]; return { t: x.title || plainText(x.body, 70), href: base + x.id, k }; };
function tickerBox(title, rows, more, note = "", ik = "posts") {
  if (!rows.length) return "";
  const li = rows.map(r => `<li><a href="${r.href}">${icon(r.k || ik, "ic xs")}<span>${esc(r.t)}</span></a></li>`).join("");
  const moving = rows.length > 4;
  return `<section class="side-box ticker"><h3 class="sb-h">${icon(ik, "ic sb-ic")}${esc(title)}</h3>
    <div class="tk-view${moving ? " moving" : ""}"><ul class="tk-list" style="--dur:${Math.max(12, rows.length * 3)}s">${li}${moving ? li.replace(/<li>/g, '<li aria-hidden="true">') : ""}</ul></div>
    ${more ? `<div class="sb-more">${note ? `<small>${esc(note)}</small>` : ""}<a class="btn navy" href="${more}">${t("more")}</a></div>` : ""}</section>`;
}
function startTickers() {
  $$(".tk-view.moving").forEach(v => { const l = v.querySelector(".tk-list"); if (l.scrollHeight / 2 <= v.clientHeight) { v.classList.remove("moving"); l.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove()); } });
}
const secTicker = (coll, items, titleKey = "latestTopics") => tickerBox(t(titleKey), items.slice(0, 15).map(x => tkRow(coll, x)), "/" + SEC_OF[coll][0], t("moreNote_" + SEC_OF[coll][0]), SEC_OF[coll][0]);
async function topPlayed(n = 8) {
  try { const s = await getDocs(query(collection(db, "audios"), orderBy("plays", "desc"), limit(n))); return s.docs.map(d => ({ id: d.id, ...d.data() })); } catch { return []; }
}
const playedBox = list => list.length ? `<section class="side-box"><h3 class="sb-h">${icon("audio", "ic sb-ic")}${t("mostPlayed")}</h3>
  <div class="mp-list">${list.map(a => `<a class="mp" href="/audio/${a.id}"><span><b>${esc(a.title)}</b><small>${esc(cleanSpeaker(a.speaker))}</small></span><i>${fmtN(a.plays)}</i></a>`).join("")}</div></section>` : "";
// اسم الشيخ بدون الألقاب (للعرض والترتيب الأبجدي)
const cleanSpeaker = s => String(s || "").replace(/^(فضيلة\s+|سماحة\s+)?(الشيخ|العلامة|الإمام|الدكتور|د\.)\s+/, "").replace(/\s+(رحمه الله|حفظه الله|رحمه الله تعالى|حفظه الله تعالى)$/, "").trim();
const normAr = s => String(s || "").replace(/[أإآ]/g, "ا");
// عدّاد مرّة واحدة لكل جلسة
function bumpOnce(coll, id, field) {
  if (isAdmin()) return; const k = `b_${coll}_${id}`;
  try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, 1); } catch {}
  updateDoc(doc(db, coll, id), { [field]: increment(1) }).catch(() => {});
}
document.addEventListener("play", e => { const a = e.target; if (a.tagName === "AUDIO" && a.dataset.id) bumpOnce("audios", a.dataset.id, "plays"); }, true);
const catTag = c => c ? `<span class="tag">${t("cat_" + c)}</span>` : "";
const meta = (name, ts, extra = "") => `<div class="meta">${esc(name || "")}${name ? " · " : ""}${fmtDate(ts)}${extra}</div>`;

const TYPE_OF = { posts: "post", audios: "audio", videos: "video", books: "book", threads: "thread" };
function delBtn(coll, item) {
  const own = user && item.uid === user.uid;
  const can = user && !isBanned() && (isAdmin() || (coll === "threads" ? own : coll === "books" ? isSheikh() || (own && item.status === "pending") : isSheikh()));
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
    latest("posts", 5), latest("audios", 6), publishedBooks(6), answeredFatwas(6), latest("threads", 5), latest("videos", 5)]);
  const top = await topPlayed(6);
  const mix = [];
  for (let i = 0; i < 6; i++) [["questions", fats], ["audios", audios], ["posts", posts], ["books", books], ["threads", threads], ["videos", videos]].forEach(([c, a]) => a[i] && mix.push(tkRow(c, a[i])));
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
      <a class="hero-donate" href="/donate"><span class="hd-ico">❤</span><b>${t("heroDonateT")}</b><p>${t("heroDonateP")}</p><span class="btn gold">${t("heroDonateBtn")}</span></a>
    </section>
    <div class="secs">${secs.map(([k, h, d]) => `<a class="sec" href="${h}">${icon(k)}<b>${t(k)}</b><small>${t(d)}</small></a>`).join("")}</div>
    ${withSide(`<div class="home-grid">
      <div>
        ${block("latestFatwas", "/fatwa", fats.length ? `<div class="list">${fats.slice(0, 4).map(fatwaItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
        ${block("latestPosts", "/posts", posts.length ? `<div class="list">${posts.slice(0, 3).map(postItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
      </div>
      <div>
        ${block("latestAudio", "/audio", audios.length ? `<div class="list">${audios.slice(0, 4).map(audioItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
        ${block("latestThreads", "/forum", threads.length ? `<div class="list">${threads.slice(0, 4).map(threadItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
      </div>
    </div>
    ${block("latestVideos", "/videos", videos.length ? `<div class="videogrid">${videos.slice(0, 4).map(videoItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}
    ${block("latestBooks", "/books", books.length ? `<div class="bookgrid">${books.map(bookItem).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`)}`,
      tickerBox(t("mixedTopics"), mix, "/fatwa", t("mixedNote"), "posts") + playedBox(top))}`;
  startTickers();
}

// ---------- posts ----------
const postItem = p => `<a class="item" href="/posts/${p.id}"><h3>${esc(p.title)}</h3><p>${excerpt(p.body)}</p>${meta(p.name, p.createdAt)}</a>`;
async function listPosts() {
  const items = await latest("posts", 200);
  listPage({ titleKey: "posts", items, render: postItem, side: secTicker("posts", items), action: isSheikh() ? { href: "/new/post", label: "+ " + t("newPost") } : null });
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
  <div class="meta"><a class="spk" href="/audio/scholar/${encodeURIComponent(a.speaker || "")}">${esc(a.speaker || "")}</a> ${catTag(a.category)}${a.plays ? ` <span class="plays">🎧 ${fmtN(a.plays)}</span>` : ""}</div></div></div>${safeUrl(a.url) ? `<audio controls preload="none" data-id="${a.id}" src="${safeUrl(a.url)}"></audio>` : ""}</div>`;
// الصوتيات: مربعات العلماء في كل تبويب (مثل إسلام ويب)
const AR_LETTERS = "ا ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي".split(" ");
function scholarsOf(items) {
  const m = new Map();
  items.forEach(a => { const k = (a.speaker || "").trim(); if (!k) return; const o = m.get(k) || { name: k, n: 0, plays: 0 }; o.n++; o.plays += a.plays || 0; m.set(k, o); });
  return [...m.values()].sort((a, b) => cleanSpeaker(a.name).localeCompare(cleanSpeaker(b.name), "ar"));
}
async function listAudio() {
  const [all, top] = await Promise.all([latest("audios", 1000), topPlayed()]);
  const c0 = new URLSearchParams(location.search).get("c"), cat = CATS.audios.includes(c0) ? c0 : "all";
  const items = cat === "all" ? all : all.filter(a => a.category === cat);
  const list = scholarsOf(items);
  main().innerHTML = withSide(`<div class="page-head"><h1>${t("audio")}</h1>${isSheikh() ? `<a class="btn" href="/new/audio">+ ${t("newAudio")}</a>` : ""}</div>
    <div class="toolbar"><div class="chips tabs">${["all", ...CATS.audios].map(c => `<a class="chip${c === cat ? " on" : ""}" href="/audio${c === "all" ? "" : "?c=" + c}">${t(c === "all" ? "allOf_audio" : "cat_" + c)}</a>`).join("")}</div></div>
    <section class="card sch-box"><div class="sch-head"><h2>${t("scholars")}</h2><input class="search" id="schQ" type="search" placeholder="${t("searchScholar")}"></div>
      <div class="sch-grid" id="schGrid"></div></section>
    <div class="block-head" style="margin-top:22px"><h2>${t("latestAudio")}</h2><span class="list-count">${t("audioCount")}: <b>${items.length}</b></span></div>
    <div class="list">${items.slice(0, 10).map(audioItem).join("") || `<div class="empty sm">${t("empty")}</div>`}</div>`,
    secTicker("audios", items.length ? items : all) + playedBox(top));
  let L = "", Q = "";
  const draw = () => {
    const f = list.filter(s => { const n = normAr(cleanSpeaker(s.name)); return (!L || n.startsWith(L)) && (!Q || normAr(s.name).includes(normAr(Q))); });
    $("#schGrid").innerHTML = f.length ? f.map(s => `<a class="sch" href="/audio/scholar/${encodeURIComponent(s.name)}${cat === "all" ? "" : "?c=" + cat}"><b>${esc(cleanSpeaker(s.name))}</b><small>🎧 ${t("materials")}: ${s.n}</small></a>`).join("") : `<div class="empty sm">${t("empty")}</div>`;
  };
  $("#schQ").oninput = e => { Q = e.target.value.trim(); draw(); };
  draw(); startTickers();
}
const pageScholars = () => { history.replaceState(null, "", "/audio"); return listAudio(); };
async function pageScholar(name) {
  const [all, top] = await Promise.all([latest("audios", 1000), topPlayed()]);
  const items = all.filter(a => (a.speaker || "").trim() === name);
  if (!items.length) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  const plays = items.reduce((s, a) => s + (a.plays || 0), 0);
  const cats = CATS.audios.filter(c => items.some(a => a.category === c));
  const share = encodeURIComponent(location.href);
  main().innerHTML = withSide(`<div class="crumb"><a href="/audio">${t("audio")}</a> » <a href="/audio">${t("scholars")}</a></div>
    <section class="card sch-page"><div class="sp-t">${t("scholarPage")}</div><h1>${esc(cleanSpeaker(name))}</h1>
      <div class="sp-stats"><span>${t("materials")}: <b>${items.length}</b></span><span>🎧 ${t("totalPlays")}: <b>${fmtN(plays)}</b></span>
        <a class="sh wa" target="_blank" rel="noopener" href="https://wa.me/?text=${share}">WhatsApp</a><a class="sh fb" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${share}">Facebook</a><a class="sh x" target="_blank" rel="noopener" href="https://x.com/intent/post?url=${share}">X</a></div>
      <div class="folders"><button class="folder on" data-f="all">📁 ${t("allMaterials")} <i>${items.length}</i></button>${cats.map(c => `<button class="folder" data-f="${c}">📁 ${t("cat_" + c)} <i>${items.filter(a => a.category === c).length}</i></button>`).join("")}</div></section>
    <div class="list" id="items"></div>`, secTicker("audios", items, "scholarLatest") + playedBox(top));
  const draw = f => $("#items").innerHTML = items.filter(a => f === "all" || a.category === f).map(audioItem).join("");
  $$(".folder").forEach(b => b.onclick = () => { $$(".folder").forEach(x => x.classList.remove("on")); b.classList.add("on"); draw(b.dataset.f); });
  const c0 = new URLSearchParams(location.search).get("c"), pre = cats.includes(c0) ? c0 : "all";
  $$(".folder").forEach(x => x.classList.toggle("on", x.dataset.f === pre));
  draw(pre); startTickers();
}
async function viewAudio(id) {
  const a = await getOne("audios", id); if (!a) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="/audio">${t("audio")}</a></div>
    <h1>${esc(a.title)}</h1><div class="meta"><a class="spk" href="/audio/scholar/${encodeURIComponent(a.speaker || "")}">${esc(a.speaker || "")}</a> · ${fmtDate(a.createdAt)} ${catTag(a.category)}${a.plays ? ` · 🎧 ${fmtN(a.plays)}` : ""}</div>
    ${safeUrl(a.url) ? `<audio class="big" controls data-id="${a.id}" src="${safeUrl(a.url)}"></audio><a class="btn ghost sm" href="${safeUrl(a.url)}" download target="_blank" rel="noopener">${t("download")}</a>` : ""}
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
  listPage({ titleKey: "videos", items, render: videoItem, side: secTicker("videos", items), cats: CATS.videos, wrap: "videogrid", action: isSheikh() ? { href: "/new/video", label: "+ " + t("newVideo") } : null });
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
const bookItem = b => `<a class="book" href="/books/${b.id}">${b.source ? `<span class="bsrc">${t("bookSource")}: ${esc(b.source.split(" (")[0])}</span>` : ""}<div class="cv">${cover(b)}</div><h3>${esc(b.title)}</h3><small>${esc(b.author || "")}</small></a>`;
async function listBooks() {
  const items = await publishedBooks(1000);
  const c0 = new URLSearchParams(location.search).get("c");
  listPage({ titleKey: "books", items, render: bookItem, side: secTicker("books", items), cats: CATS.books, countKey: "bookCount", startCat: CATS.books.includes(c0) ? c0 : "all", wrap: "bookgrid", action: isBanned() ? null : { href: "/new/book", label: "+ " + t("publishBook") } });
}
const subTag = c => c ? `<span class="tag soft">${t("sub_" + c)}</span>` : "";
const isCloudPdf = u => /res\.cloudinary\.com\/.+\/image\/upload\/.+\.pdf(\?.*)?$/i.test(u || "");
const dlUrl = u => /res\.cloudinary\.com\/.+\/(image|raw)\/upload\//.test(u || "") ? u.replace(/\/(image|raw)\/upload\//, "/$1/upload/fl_attachment/") : u;
const readUrl = b => b.fileType === "doc" ? `https://docs.google.com/viewer?url=${encodeURIComponent(b.url)}` : b.url;
async function viewBook(id) {
  const b = await getOne("books", id); if (!b) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  const u = safeUrl(b.url), pending = b.status === "pending";
  let pub = null; try { if (b.uid) { const ps = await getDoc(doc(db, "publishers", b.uid)); if (ps.exists()) pub = ps.data(); } } catch {}
  const x = b.extra || {}, extraRows = [["pages", x.pages], ["house", x.house], ["year", x.year], ["edition", x.edition]].filter(r => r[1]);
  main().innerHTML = `<article class="card article book-view"><div class="crumb"><a href="/books">${t("books")}</a></div>
    ${pending ? `<div class="verify-box"><p>${t("bookPending")}</p>${isSheikh() ? `<button class="btn sm" id="apBtn">${t("approve")}</button>` : ""}</div>` : ""}
    ${b.source ? `<div class="src-bar">📚 ${t("bookSource")}: ${safeUrl(b.sourceUrl) ? `<a href="${safeUrl(b.sourceUrl)}" target="_blank" rel="noopener">${esc(b.source)}</a>` : `<b>${esc(b.source)}</b>`}</div>` : ""}
    <div class="bv"><div class="cv">${cover(b)}</div><div>
      <h1>${esc(b.title)}</h1><div class="meta">${t("authorBy")} <b>${esc(b.author || "")}</b> ${catTag(b.category)} ${subTag(b.subcat)}</div>
      <table class="binfo">${b.lang ? `<tr><th>${t("bookLang")}</th><td>${t("lang_" + b.lang)}</td></tr>` : ""}
        ${extraRows.map(([k, v]) => `<tr><th>${t(k)}</th><td>${esc(v)}</td></tr>`).join("")}
        <tr><th>${t("publishedOn")}</th><td>${fmtDate(b.createdAt)}</td></tr></table>
      ${b.desc ? `<div class="prose">${nl(b.desc)}</div>` : ""}
      ${u ? `<div class="hero-btns"><a class="btn" href="${safeUrl(readUrl(b))}" target="_blank" rel="noopener">${t("read")}</a>${b.readOnly ? "" : `<a class="btn ghost" href="${safeUrl(dlUrl(u))}" target="_blank" rel="noopener">${t("download")}</a>`}</div>` : ""}
      ${b.readOnly ? `<p class="ro-note">🔒 ${t("readOnlyBadge")}</p>` : ""}
      <div class="actions">${delBtn("books", b)}</div></div></div></article>
    ${b.uid ? `<section class="card pubcard"><h3>${t("aboutPublisher")}</h3><div class="author-row">${avatar(pub?.name || b.name, b.photo, 48)}<div><b>${esc(pub?.name || b.name || "")}</b>
      ${b.isAuthor === "yes" ? `<span class="badge">${t("isAuthorBadge")}</span>` : ""}<div class="meta">${pub?.country ? ccLabel(pub.country) : ""}</div></div></div>
      ${pub?.bio ? `<p class="prose">${nl(pub.bio)}</p>` : ""}</section>` : ""}
    ${pending ? "" : `<section class="card" id="cm"></section>`}`;
  bindDel("books", id, b.uid === user?.uid && pending ? "/profile" : "/books");
  const ap = $("#apBtn"); if (ap) ap.onclick = () => approveBook(id).then(() => viewBook(id));
  if (!pending) await comments($("#cm"), "books", id);
}
async function approveBook(id) {
  try { await updateDoc(doc(db, "books", id), { status: "published", approvedBy: user.uid, approvedAt: serverTimestamp(), createdAt: serverTimestamp() }); bump("content"); toast(t("approved")); }
  catch (e) { toast(errMsg(e), true); throw e; }
}

// ---------- publisher info (required before publishing a book) ----------
const countryList = () => [...new Set([...Object.keys(CC_NAME), ...Object.values(TZ_CC)])].filter(c => !["JRS", "XX", "UTC"].includes(c))
  .sort((a, b) => ccName(a).localeCompare(ccName(b), lang)).concat("XX");
const pubReady = () => !!(profile?.publisher && profile?.phone && profile?.country && profile?.city && profile?.birth && profile?.gender);
async function pagePublisher() {
  if (!requireLogin()) return;
  if (isBanned()) return main().innerHTML = `<div class="empty">${t("bannedMsg")}</div>`;
  let pub = {}; try { const ps = await getDoc(doc(db, "publishers", user.uid)); if (ps.exists()) pub = ps.data(); } catch {}
  const next = sessionStorage.getItem("pubNext"), P = profile || {};
  const maxBirth = new Date(Date.now() - 10 * 365.25 * 864e5).toISOString().slice(0, 10);
  main().innerHTML = `<div class="card narrow"><h1>${t("publisherInfo")}</h1><p class="muted">${t("publisherIntro")}</p>
    <form class="form" id="pubForm">
      <label>${t("phone")}<input name="phone" type="tel" dir="ltr" required maxlength="20" placeholder="+970599123456" value="${esc(P.phone || "")}"><small class="lock">${t("phoneNote")}</small></label>
      <div class="grid2">
        <label>${t("country")}<select name="country" required><option value="">${t("choose")}</option>${countryList().map(c => `<option value="${c}"${(pub.country || P.country) === c ? " selected" : ""}>${ccLabel(c)}</option>`).join("")}</select></label>
        <label>${t("city")} <small class="lock">${t("privateNote")}</small><input name="city" required maxlength="80" value="${esc(P.city || "")}"></label>
      </div>
      <label>${t("birth")} <small class="lock">${t("privateNote")}</small></label>
      <div class="bdate">${(() => { const [yy, mm, dd] = (P.birth || "").split("-").map(Number), maxY = +maxBirth.slice(0, 4);
        const sel = (n, ph, arr, cur) => `<select name="${n}" required aria-label="${ph}"><option value="">${ph}</option>${arr.map(x => `<option value="${x}"${x === cur ? " selected" : ""}>${x}</option>`).join("")}</select>`;
        const rng = (a, b) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => a < b ? a + i : a - i);
        return sel("bd", t("day"), rng(1, 31), dd) + sel("bm", t("month"), rng(1, 12), mm) + sel("by", t("yearLbl"), rng(maxY, 1920), yy); })()}</div>
      <label>${t("gender")} <small class="lock">${t("privateNote")}</small><select name="gender" required><option value="">${t("choose")}</option>${["male", "female"].map(g => `<option value="${g}"${P.gender === g ? " selected" : ""}>${t("g_" + g)}</option>`).join("")}</select></label>
      <label>${t("bio")} <small>${t("bioNote")}</small><textarea name="bio" rows="4" required minlength="20" maxlength="600">${esc(pub.bio || "")}</textarea></label>
      <button class="btn wide">${t(next ? "saveContinue" : "save")}</button>
    </form></div>`;
  $("#pubForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); Object.keys(f).forEach(k => f[k] = String(f[k]).trim());
    const bd = +f.bd, bm = +f.bm, by = +f.by, dt = new Date(Date.UTC(by, bm - 1, bd));
    f.birth = bd && bm && by && dt.getUTCDate() === bd ? `${by}-${String(bm).padStart(2, "0")}-${String(bd).padStart(2, "0")}` : "";
    const digits = f.phone.replace(/\D/g, "");
    if (!/^\+?[\d\s-]+$/.test(f.phone) || digits.length < 7 || digits.length > 15) return toast(t("phoneBad"), true);
    if (!f.birth || f.birth < "1900-01-01" || f.birth > maxBirth) return toast(t("birthBad"), true);
    if (f.bio.length < 20) return toast(t("bioShort"), true);
    if (findBad(f.bio + " " + f.city, MOD_WORDS)) return toast(t("badWords"), true);
    if (!isSheikh() && hasLink(f.bio)) return toast(t("noLinks"), true);
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try {
      await setDoc(doc(db, "publishers", user.uid), { name: myName(), country: f.country, bio: f.bio, updatedAt: serverTimestamp() });
      if (f.gender !== "male" && f.gender !== "female") { btn.disabled = false; return toast(t("chooseGender"), true); }
      const priv = { phone: f.phone, country: f.country, city: f.city, birth: f.birth, gender: f.gender, publisher: true };
      await updateDoc(doc(db, "users", user.uid), priv);
      profile = { ...profile, ...priv }; toast(t("saved"));
      sessionStorage.removeItem("pubNext"); go(next || "/profile");
    } catch (err) { toast(errMsg(err), true); btn.disabled = false; }
  };
}

// ---------- publish / edit a book ----------
async function pageBookForm(editId) {
  if (!requireLogin()) return;
  if (isBanned()) return main().innerHTML = `<div class="empty">${t("bannedMsg")}</div>`;
  if (needsVerify()) return main().innerHTML = `<div class="empty">${t("verifyFirst")} <a href="/profile">${t("profile")}</a></div>`;
  if (!pubReady()) { sessionStorage.setItem("pubNext", location.pathname); return go("/publisher"); }
  let b = null;
  if (editId) {
    b = await getOne("books", editId); if (!b) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
    if (!isSheikh() && !(b.uid === user.uid && b.status === "pending")) return denied();
  }
  const v = k => esc(b?.[k] ?? ""), x = b?.extra || {};
  const opt = (val, label, cur) => `<option value="${val}"${cur === val ? " selected" : ""}>${label}</option>`;
  const subOpts = c => `<option value="">${t("chooseSub")}</option>` + (SUBCATS[c] || []).map(sc => opt(sc, t("sub_" + sc), b?.subcat)).join("");
  main().innerHTML = `<div class="card narrow"><div class="page-head"><h1>${b ? t("edit") + ": " + esc(b.title) : t("publishBook")}</h1></div>
    ${!isSheikh() && !b ? `<p class="muted">${t("bookReviewNote")}</p>` : ""}
    <form class="form" id="bkForm">
      <label>${t("bookTitle")}<input name="title" required maxlength="200" value="${v("title")}"></label>
      <label>${t("bookDesc")} <small class="red">${t("minDesc")}</small><textarea name="desc" rows="7" required minlength="50" maxlength="5000">${v("desc")}</textarea><small class="muted" id="descCount"></small></label>
      <div class="grid2">
        <label>${t("isAuthorQ")}<select name="isAuthor" required><option value="">${t("choose")}</option>${opt("yes", t("yesAuthor"), b?.isAuthor)}${opt("no", t("noAuthor"), b?.isAuthor)}</select></label>
        <label>${t("bookLang")}<select name="lang" required><option value="">${t("chooseLang")}</option>${BOOK_LANGS.map(l => opt(l, t("lang_" + l), b?.lang)).join("")}</select></label>
      </div>
      <label>${t("authorFull")} <small class="red">${t("fullName")}</small><input name="author" required maxlength="150" value="${v("author")}"></label>
      <div class="grid2">
        <label>${t("mainCat")}<select name="category" required><option value="">${t("chooseMain")}</option>${CATS.books.map(c => opt(c, t("cat_" + c), b?.category)).join("")}</select></label>
        <label>${t("subCat")}<select name="subcat" required>${subOpts(b?.category)}</select></label>
      </div>
      <div class="upbox"><b>⬆ ${t("coverUpload")}</b>${safeUrl(b?.cover) ? `<img class="cvprev" src="${safeUrl(b.cover)}" alt="">` : ""}<input type="file" id="cvFile" accept="image/*"><div class="upbar"><i id="cvBar"></i></div><small id="cvMsg" class="muted"></small></div>
      <label class="check"><input type="checkbox" name="readOnly"${b?.readOnly ? " checked" : ""}> <span>${t("readOnlyQ")} <small class="red">${t("readOnlyNote")}</small></span></label>
      <div class="upbox"><b>⬆ ${t("bookFile")}</b>${b?.url ? `<small class="muted">${t("currentFile")}</small>` : ""}<input type="file" id="bkFile" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        <div class="pdftools" id="pdfTools" hidden><b id="pdfSize"></b>
          <select id="cmpLevel" aria-label="${t("compressBtn")}"><option value="ebook">${t("cmpMid")}</option><option value="screen">${t("cmpStrong")}</option></select>
          <button type="button" class="btn ghost sm" id="cmpBtn">🗜 ${t("compressBtn")}</button><button type="button" class="btn sm" id="upNow">⬆ ${t("uploadBtn")}</button></div>
        <div class="upbar"><i id="bkBar"></i></div><small id="bkMsg" class="muted">${t("bookFileHint")}</small>
        ${isSheikh() ? `<label>${t("orFileUrl")} <small class="green">${t("optional")}</small><input name="fileUrlIn" type="url" dir="ltr" maxlength="1500" placeholder="https://"></label>` : ""}</div>
      ${isSheikh() ? `<div class="grid2"><label>${t("bookSource")} <small class="green">${t("optional")}</small><input name="source" maxlength="120" value="${v("source")}"></label><label>${t("bookSourceUrl")} <small class="green">${t("optional")}</small><input name="sourceUrl" type="url" dir="ltr" maxlength="500" value="${v("sourceUrl")}"></label></div>` : ""}
      <label class="check"><input type="checkbox" id="exTog"${Object.values(x).some(Boolean) ? " checked" : ""}> <span>${t("extraQ")} <small class="green">${t("optional")}</small></span></label>
      <div class="grid2 extra"${Object.values(x).some(Boolean) ? "" : " hidden"}>
        <label>${t("pages")}<input name="pages" type="number" min="1" max="100000" value="${esc(x.pages || "")}"></label>
        <label>${t("house")}<input name="house" maxlength="120" value="${esc(x.house || "")}"></label>
        <label>${t("year")}<input name="year" maxlength="20" value="${esc(x.year || "")}"></label>
        <label>${t("edition")}<input name="edition" maxlength="40" value="${esc(x.edition || "")}"></label>
      </div>
      <label class="check"><input type="checkbox" name="agree" required${b ? " checked" : ""}> <span>${t("agreeTerms")} <a href="/terms" target="_blank">${t("terms")}</a> · <a href="/privacy" target="_blank">${t("privacy")}</a></span></label>
      ${b || isSheikh() ? "" : capBox()}<button class="btn wide">⬆ ${b ? t("save") : t("publishBook")}</button>
    </form></div>`;
  const F = $("#bkForm"), save = $("#bkForm > button"), cap = captcha($("#bkForm .cf-box"));
  let fileUrl = b?.url || "", fileType = b?.fileType || "", coverUrl = b?.cover || "", busy = 0;
  const lock = d => { busy += d; save.disabled = busy > 0; };
  const dc = () => { $("#descCount").textContent = `${F.desc.value.trim().length} / 50+`; }; F.desc.oninput = dc; dc();
  F.category.onchange = () => { F.subcat.innerHTML = subOpts(F.category.value); };
  $("#exTog").onchange = e => { $(".extra", F).hidden = !e.target.checked; };
  const tooBig = r => /too large|file size|Maximum/i.test(r || "");
  $("#cvFile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return; const m = $("#cvMsg"), bar = $("#cvBar");
    if (!/^image\//.test(f.type)) { e.target.value = ""; return toast(t("fileType"), true); }
    lock(1); e.target.disabled = true;
    try { const u = await cloudUpload(f, "image", p => { bar.style.width = p + "%"; m.textContent = `${t("uploading")} ${p}%`; });
      coverUrl = u.replace("/image/upload/", "/image/upload/c_limit,w_600,q_auto,f_auto/"); m.textContent = t("coverDone"); }
    catch (err) { bar.style.width = "0"; m.textContent = tooBig(err.message) ? t("fileTooBigHost") : t("uploadFail"); }
    e.target.disabled = false; lock(-1);
  };
  const MB = 1048576, LIMIT = 10 * MB, mbs = n => (n / MB).toFixed(1);
  let pick = null;
  const upBook = async (f, isPdf) => {
    const m = $("#bkMsg"), bar = $("#bkBar"), inp = $("#bkFile");
    lock(1); inp.disabled = true; $("#pdfTools").hidden = true;
    try { fileUrl = await cloudUpload(f, isPdf ? "image" : "raw", p => { bar.style.width = p + "%"; m.textContent = `${t("uploading")} ${p}%`; });
      fileType = isPdf ? "pdf" : "doc"; m.textContent = t("bookFileDone"); }
    catch (err) { bar.style.width = "0"; m.textContent = tooBig(err.message) ? t("fileTooBigHost") : t("uploadFail"); if (isPdf) $("#pdfTools").hidden = false; }
    inp.disabled = false; lock(-1);
  };
  const showPick = () => {
    $("#pdfTools").hidden = false; $("#pdfSize").textContent = t("fileSize").replace("{mb}", mbs(pick.size));
    $("#bkMsg").textContent = pick.size > LIMIT ? t("needCompress") : t("cmpHint");
  };
  $("#bkFile").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf", isDoc = /\.docx?$/i.test(f.name);
    if (!isPdf && !isDoc) { e.target.value = ""; return toast(t("fileType"), true); }
    $("#bkBar").style.width = "0";
    if (isDoc) { $("#pdfTools").hidden = true; return upBook(f, false); }
    pick = f; showPick();
  };
  $("#upNow").onclick = () => {
    if (!pick) return;
    if (pick.size > LIMIT) return toast(t("needCompress"), true);
    upBook(pick, true);
  };
  $("#cmpBtn").onclick = async () => {
    if (!pick) return; const m = $("#bkMsg"), bar = $("#bkBar"), before = pick.size;
    lock(1); $$("#pdfTools button, #pdfTools select, #bkFile").forEach(x => x.disabled = true);
    m.textContent = t("cmpLoading"); bar.style.width = "0";
    try {
      const blob = await compressPdf(pick, $("#cmpLevel").value, p => { bar.style.width = p + "%"; m.textContent = `${t("compressing")} ${p}%`; });
      if (blob.size < before * 0.97) {
        pick = new File([blob], pick.name.replace(/\.pdf$/i, "") + ".pdf", { type: "application/pdf" });
        showPick(); m.textContent = t("cmpDone").replace("{a}", mbs(before)).replace("{b}", mbs(pick.size)).replace("{p}", Math.round((1 - pick.size / before) * 100))
          + (pick.size > LIMIT ? " — " + t("cmpStillBig") : "");
      } else { showPick(); m.textContent = t("cmpNoGain"); }
      bar.style.width = "100%";
    } catch (err) { console.error(err); bar.style.width = "0"; m.textContent = t("cmpFail"); }
    $$("#pdfTools button, #pdfTools select, #bkFile").forEach(x => x.disabled = false); lock(-1);
  };
  F.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    if (!cap.ok()) return toast(t("captchaNeed"), true);
    const g = k => String(F[k]?.value || "").trim();
    const data = { title: g("title"), desc: g("desc"), isAuthor: g("isAuthor"), lang: g("lang"), author: g("author"), category: g("category"), subcat: g("subcat"), readOnly: F.readOnly.checked };
    if (data.desc.length < 50) return toast(t("descShort"), true);
    const fu = isSheikh() && /^https:\/\//i.test(g("fileUrlIn")) ? g("fileUrlIn") : "";
    if (fu) { fileUrl = fu; fileType = /\.docx?(\?.*)?$/i.test(fu) ? "doc" : "pdf"; }
    if (!fileUrl) return toast(t("fileRequired"), true);
    if (!F.agree.checked) return toast(t("mustAgree"), true);
    const bad = isSheikh() ? null : (findBad([data.title, data.desc, data.author].join(" "), MOD_WORDS) ? t("badWords") : hasLink(data.title + " " + data.desc) ? t("noLinks") : null);
    if (bad) return toast(bad, true);
    data.extra = $("#exTog").checked ? { pages: g("pages"), house: g("house"), year: g("year"), edition: g("edition") } : {};
    data.url = fileUrl; data.fileType = fileType;
    if (isSheikh()) { data.source = g("source"); data.sourceUrl = g("sourceUrl"); }
    data.cover = coverUrl || (isCloudPdf(fileUrl) ? fileUrl.replace("/image/upload/", "/image/upload/pg_1,c_limit,w_600,q_auto/").replace(/\.pdf(\?.*)?$/i, ".jpg") : "");
    save.disabled = true;
    try {
      if (b) { await updateDoc(doc(db, "books", editId), { ...data, updatedAt: serverTimestamp() }); toast(t("saved")); go(`/books/${editId}`); }
      else {
        const st = isSheikh() ? "published" : "pending";
        const r = await addDoc(collection(db, "books"), { ...data, status: st, uid: user.uid, name: myName(), photo: myPhoto(), createdAt: serverTimestamp() });
        if (st === "published") bump("content"); toast(t(st === "published" ? "saved" : "bookSent")); go(`/books/${r.id}`);
      }
    } catch (err) { toast(errMsg(err), true); save.disabled = false; }
  };
}

// ---------- forum ----------
const threadItem = th => `<a class="item" href="/forum/${th.id}"><h3>${esc(th.title)}</h3><p>${excerpt(th.body, 120)}</p>${meta(th.name, th.createdAt, " " + catTag(th.category))}</a>`;
async function listForum() {
  const items = (await latest("threads", 300)).filter(x => isAdmin() || !isHidden(x));
  listPage({ titleKey: "forum", items, render: threadItem, side: secTicker("threads", items), cats: CATS.threads, action: isBanned() ? null : { href: "/new/thread", label: "+ " + t("newThread") } });
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
const linkify = x => nl(x).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow" dir="ltr">$1</a>');
const qName = q => q.showName === false ? t("anonymous") : q.name;
const fatwaItem = q => `<a class="item fatwa-item" href="/fatwa/${q.id}"><span class="qmark${q.num ? " qnum" : ""}">${q.num || "؟"}</span><div><h3>${esc(q.title || excerpt(q.body, 80))}</h3>
  <p>${excerpt(q.answer, 140)}</p>${meta(q.sheikhName ? t("answeredBy") + " " + q.sheikhName : "", q.answeredAt, " " + catTag(q.category))}</div></a>`;
// رسمة لكل قسم من أقسام الفتاوى (بدل الصور)
const FART = {
  ibadat: '<path d="M60 18c10 8 16 16 16 26H44c0-10 6-18 16-26z"/><rect x="38" y="44" width="44" height="34" rx="2"/><path d="M54 78V62a6 6 0 0 1 12 0v16"/><path d="M24 78V40l4-6 4 6v38M88 78V40l4-6 4 6v38"/><path d="M18 78h84"/>',
  muamalat: '<path d="M60 20v58M40 78h40"/><path d="M28 34h64"/><path d="M28 34 18 56h20zM92 34 82 56h20z"/><path d="M18 56a10 6 0 0 0 20 0M82 56a10 6 0 0 0 20 0"/><circle cx="60" cy="20" r="4"/>',
  family: '<path d="M22 50 60 20l38 30"/><path d="M30 44v34h60V44"/><circle cx="50" cy="56" r="5"/><circle cx="70" cy="56" r="5"/><path d="M42 78c0-8 4-12 8-12s8 4 8 12M62 78c0-8 4-12 8-12s8 4 8 12"/>',
  aqeedah: '<path d="M70 22a26 26 0 1 0 14 46 22 22 0 1 1-14-46z"/><path d="m82 30 2.6 5.4 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.9z"/>',
  other: '<path d="M20 28c14-4 28-2 40 6 12-8 26-10 40-6v48c-14-4-28-2-40 6-12-8-26-10-40-6z"/><path d="M60 34v48"/>'
};
const fatwaArt = c => `<div class="fart fart-${FART[c] ? c : "other"}"><svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${FART[c] || FART.other}</svg><span>${t("cat_" + (FART[c] ? c : "other"))}</span></div>`;
const fMeta = q => `<div class="fmeta"><span title="${t("date")}">📅 ${fmtDate(q.answeredAt)}</span><span title="${t("views")}">👁 ${fmtN(q.views)}</span><span title="${t("fatwaNo")}">☰ ${q.num || ""}</span></div>`;
const fatwaCard = q => `<article class="fcard"><a href="/fatwa/${q.id}"><h3>${esc(q.title || excerpt(q.body, 80))}</h3></a>
  <p>${excerpt(q.body, 230)} <a class="fmore" href="/fatwa/${q.id}">${t("more")}</a></p>${fMeta(q)}</article>`;
async function listFatwa() {
  const items = await answeredFatwas(5000);
  items.forEach((q, i) => q.num = items.length - i);
  const feat = items.slice(0, 5);
  const top = feat.length ? `<section class="fslider" id="fsl">${feat.map((q, i) => `<div class="fslide${i ? "" : " on"}">
      <div class="fs-txt"><a href="/fatwa/${q.id}"><h2>${esc(q.title || excerpt(q.body, 80))}</h2></a><p>${excerpt(q.body, 420)} <a class="fmore" href="/fatwa/${q.id}">${t("more")}</a></p></div>
      ${fatwaArt(q.category)}${fMeta(q)}</div>`).join("")}
    <div class="fdots">${feat.map((_, i) => `<button class="${i ? "" : "on"}" data-i="${i}" aria-label="${i + 1}"></button>`).join("")}</div></section>` : "";
  const side = `<section class="side-box"><h3 class="sb-h">${icon("fatwa", "ic sb-ic")}${t("searchFatwa")}</h3>
      <form id="fsForm" class="fs-form"><div class="fs-in"><input name="q" type="search" placeholder="${t("searchWords")}"><button class="btn sm">🔍</button></div>
        <div class="rads"><span><input type="radio" id="byT" name="by" value="text" checked><label for="byT">${t("byText")}</label></span><span><input type="radio" id="byN" name="by" value="num"><label for="byN">${t("byNumber")}</label></span></div></form></section>
    <section class="side-box"><h3 class="sb-h">${icon("books", "ic sb-ic")}${t("topics")}</h3>
      <div class="topic-grid"><button class="topic on" data-side-cat="all">📁 ${t("all")} <i>${items.length}</i></button>${CATS.questions.map(c => `<button class="topic" data-side-cat="${c}">📁 ${t("cat_" + c)} <i>${items.filter(q => q.category === c).length}</i></button>`).join("")}</div></section>
    ${secTicker("questions", items, "latestFatwas")}`;
  const ctl = listPage({ titleKey: "fatwa", countKey: "fatwaCount", items, render: fatwaCard, cats: CATS.questions, chipsHidden: true, top, side, action: { href: "/ask", label: t("ask") } });
  $$("[data-side-cat]").forEach(b => b.onclick = () => ctl.setCat(b.dataset.sideCat));
  $("#fsForm").onsubmit = e => {
    e.preventDefault(); const v = e.target.q.value.trim();
    if (e.target.by.value === "num") { const n = v.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)); const q = items.find(x => String(x.num) === n); return q ? go("/fatwa/" + q.id) : toast(t("noFatwaNum"), true); }
    ctl.setQ(v);
  };
  const sl = $("#fsl"); if (sl && feat.length > 1) {
    let i = 0, hold = false; const show = n => { i = n; $$(".fslide", sl).forEach((x, k) => x.classList.toggle("on", k === n)); $$(".fdots button", sl).forEach((x, k) => x.classList.toggle("on", k === n)); };
    $$(".fdots button", sl).forEach(b => b.onclick = () => show(+b.dataset.i));
    sl.onmouseenter = () => hold = true; sl.onmouseleave = () => hold = false;
    const my = routeId, tm = setInterval(() => { if (my !== routeId || !document.body.contains(sl)) return clearInterval(tm); if (!hold) show((i + 1) % feat.length); }, 6000);
  }
}
async function viewFatwa(id) {
  const q = await getOne("questions", id); if (!q) return main().innerHTML = `<div class="empty">${t("notFound")}</div>`;
  const done = q.status === "answered";
  main().innerHTML = `<article class="card article"><div class="crumb"><a href="/fatwa">${t("fatwa")}</a> ${catTag(q.category)}</div>
    <h1>${esc(q.title || t("question"))}</h1>
    <div class="qa q"><div class="qa-label">${t("question")}</div><div class="prose">${nl(q.body)}</div>${meta(qName(q), q.createdAt)}</div>
    ${done ? `<div class="qa a"><div class="qa-label">${t("answer")}</div><div class="prose">${linkify(q.answer)}</div>
      <div class="meta">${t("answeredBy")} <b>${esc(q.sheikhName)}</b> · ${fmtDate(q.answeredAt)}${q.views ? ` · 👁 ${fmtN(q.views)}` : ""}</div></div>`
      : `<div class="status pending">${t("pending")}</div>`}
    ${isSheikh() ? `<details class="edit-ans"${done ? "" : " open"}><summary>${done ? t("editAnswer") : t("publishAnswer")}</summary>
      <form class="form" id="ansForm"><textarea name="answer" rows="8" required>${esc(q.answer || "")}</textarea><button class="btn">${t("publishAnswer")}</button></form></details>` : ""}
    <div class="actions">${user && (isAdmin() || (q.uid === user.uid && !done)) ? `<button class="btn ghost sm danger" id="delItem">${t("delete")}</button>` : ""}</div>
    </article>${done ? `<section class="card" id="cm"></section>` : ""}`;
  bindDel("questions", id, "/fatwa");
  const af = $("#ansForm");
  if (af) af.onsubmit = async e => { e.preventDefault(); await answerQuestion(q, af.answer.value, q.title); viewFatwa(id); };
  if (done) { bumpOnce("questions", id, "views"); await comments($("#cm"), "questions", id); }
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
      ${capBox()}<button class="btn wide">${t("send")}</button></form></div>`;
  const cap = captcha($("#askForm .cf-box"));
  $("#askForm").onsubmit = async e => {
    e.preventDefault();
    if (!cap.ok()) return toast(t("captchaNeed"), true);
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
    xhr.onload = () => { let r = {}; try { r = JSON.parse(xhr.responseText); } catch {} if (r.secure_url) return ok(r.secure_url); fail(new Error(r.error?.message || "upload")); };
    xhr.onerror = () => fail(new Error("upload"));
    xhr.send(fd);
  });
}

// التحقق من أن المستخدم إنسان (Cloudflare Turnstile) — يظهر فقط إذا وُضع siteKey في config.js
let tsLoad;
const loadTurnstile = () => tsLoad ||= new Promise((ok, fail) => {
  const sc = document.createElement("script"); sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; sc.async = true;
  sc.onload = () => ok(window.turnstile); sc.onerror = () => { tsLoad = null; fail(new Error("turnstile")); }; document.head.appendChild(sc);
});
function captcha(box) {
  const st = { token: "", failed: false };
  if (!CAPTCHA?.siteKey || !box) return { ok: () => true, reset() {} };
  loadTurnstile().then(ts => {
    if (!box.isConnected) return;
    st.id = ts.render(box, { sitekey: CAPTCHA.siteKey, language: lang, theme: "light",
      callback: tk => { st.token = tk; }, "expired-callback": () => { st.token = ""; }, "error-callback": () => { st.token = ""; } });
  }).catch(() => { st.failed = true; });
  return { ok: () => st.failed || !!st.token, reset() { st.token = ""; try { window.turnstile.reset(st.id); } catch {} } };
}
const capBox = () => CAPTCHA?.siteKey ? `<div class="cf-box"></div>` : "";

// ضغط الفيديو والصوت داخل المتصفح (WebCodecs عبر مكتبة Mediabunny) — يُخرج MP4 للفيديو و M4A للصوت
let mbLib;
async function compressMedia(file, isAudio, level, onProgress) {
  const M = await (mbLib ||= import("https://cdn.jsdelivr.net/npm/mediabunny@1/+esm"));
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: "in-memory" }), target: new M.BufferTarget() });
  const strong = level === "strong", opts = {};
  if (isAudio) {
    opts.video = { discard: true };
    opts.audio = { bitrate: strong ? 40e3 : 64e3, ...(strong ? { numberOfChannels: 1 } : {}), forceTranscode: true };
  } else {
    const vt = await input.getPrimaryVideoTrack(); if (!vt) throw new Error("no video");
    const w = vt.displayWidth, h = vt.displayHeight, target = strong ? 480 : 720, short = Math.min(w, h);
    const scale = short > target ? target / short : 1;
    opts.video = { width: Math.round(w * scale / 2) * 2, bitrate: strong ? 350e3 : 900e3, forceTranscode: true };
    opts.audio = { bitrate: strong ? 48e3 : 96e3, forceTranscode: true };
  }
  const conv = await M.Conversion.init({ input, output, ...opts });
  if (conv.isValid === false) throw new Error("invalid conversion");
  conv.onProgress = p => onProgress?.(Math.min(99, Math.round(p * 100)));
  await conv.execute();
  const buf = output.target.buffer;
  const base = file.name.replace(/\.[^.]+$/, "");
  return new File([buf], base + (isAudio ? ".m4a" : ".mp4"), { type: isAudio ? "audio/mp4" : "video/mp4" });
}

// ضغط PDF داخل المتصفح (عامل منفصل حتى لا تتجمّد الصفحة)
function compressPdf(file, level, onProgress) {
  return new Promise(async (ok, fail) => {
    let w; try { w = new Worker("/compress-worker.js?v=1", { type: "module" }); } catch (e) { return fail(e); }
    w.onmessage = e => { const m = e.data; if (m.progress != null) return onProgress?.(m.progress); w.terminate(); m.ok ? ok(new Blob([m.out], { type: "application/pdf" })) : fail(new Error(m.error)); };
    w.onerror = e => { w.terminate(); fail(new Error(e.message || "worker")); };
    const buf = await file.arrayBuffer(); w.postMessage({ data: buf, level }, [buf]);
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
  if (type === "book") return pageBookForm(editId);
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
      ? `<div class="upbox" data-kind="${f.upload}"><b>${t(au ? "uploadAudio" : "uploadVideo")}</b>${au && item?.url ? `<small class="muted">${t("currentFile")}</small><audio controls preload="none" src="${safeUrl(item.url)}"></audio>` : ""}<input type="file" id="upFile" accept="${au ? "audio/*" : "video/*"}">
        <div class="pdftools" id="mTools" hidden><b id="mSize"></b>
          <select id="mLevel" aria-label="${t("compressBtn")}"><option value="mid">${t(au ? "mCmpMidA" : "mCmpMidV")}</option><option value="strong">${t(au ? "mCmpStrongA" : "mCmpStrongV")}</option></select>
          <button type="button" class="btn ghost sm" id="mCmp">🗜 ${t(au ? "compressAudio" : "compressVideo")}</button><button type="button" class="btn sm" id="mUp">⬆ ${t(au ? "uploadAudioBtn" : "uploadVideoBtn")}</button></div>
        <div class="upbar"><i id="upBar"></i></div><small id="upMsg" class="muted">${t("uploadHint").replace("{mb}", UPLOAD.maxMB || 100)}</small></div>`
      : `<small class="muted">${t("uploadSoon")}</small>`);
  };
  main().innerHTML = `<div class="card narrow"><h1>${item ? t("edit") + ": " + esc(item.title) : t(F.title)}</h1><form class="form" id="newForm">${F.fields.map(field).join("")}${!item && !F.staff ? capBox() : ""}<button class="btn wide">${t("save")}</button></form></div>`;
  const cap = captcha($("#newForm .cf-box"));
  const up = $("#upFile");
  if (up) {
    const au = up.closest(".upbox").dataset.kind === "audio", MB = 1048576, mb = UPLOAD.maxMB || 100, LIM = mb * MB, mbs = n => (n / MB).toFixed(1);
    const msg = $("#upMsg"), bar = $("#upBar"), save = $("#newForm > button"), tools = $("#mTools");
    let pick = null;
    const ctl = d => { $$("#mTools button, #mTools select").forEach(x => x.disabled = d); up.disabled = d; save.disabled = d; };
    const show = () => { tools.hidden = false; $("#mSize").textContent = t("fileSizeM").replace("{mb}", mbs(pick.size)); };
    up.onchange = () => {
      const f = up.files[0]; if (!f) return;
      pick = f; bar.style.width = "0"; show();
      msg.textContent = f.size > LIM ? t("mNeedCompress").replace("{mb}", mb) : t("mCmpHint");
    };
    $("#mUp").onclick = async () => {
      if (!pick) return;
      if (pick.size > LIM) return toast(t("mNeedCompress").replace("{mb}", mb), true);
      ctl(true); tools.hidden = true;
      try {
        const url = await cloudUpload(pick, "video", p => { bar.style.width = p + "%"; msg.textContent = `${t("uploading")} ${p}%`; });
        $("#newForm [name=url]").value = url; msg.textContent = t(au ? "audioDone" : "uploadDone"); bar.style.width = "100%";
      } catch { msg.textContent = t(au ? "audioFail" : "uploadFail"); bar.style.width = "0"; tools.hidden = false; }
      ctl(false);
    };
    $("#mCmp").onclick = async () => {
      if (!pick) return; const before = pick.size;
      ctl(true); bar.style.width = "0"; msg.textContent = t("cmpLoading");
      try {
        const out = await compressMedia(pick, au, $("#mLevel").value, p => { bar.style.width = p + "%"; msg.textContent = `${t("compressing")} ${p}%`; });
        if (out.size < before * 0.97) {
          pick = out; show();
          msg.textContent = t("cmpDoneM").replace("{a}", mbs(before)).replace("{b}", mbs(out.size)).replace("{p}", Math.round((1 - out.size / before) * 100))
            + (out.size > LIM ? " — " + t("mStillBig") : "");
        } else { msg.textContent = t("mNoGain"); }
        bar.style.width = "100%";
      } catch (err) { console.error(err); bar.style.width = "0"; msg.textContent = t("mCmpFail"); }
      ctl(false);
    };
  }
  $("#newForm").onsubmit = async e => {
    e.preventDefault();
    if (!cap.ok()) return toast(t("captchaNeed"), true);
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
      ${capBox()}<button class="btn wide">${t("send")}</button></form></div>`;
  const cap = captcha($("#ctForm .cf-box"));
  $("#ctForm").onsubmit = async e => {
    e.preventDefault();
    if (!cap.ok()) return toast(t("captchaNeed"), true);
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
  UTC: ["توقيت عالمي UTC (خوادم غالباً)", "UTC time (mostly servers)", "🖥️"], XX: ["غير معروف", "Unknown", "🌍"] };
const ccFlag = c => /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map(x => 0x1F1A5 + x.charCodeAt(0))) : "🌍";
const _dn = {}; const regionName = (c, l) => { try { return (_dn[l] ||= new Intl.DisplayNames([l], { type: "region" })).of(c); } catch { return c; } };
const ccName = c => CC_NAME[c] ? CC_NAME[c][lang === "ar" ? 0 : 1] : /^[A-Z]{2}$/.test(c) ? regionName(c, lang === "ar" ? "ar" : "en") : CC_NAME.XX[lang === "ar" ? 0 : 1];
const ccLabel = c => `${CC_NAME[c] ? CC_NAME[c][2] : ccFlag(c)} ${ccName(c)}`;
const ccLabelHtml = c => /^[A-Z]{2}$/.test(c) ? `<img class="flag" src="https://flagcdn.com/w40/${c.toLowerCase()}.png" alt="" loading="lazy" onerror="this.remove()"> ${esc(ccName(c))}` : esc(ccLabel(c));
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
    const listBox = (rows, label, total, max = 10) => rows.length ? rows.slice(0, max).map(([k, v]) => `<div class="srow"><span>${label(k)}</span><b>${v}</b><i style="width:${Math.round(v / total * 100)}%"></i></div>`).join("") : `<div class="empty sm">${t("noData")}</div>`;
    const csAll = merge(cur, "countries"), bots = (csAll.find(([k]) => k === "BOT") || [0, 0])[1], cs = csAll.filter(([k]) => k !== "BOT"), ps = merge(cur, "pages"), ds = merge(cur, "devices");
    const vTot = sum(cur, "visitors") || 1, pTot = sum(cur, "views") || 1;
    main().innerHTML = `<div class="page-head"><h1>${icon("stats", "ic")} ${t("stats")}</h1>
        <div class="chips">${[7, 28, 90].map(r => `<button class="chip${r === range ? " on" : ""}" data-r="${r}">${t("lastDays").replace("{n}", r)}</button>`).join("")}</div></div>
      <div class="kpis">${kpis.map(([f, k]) => `<div class="kpi"><small>${t(k)}</small><b>${sum(cur, f).toLocaleString()}</b>${delta(f)}</div>`).join("")}</div>
      <div class="card"><div class="page-head"><h3>${t("statViews")} / ${t("statVisitors")}</h3><small class="muted">${t("today")}: ${today.views || 0} · ${today.visitors || 0}</small></div>
        <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>
        <div class="chart-x"><span>${cur[0].id}</span><span>${cur[cur.length - 1].id}</span></div>
        <div class="legend"><span><i class="bar"></i>${t("statViews")}</span><span><i class="bar2"></i>${t("statVisitors")}</span></div></div>
      <div class="stats-grid">
        <div class="card"><h3>${t("statCountries")} <small class="muted">(${cs.filter(([k]) => /^[A-Z]{2}$/.test(k)).length})</small></h3><div class="cscroll">${listBox(cs, ccLabelHtml, vTot, 60)}</div>${bots ? `<p class="muted small-note">🤖 ${t("statBots")}: <b>${bots}</b></p>` : ""}</div>
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
  let mb = []; try { mb = (await getDocs(query(collection(db, "books"), where("uid", "==", user.uid), limit(200)))).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)); } catch (e) { console.warn(e); }
  const r = isAdmin() ? "admin" : role();
  main().innerHTML = `<div class="card narrow profile">
      <div class="author-row">${avatar(myName(), myPhoto(), 88)}<div><h1>${esc(myName())}</h1><div class="meta" dir="ltr">${esc(user.email || "")}</div>
      <span class="badge ${r}">${t("role_" + r)}</span></div></div>
      ${canUpload() ? `<div class="photo-row"><label class="btn ghost sm">${t("changePhoto")}<input type="file" id="phFile" accept="image/*" hidden></label>${myPhoto() ? `<button class="btn ghost sm danger" id="phDel">${t("removePhoto")}</button>` : ""}<small class="muted" id="phMsg"></small></div>` : ""}
      ${needsVerify() ? `<div class="verify-box"><p>${t("verifyBox")}</p><div class="row-btns"><button class="btn sm" id="vDone">${t("verifyDone")}</button><button class="btn ghost sm" id="vResend">${t("verifyResend")}</button></div></div>` : ""}
      <form class="form inline" id="nameForm"><label>${t("name")}<input name="name" value="${esc(myName())}" required maxlength="60"></label><button class="btn sm">${t("save")}</button></form>
      <button class="btn ghost sm danger" id="outBtn">${t("logout")}</button>
    </div>
    <div class="card narrow"><div class="page-head"><h2>${t("myBooks")}</h2><div class="row-btns"><a class="btn ghost sm" href="/publisher">${t("publisherInfo")}</a> <a class="btn sm" href="/new/book">+ ${t("publishBook")}</a></div></div>
      ${mb.length ? `<div class="list">${mb.map(b => `<a class="item row" href="/books/${b.id}"><h3>${esc(b.title)}</h3><span class="status ${b.status === "published" ? "answered" : "pending"}">${t("st_" + (b.status || "published"))}</span></a>`).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`}</div>
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
      if (profile?.publisher) updateDoc(doc(db, "publishers", user.uid), { name }).catch(() => {});
      profile = { ...profile, name, nameKey: nameKey(name) }; renderShell(); toast(t("saved")); pageProfile();
    } catch (err) { toast(errMsg(err), true); }
  };
}

// ---------- sheikh panel ----------
async function pagePanel() {
  if (!requireLogin()) return; if (!isSheikh()) return denied();
  const s = await getDocs(query(collection(db, "questions"), where("status", "==", "pending"), limit(300)));
  const qs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  let pb = []; try { pb = (await getDocs(query(collection(db, "books"), where("status", "==", "pending"), limit(200)))).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(a.createdAt) - ms(b.createdAt)); } catch (e) { console.warn(e); }
  main().innerHTML = `
    <div class="page-head"><h1>${t("panel")}</h1></div>
    <details class="card qa-new"><summary><b>+ ${t("readyFatwa")}</b> <small class="muted">${t("readyFatwaNote")}</small></summary>
      <form class="form" id="qaForm">
        <label>${t("category")}<select name="category">${CATS.questions.map(c => `<option value="${c}">${t("cat_" + c)}</option>`).join("")}</select></label>
        <label>${t("qTitle")}<input name="title" required maxlength="200"></label>
        <label>${t("question")}<textarea name="body" rows="4" required maxlength="5000"></textarea></label>
        <label>${t("answer")}<textarea name="answer" rows="9" required></textarea></label>
        <label>${t("answeredByLbl")} <small class="muted">${t("answeredByHint")}</small><input name="by" maxlength="120" placeholder="${esc(myName())}"></label>
        <button class="btn">${t("publishAnswer")}</button>
      </form></details>
    <h2 class="sub">${t("pendingBooks")} (${pb.length})</h2>
    ${pb.length ? `<div class="list">${pb.map(b => `<div class="item row pbk" data-id="${b.id}"><a href="/books/${b.id}"><h3>${esc(b.title)}</h3><div class="meta">${esc(b.author)} · ${t("publisher")}: ${esc(b.name)} · ${fmtDate(b.createdAt)} ${catTag(b.category)}</div></a>
      <div class="row-btns"><button class="btn sm" data-ap>${t("approve")}</button><button class="btn ghost sm danger" data-bdel>${t("delete")}</button></div></div>`).join("")}</div>` : `<div class="empty sm">${t("empty")}</div>`}
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
  bindPendingBooks();
  $("#qaForm").onsubmit = async e => {
    e.preventDefault(); const f = e.target, btn = $("button", f); btn.disabled = true;
    const g = k => String(f[k].value || "").trim();
    try {
      const r = await addDoc(collection(db, "questions"), { title: g("title"), body: g("body"), category: f.category.value, uid: user.uid, name: myName(), showName: false, status: "pending", createdAt: serverTimestamp() });
      await updateDoc(doc(db, "questions", r.id), { answer: g("answer"), status: "answered", sheikhUid: user.uid, sheikhName: g("by") || myName(), answeredAt: serverTimestamp() });
      bump("questions"); toast(t("saved")); f.reset();
    } catch (err) { toast(errMsg(err), true); }
    btn.disabled = false;
  };
  $$(".pq").forEach(card => {
    const q = qs.find(x => x.id === card.dataset.id), f = $("form", card);
    f.onsubmit = async e => { e.preventDefault(); $("button", f).disabled = true;
      try { await answerQuestion(q, f.answer.value, f.title.value); card.remove(); } catch { $("button", f).disabled = false; } };
    const d = $("[data-del]", card);
    if (d) d.onclick = async () => { if (!confirm(t("confirmDelete"))) return;
      try { await deleteDoc(doc(db, "questions", q.id)); card.remove(); } catch (e) { toast(errMsg(e), true); } };
  });
}

function bindPendingBooks() {
  $$(".pbk").forEach(row => {
    const id = row.dataset.id;
    $("[data-ap]", row).onclick = async () => { try { await approveBook(id); row.remove(); } catch {} };
    $("[data-bdel]", row).onclick = async () => { if (!confirm(t("confirmDelete"))) return; try { await deleteDoc(doc(db, "books", id)); row.remove(); } catch (e) { toast(errMsg(e), true); } };
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
