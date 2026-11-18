// ===== الإشراف التلقائي =====
// الكلمات الافتراضية — يمكن للمدير تعديلها من صفحة «الإدارة» دون تعديل هذا الملف.
export const DEFAULT_WORDS = [
  // عربي
  "شرموط", "شرموطة", "شرموطه", "شراميط", "عرص", "معرص", "منيوك", "منيوكة", "منيك", "نيك", "ينيك", "انيك",
  "كسمك", "كس امك", "كس اختك", "كس", "زب", "زبي", "طيز", "قحبة", "قحبه", "قحاب", "خول",
  "ابن الكلب", "ابن كلب", "يا كلب", "ابن الحرام", "ابن حرام", "يلعن ابوك", "يلعن امك", "يلعن دينك", "يلعن ربك",
  "ابن الشرموطة", "ابن القحبة", "يا حمار", "يا حيوان", "يا واطي",
  // English
  "fuck", "fucking", "fucker", "shit", "bitch", "asshole", "bastard", "dick", "pussy", "whore", "slut", "cunt", "porn", "motherfucker"
];

// توحيد الكتابة العربية حتى لا يُتحايل على الفلتر بالتشكيل أو التطويل أو تكرار الحروف
export function normalize(s) {
  return String(s || "").toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")      // التشكيل والتطويل
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/(.)\1{2,}/g, "$1")                       // تكرار الحرف أكثر من مرتين
    .replace(/[^\p{L}\p{N}\s]/gu, " ")                  // الرموز بين الحروف
    .replace(/\s+/g, " ");
}

const SHORT = 3; // الكلمات القصيرة تُفحص ككلمة كاملة فقط حتى لا تحذف كلمات بريئة (مثل: زبيب، كسرة)

export function findBad(text, words) {
  const n = " " + normalize(text) + " ";
  // حروف إنجليزية مفصولة مثل f.u.c.k أو s h i t
  const spaced = (String(text || "").toLowerCase().match(/(?:\b[a-z]\b[^a-z]{0,3}){3,}/g) || []).map(x => x.replace(/[^a-z]/g, ""));
  for (const raw of words) {
    const w = normalize(raw).trim(); if (!w) continue;
    if (/^[a-z ]+$/.test(w)) { if (n.includes(" " + w + " ") || spaced.some(x => x.includes(w))) return raw; continue; }
    if (w.length <= SHORT || w.includes(" ")) { if (n.includes(" " + w + " ")) return raw; }
    else if (n.includes(w)) return raw;
  }
  return null;
}

export const hasLink = text => /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|info|xyz|ly|me|io|co)\b|t\.me\/|wa\.me\/)/i.test(String(text || ""));

// نمط RE2 يُحفظ في قاعدة البيانات لتطبّقه قواعد Firebase نفسها (حماية من التحايل على الموقع)
export function buildPattern(words) {
  const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clean = [...new Set(words.map(w => String(w).trim().toLowerCase()).filter(Boolean))];
  const isShort = w => w.length <= SHORT || w.includes(" ") || /^[a-z ]+$/.test(w);
  const long = clean.filter(w => !isShort(w)).map(esc);
  const short = clean.filter(isShort).map(esc);
  const parts = [];
  if (long.length) parts.push(`(${long.join("|")})`);
  if (short.length) parts.push(`(^|[^\\p{L}])(${short.join("|")})([^\\p{L}]|$)`);
  return parts.length ? `(?s).*(${parts.join("|")}).*` : "(?s)$^";
}

export const HIDE_AFTER_REPORTS = 3;   // عدد البلاغات التي تُخفي المحتوى تلقائياً
export const COOLDOWN_SEC = 20;        // ثوانٍ بين كل مشاركة وأخرى لمنع الإغراق
