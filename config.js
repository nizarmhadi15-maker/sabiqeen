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

// 2) المدير يُحدَّد من قاعدة البيانات (users/<uid>.role = "admin") — لا تضع بريداً هنا
export const ADMIN_EMAILS = [];

// 3) اسم الموقع وشعاره
export const SITE = {
  name: { ar: "مكتبة السابقين", en: "Al-Sabiqeen Library" },
  tagline: {
    ar: "منصّة إسلامية للعلم والفتوى والحوار",
    en: "An Islamic platform for knowledge, fatwa and discussion"
  },
  contactEmail: "nizarhron1@gmail.com",
  defaultLang: "ar"
};

// 4) رفع الفيديوهات (Cloudinary — مجاني 25GB). اتركها فارغة لإخفاء زر الرفع.
export const UPLOAD = {
  cloudName: "",      // اسم الحساب في Cloudinary
  videoPreset: "",    // اسم Upload preset (Unsigned)
  maxMB: 100          // أقصى حجم للفيديو في الخطة المجانية
};
