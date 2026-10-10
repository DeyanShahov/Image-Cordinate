# Технологи за проверка на техници (Technician Verification Feature)

## Общ преглед

Добавен е пълноценен модул за управление на техници с реално-времева синхронизация през Firestore, интегриран в системата за вход и serviced информацията на снимките.

## Основни компоненти

### 1. `src/modules/technicians.js` — Core Service
- **Real-time listener** на Firestore колекция `technicians` (поле `active: true`)
- In-memory кэш с авто-сортиране по име (localeCompare)
- Observer pattern за уведомяване на подписчици при промени
- Fallback към one-time fetch при грешка на real-time listener
- **READ-ONLY** дизайн — админ функции са премахнати (управление през Firebase Console)

Експортирани функции:
- `matchTechnician(username, technicianName)` — case-insensitive exact match
- `findTechnicianByUsername(username)` — намира техник по username
- `getActiveTechnicians()` / `getAllTechnicians()`
- `subscribeToTechnicians(callback)` — subscribe за UI updates
- `initializeTechnicians()` — инициализация (еднократна, idempotent)
- `cleanup()` — за app shutdown

### 2. `src/modules/auth.js` — Login Integration
- `login(username, password)` веднага инициализира technicians и проверява за match
- Връща `{ user, error, matchedTechnician }` — техникът е наличен при успешен вход
- Username се превръща в email: `username@gmail.com`

### 3. `src/modules/app-shell.js` — Session Management
- `initAuthListener()` — подписва се на auth state changes
- При вход: `await initializeTechnicians()` → `findTechnicianByUsername()` → запомня `matchedTechnician`
- `getMatchedTechnician()` — достъп до текущия-matched техник за останалите модули

### 4. `src/modules/ui.js` — Service Info Panel
- **Locked technician field**: ако потребителят е matched техник, полето "Техник" е disabled, стойността е pinned, се показва 🔒 иконка
- **Quick-select checkboxes**: преддефиниран списък (Anatoliy, Alex, Deyan, Todor, Stoqn, Tony)
  - Locked техникът е авто-checked + disabled + визуално маркиран (dashed border, opacity, 🔒 суфикс)
  - Останалите се комбинират в полето "Техник" (запетаи)
- `initServiceToggle(refs, { lockedTechnician })` — инициализира панела с lock логика
- `renderServiceInfo()` / `collectServiceInfo()` / `resetServicePanel()` — пълна работа с формата
- Persistence в `localStorage` под ключ `serviceInfo`

### 5. `src/main.js` — Orchestration
- Инициализира technicians при старт на приложението (след login)
- Предава `lockedTechnicianName` към `ui.initServiceToggle()`
- При запис в галерията (`saveToGallery`) включва `serviceInfo` в записа
- При отваряне от галерията (`openGalleryItem`) възстановява `serviceInfo`

### 6. Firebase/Firestore Config
- `src/config/firestore.js` — инициализация на `db`, `auth` с Vite env vars (fallback към публичен config)
- `firestore.rules` — временно pravilo (изтича 2026-11-04), тррябва да се обнови преди expiration
- `firestore.indexes.json` — за composite queries (ако се добавят)
- `scripts/seed-firestore.mjs` / `verify-firestore.mjs` — за попълване/проверка на колекцията

## Поток на данни (Data Flow)

```
1. User enters username/password → auth.login()
2. auth.login() → initializeTechnicians() (Firestore listener starts)
3. auth.login() → findTechnicianByUsername(username) → matchedTechnician
4. app-shell.initAuthListener() → onAuthStateChanged → matchedTechnician stored
5. main.js initializeApp() → tech.initializeTechnicians() → lockedTechnicianName
6. ui.initServiceToggle(refs, { lockedTechnician: lockedTechnicianName })
7. User takes photo → review card shows service panel with locked technician
8. saveToGallery() → ui.collectServiceInfo() → includes locked technician → stored in IndexedDB
```

## Firestore структура (колекция `technicians`)

```javascript
{
  name: "Alex",           // string, уникално (case-insensitive match)
  active: true,           // boolean, само активни се виждат в приложението
  createdAt: Timestamp    // server timestamp
}
```

## Стилове (app.css) — Нови класове

- `.service-checkbox.is-locked` — визуално за заключен техник
- `.service-input:disabled` — стил за locked technician input
- `.locked-indicator` — 🔒 иконка до label
- `.service-technicians` fieldset с checkbox group

## Тестване

1. Добавете документи в Firestore колекция `technicians` с имена, съвпадащи с usernames (напр. `alex`, `anatoliy`, `deyan`...)
2. Влезте в приложението с username `alex` → трябва да се match-не техника "Alex"
3. В review card → "Служебна информация" → полето "Техник" е disabled със стойност "Alex" + 🔒
4. Checkbox "Alex" е checked + disabled + dashed border
5. Изберете допълнителни техници от checkbox-овете → се добавят в полето "Техник"
6. Запазете в галерията → serviceInfo се записва с фотото

## Забележки за развитие

- **Admin UI липсва** — управлявайте техниците през Firebase Console или Admin SDK
- **Security rules** — текущите са permissive с expiration; актуализирайте преди 2026-11-04
- **Composite indexes** — ако добавите филтри по повече полета, актуализирайте `firestore.indexes.json`
- **Case-insensitive match** — работи за кирилица и латиница, но изисква точен match (няма fuzzy search)
- **Offline** — real-time listener не работи offline; fallback fetch опитва да зареди кэша