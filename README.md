# مكتبة السابقين — موقع إسلامي (Firebase + GitHub Pages)

## الأقسام
- تسجيل دخول بجوجل أو بالبريد + إنشاء حساب + استعادة كلمة المرور
- المقالات (مع تعليقات) — يضيفها المشايخ
- الصوتيات (مشغّل + تحميل + تعليقات) — روابط mp3
- الكتب (غلاف + قراءة + تحميل + تعليقات) — روابط PDF
- المنتدى (أي عضو يفتح موضوعاً والبقية يردّون)
- الفتاوى: العضو يسأل ← السؤال يصل للوحة المشايخ ← الشيخ يجيب ← يُنشر للعامة
- الإدارة: أنت تعطي أي حساب صلاحية «شيخ» أو «مدير»
- عربي / إنجليزي بزر واحد

## خطوات التشغيل
1. أنشئ مشروعاً جديداً في https://console.firebase.google.com
2. Build > Authentication > Get started > فعّل **Google** و **Email/Password**
3. Authentication > Settings > Authorized domains > أضف: `nizarmhadi15-maker.github.io`
4. Build > Firestore Database > Create database (Production mode)
5. Firestore > Rules: الصق محتوى `firestore.rules` ثم Publish
6. Project settings > Your apps > أضف Web app (</>) وانسخ القيم إلى `config.js`
7. ارفع الملفات إلى مستودع جديد على GitHub ثم Settings > Pages > Deploy from branch: main / root
8. افتح الموقع وسجّل الدخول، ثم من Firestore > users افتح سجلك وغيّر role إلى admin — ستظهر لك «الإدارة» و«لوحة المشايخ»

## رفع الصوتيات والكتب مجاناً
Firebase Storage صار يحتاج بطاقة، لذلك الموقع يأخذ **روابط**:
- archive.org: ارفع الملف ثم انسخ رابط التحميل المباشر (ينتهي بـ .mp3 أو .pdf)
- أو مستودع GitHub منفصل للملفات (حتى 100MB للملف)
