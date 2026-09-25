# Image Coordinate 📍📷

Модерно уеб приложение (PWA), което използва **камерата на телефона директно от браузъра**
и показва **GPS координатите, на които е направена снимката** — в реално време, върху снимката
(воден знак) и като **EXIF GPS тагове вътре в JPEG файла**.

Всичко се обработва **локално на устройството**: няма сървър, няма качване, няма акаунти.

---

## Възможности

| Функция | Детайли |
|---|---|
| **Live камера** | `MediaDevices.getUserMedia` + превключване предна/задна камера, светкавица и zoom (при поддръжка) |
| **GPS HUD в реално време** | DD координати, DMS, точност ±m с цветен индикатор, надм. височина, „преди колко секунди е fix-ът“ |
| **Заснемане** | `ImageCapture.takePhoto()` за пълен кадър (Chrome/Android) и автоматичен fallback `<video>` → `canvas` за iOS Safari |
| **Хибриден режим** | `<input capture="environment">` → нативната камера за максимална резолюция (важно за iPhone) + четене на EXIF-а на устройството с `exifr` |
| **EXIF GPS запис** | `piexif-ts`: GPS IFD, дата/час, точност (`GPSHPositioningError`), обработващ метод; съществуващият EXIF се запазва (merge, без пре-енкод) |
| **Верификация** | След записа координатите се четат обратно с `exifr` и се сравняват (показва Δ в метри) |
| **Воден знак (по избор)** | Координати + DMS + точност + височина + час + адрес, „изгорени“ в пикселите |
| **Карта** | Leaflet + OpenStreetMap: маркер, кръг на точността, popup |
| **Обратен геокодинг** | Nominatim → адрес на български, с кеш (памет + IndexedDB) и спазване на rate limit-а |
| **Галерия** | IndexedDB (`idb-keyval`): миниатюри, отваряне, изтриване — работи офлайн |
| **Споделяне** | Web Share API с файла (Android/iOS) + fallback за изтегляне и копиране на координатите |
| **PWA** | Manifest, service worker (`vite-plugin-pwa`), инсталируемо на home screen, офлайн shell |
| **Wake Lock** | Екранът не заспива, докато снимаш |

---

## 1. Изисквания

### ⚠️ HTTPS е задължителен (secure context)
Камерата (`getUserMedia`) и GPS-ът (`Geolocation`) **работят само в secure context**:
`https://` **или** `http://localhost`. На телефон, отворен по `http://192.168.x.x`, браузърът
ще блокира и двете.

> Страница с **невалиден сертификат** (self-signed след „Proceed anyway“) **не е** secure
> context — затова `@vitejs/plugin-basic-ssl` не е достатъчен за реален тест на телефон.

### Софтуер
- Node.js **≥ 22.12** (проверено с v22.16.0), Git.
- В **Windows PowerShell** `npm.ps1` може да е блокиран от Execution Policy — използвай
  `npm.cmd ...` или веднъж: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Инсталация

```powershell
npm.cmd install          # или: npm install
npm.cmd run icons        # генерира PWA иконките (без зависимости, чист Node)
```

---

## 2. Пускане

```powershell
npm.cmd run dev          # http://localhost:5173  (работи за тест на компютъра)
npm.cmd run build        # production build в dist/
npm.cmd run preview      # преглед на build-а
npm.cmd test             # Vitest (24 теста: координати + EXIF round-trip)
```

### Тестване на реален телефон — избери един от вариантите

| Вариант | Как | Бележки |
|---|---|---|
| **A. Тунел (най-бързо)** | `cloudflared tunnel --url http://localhost:5173` | Валиден сертификат, нищо не се конфигурира по телефона. Идеално за iPhone. |
| **B. mkcert (локално, без интернет)** | `mkcert -install` → `mkcert <LAN-IP>` → пусни с `HTTPS_KEY`/`HTTPS_CERT` (виж по-долу) | Сертификатът трябва да е **доверен на телефона** (инсталиране на root CA). |
| **C. Деплой** | `npm run build` → качи `dist/` в Cloudflare Pages / Netlify / Vercel / GitHub Pages | HTTPS идва от хостинга; най-близо до реална употреба. |
| D. Android Chrome (само за разработка) | `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → добави `http://<LAN-IP>:5173` | Работи само в Chrome/Android, не и в Safari. |

```powershell
# Вариант B (mkcert), PowerShell:
cd certs                            # създай папката, тя е в .gitignore
mkcert -install
mkcert 192.168.1.50 localhost 127.0.0.1
cd ..
$env:HTTPS_KEY="certs\192.168.1.50+2-key.pem"; $env:HTTPS_CERT="certs\192.168.1.50+2.pem"
npm.cmd run dev -- --host
```

След това отвори `https://<LAN-IP>:5173` на телефона и приеме разрешенията за
**камера** и **местоположение**.

---

## 3. Как се използва

1. **„Разреши камера и GPS“** → браузърът пита за камера и локация. GPS-ът вече се е
   „загрял“ при зареждане, за да има fix веднага.
2. Насочи камерата: HUD-ът горе показва координатите и точността в реално време.
3. **Затворът (◉)** замразява координатите **в момента на натискане** и прави снимката.
4. Резултатът показва: снимка, координати (DD + DMS), точност, височина, адрес, карта,
   статус на EXIF-а и бутони:
   - **Изтегли** — geotagged JPEG с име `IMG_20260925_101112_41.887234_24.712345.jpg`
   - **Сподели** — native share sheet с файла
   - **Копирай координати**, **Отвори в OSM**, **Google Maps**
   - **Запази в галерията** (IndexedDB) / **Нова снимка**
5. **„Снимай с нативната камера“** — отваря камерата на телефона (максимална резолюция).
   Приложението чете EXIF-а на устройството и/или добавя твоя GPS fix.

### Проверка на резултата
- На телефона: отвори снимката в галерията → „Информация“/„Детайли“ → виж картата.
- На компютър: качи файла в EXIF viewer (напр. exif.tools) или пусни
  `readExifSummary`/`gpsFromBlob` от `src/modules/exif.js`.
- Самото приложение показва реда **„EXIF GPS: записан и проверен (Δ 0.00 m)“**.

---

## 4. Структура на проекта

```
index.html                  app shell (video stage, HUD, review, gallery, toast)
src/
  main.js                   оркестрация: състояния, заснемане, действия, wiring
  state.js                  observable store (phase, camera, gps, fix, result)
  styles/                   tokens.css · base.css · app.css (dark/light, dvh, safe-area)
  utils/
    coords.js               DD↔DMS, EXIF rationals, формати, линкове, име на файл
    binary.js               Blob ↔ binary string (chunked!), Blob ↔ base64
    image.js                decodeImage, createCanvas, createThumbnail, canvasToBlob
    exifr.js                нормализиране на exifr (UMD/ESM) + readGps/readMetadata
    dom.js · errors.js      DOM помощници; човешки съобщения за грешки (BG)
  modules/
    camera.js               MediaStream, ImageCapture→canvas capture, torch/zoom
    geolocation.js          watchPosition, fix обект, haversine, fix age
    exif.js                 writeGeoExif (piexif-ts) + verifyGps/readExifSummary (exifr)
    watermark.js            изгаряне на координати/час/адрес в пикселите
    map.js                  Leaflet + OSM, маркер, кръг на точност
    geocode.js              Nominatim reverse + опашка (1.2 s) + кеш
    native-capture.js       input[capture] → File + EXIF на устройството
    storage.js              IndexedDB: галерия + geocode кеш
    share.js                download / Web Share / clipboard
    wakelock.js             Screen Wake Lock
    ui.js                   цялата DOM замяна и рендер
public/
  icon.svg                  favicon
  icons/                    генерирани PNG (192, 512, maskable, apple-touch)
scripts/make-icons.mjs      чист Node PNG енкодер + self-check
tests/                      Vitest: coords.test.js, exif.test.js
vite.config.js              PWA плъгин + опционален локален HTTPS
```

---

## 5. Как работи (технически)

- **Заснемане, два пътя към един интерфейс `{ blob, source }`**
  1. `ImageCapture.takePhoto()` — пълен JPEG still (Chrome/Edge/Android).
  2. `<video>` → `canvas.toBlob('image/jpeg', 0.95)` — единственият вариант в **iOS Safari**,
     който не имплементира ImageCapture. Предната камера се огледално обръща, за да съвпада
     с превюто.
- **EXIF запис без загуба на качество**: `piexif.load()` прочита съществуващия APP1 блок,
  таговете се merge-ват (запазват се Make/Model/Orientation на устройството) и
  `piexif.insert()` подменя само EXIF сегмента — **пикселите не се пипат**.
  Ако е включен воден знак, снимката се пре-енкодира през canvas (кап 4096 px) и тогава
  `Orientation` се нулира на 1.
- **Координати**: `GPSLatitude/Longitude` като 3 rational-а с 4 знака след секундата
  (`[41,1],[53,1],[140424,10000]`), `GPSLatitudeRef/LongitudeRef`, `GPSAltitude(+Ref)`,
  `GPSTimeStamp`/`GPSDateStamp` в UTC, `GPSHPositioningError` = точността в метри,
  `GPSProcessingMethod` (`"ASCII\0\0\0GPS (Image Coordinate 1.0)"`).
- **Верификация**: след записа `exifr.gps()` чете файла обратно, изчислява се разстоянието
  (haversine) и UI-ът показва „проверен (Δ x.xx m)“ или причината.
- **Кеширане на адреса**: `Nominatim /reverse?format=jsonv2&addressdetails=1`, сериализирана
  опашка ≥1.2 s, кеш в паметта + IndexedDB (30 дни), тих fallback при офлайн/429.

---

## 6. Ограничения и бележки

- **iOS Safari**: няма `ImageCapture` → кадърът е видео кадър (по-ниско качество от нативната
  камера). За максимално качество използвай **„Снимай с нативната камера“**.
- **Nominatim** е публичен и безплатен с rate limit 1 заявка/сек и изисква атрибуция
  (видима е във футъра). За продукция: self-hosted Nominatim или платен доставчик.
- **Точност на GPS**: на закрито може да е 50–500 m; индикаторът става жълт/червен.
  Приложението снима и **без fix** (файлът остава без GPS тагове, UI-ът предупреждава).
- **HEIC**: ако нативната камера върне HEIC, EXIF записът се пропуска с ясно съобщение
  (пишем само в JPEG); координатите пак се показват в UI-а.
- **Маркерите на Leaflet**: използва се `divIcon` (CSS pin), за да няма проблеми с asset
  пътищата при bundling.
- **Иконите** са генерирани програмно (`npm run icons`), така че проектът няма бинарни
  зависимости за картини.

---

## 7. Отстраняване на проблеми

| Симптом | Причина / решение |
|---|---|
| Банер „Страницата не е в secure context“ | Отвори през `https://` или `localhost` (виж §2). |
| „Достъпът до камерата е отказан“ | Разреши камерата от иконата до адреса или Настройки → браузър → Камера, после презареди. |
| „Камерата е заета“ | Друго приложение/таб използва камерата — затвори го. |
| GPS: отказан / недостъпен | Разреши Location за браузъра; на iOS включи Location Services; излез на открито. |
| Тъмна/черна картина на iPhone | Провери, че `<video>` има `playsinline muted autoplay` (вече е в `index.html`). |
| `npm` не се изпълнява в PowerShell | Използвай `npm.cmd` или `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| `vite-plugin-mkcert` отказва инсталация | Версия 2 изисква Node ≥ 22.19 — ползвай mkcert CLI (Вариант B) или вдигни Node. |

---

## 8. Атрибуция и лиценз

- Карти и геокодиране: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
  [Nominatim](https://nominatim.org/).
- Библиотеки: [Leaflet](https://leafletjs.com/) (BSD-2), [exifr](https://github.com/MikeKovarik/exifr) (MIT),
  [piexif-ts](https://github.com/holwech/piexif-ts) (MIT), [idb-keyval](https://github.com/jakearchibald/idb-keyval) (Apache-2.0).

Координатите и снимките **никога не напускат устройството** (освен ако не ги споделиш
изрично). Кодът в това репо е примерен проект — използвай го свободно.
