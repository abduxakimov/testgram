# TestGram (Android)

Telegram guruh va kanallaridan testlarni (viktorina, PDF/Word fayllar, rasmlar, matnlar) Excel'ga yuklab oluvchi ilova.

## APK olish
GitHub → **Actions** → "Build APK" tugagach → **Releases** → `TestGram.apk`.

## Birinchi ishga tushirish
1. https://my.telegram.org → API development tools → `api_id`, `api_hash`.
2. Ilovaga kiriting, keyin telefon raqam + Telegram kodi bilan kiring.
3. Chatni tanlang → 📥 → Boshlash. Natija: `Documents/TestGram/...` papkasi va Excel'ni ulashish tugmasi.

## Dasturchi uchun
```
npm install
npm run dev            # brauzerda sinash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
```
Texnologiya: Vite + GramJS (MTProto) + SheetJS + Capacitor 8.
