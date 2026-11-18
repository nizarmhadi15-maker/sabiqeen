// ===== إعدادات الموقع — عدّل هذا الملف فقط =====

// 1) انسخ هذه القيم من: Firebase Console > Project settings > Your apps > Web app
export const firebaseConfig = {
  apiKey: "AIzaSyAX5zlnHQ0nD1HIY1NK1va7a_byxDNoc6I",
  authDomain: "mishkat-site.firebaseapp.com",
  projectId: "mishkat-site",
  storageBucket: "mishkat-site.firebasestorage.app",
  messagingSenderId: "713254935157",
  appId: "1:713254935157:web:f2f7e82526b81adabbf63c"
};

// 2) بريد المدير (أنت) — نفس البريد يجب وضعه في firestore.rules
export const ADMIN_EMAILS = ["nizarmhadi15@gmail.com"];

// 3) اسم الموقع وشعاره
export const SITE = {
  name: { ar: "مكتبة السابقين", en: "Al-Sabiqeen Library" },
  tagline: {
    ar: "منصّة إسلامية للعلم والفتوى والحوار",
    en: "An Islamic platform for knowledge, fatwa and discussion"
  },
  defaultLang: "ar"
};
