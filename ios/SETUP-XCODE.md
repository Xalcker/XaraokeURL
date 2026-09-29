# Guion: crear el proyecto Xcode para la app iOS de Xaraoke

Paso a paso para montar el proyecto a partir del código ya escrito en `ios/`. Los archivos fuente, los `Info.plist` y los entitlements ya existen; aquí solo se crean el proyecto y sus tres targets, se les asignan los archivos y se activan las capacidades.

Requisitos: Xcode instalado y activo (`xcode-select -p` debe apuntar a `.../Xcode.app`), cuenta Apple Developer para probar en un iPhone real y para push.

Convenciones:
- **Bundle ID base:** `xyz.xalcker.xaraoke` (igual que Android).
- **Deployment target:** iOS 16.0 (la app); iOS 16.1 para el widget (Live Activity).
- Al añadir archivos, **desmarca "Copy items if needed"** (ya están en `ios/`) y marca solo el target correcto en "Add to targets".

---

## 1. Crear el proyecto

1. Xcode → **File → New → Project… → iOS → App**.
2. Product Name: `Xaraoke`. Interface: **SwiftUI**. Language: **Swift**. Storage: none. Marca "Include Tests".
3. Organization Identifier: `xyz.xalcker` (queda Bundle ID `xyz.xalcker.xaraoke`).
4. Guárdalo **dentro de `ios/`** (misma carpeta que `Xaraoke/`). Si Xcode crea una subcarpeta `Xaraoke/` propia, apúntalo a la existente o mueve luego los archivos; lo importante es que el `.xcodeproj` quede en `ios/`.
5. En el target **Xaraoke → General**: Minimum Deployments = **iOS 16.0**.
6. Borra los archivos que Xcode genera y que vamos a reemplazar por los nuestros:
   - **Elimina `ContentView.swift`** (mover a papelera).
   - **Elimina el `XaraokeApp.swift` generado** por Xcode: usaremos el nuestro (tiene el `@main` y el `@UIApplicationDelegateAdaptor`). Si dejas los dos, habrá dos `@main` y no compila.
   - Deja el `Assets.xcassets` que generó (lo usaremos para el logo y los íconos).

---

## 2. Añadir los archivos de la app

En el navegador de proyecto, selecciona el grupo del target `Xaraoke` y **File → Add Files to "Xaraoke"…**. Añade, con **solo el target Xaraoke marcado** y **sin copiar**:

Raíz del target:
- `Xaraoke/XaraokeApp.swift`
- `Xaraoke/AppDelegate.swift`
- `Xaraoke/AppController.swift`

Carpetas (añádelas como grupos, arrastrando la carpeta entera):
- `Xaraoke/Core/` → 6 archivos: `JoinLink`, `Models`, `Reconnect`, `Songs`, `TourLayout`, `TurnTracker`
- `Xaraoke/Net/` → 3: `CookiePersistence`, `HttpClient`, `ServerApi`
- `Xaraoke/Room/` → 6: `Notifications`, `PushRegistration`, `RoomActivity`, `RoomActivityManager`, `RoomConnection`, `RoomState`
- `Xaraoke/UI/` → 10: `AppRoot`, `GoogleSignIn`, `JoinScreen`, `QRScanner`, `QueuePanel`, `RoomScreen`, `SearchPanel`, `Strings`, `Theme`, `TourView`

> `RoomActivity.swift` va **también** al target del widget (paso 6). Márcalo en ambos.

### Info.plist y entitlements de la app
- Target **Xaraoke → Build Settings** → busca `INFOPLIST_FILE` y apúntalo a `Xaraoke/Info.plist`. (O borra el Info.plist generado y usa el nuestro.)
- Target **Xaraoke → Signing & Capabilities** → `CODE_SIGN_ENTITLEMENTS` = `Xaraoke/Xaraoke.entitlements` (se enlaza solo al añadir la capacidad Push, ver paso 7).

---

## 3. Target de tests (Fase 1)

Si marcaste "Include Tests" al crear el proyecto, ya hay un target `XaraokeTests`.
1. Borra el archivo de test de ejemplo que generó Xcode.
2. **Add Files…** con **solo el target `XaraokeTests` marcado**:
   - `XaraokeTests/CoreTests.swift`
   - `XaraokeTests/TourLayoutTests.swift`
3. `XaraokeTests` debe tener a `Xaraoke` como dependencia (Xcode lo pone al crear el target de tests). Los tests usan `@testable import Xaraoke`.
4. `Cmd+U` → deben pasar 21 tests. (Ya verificados fuera de Xcode: 21/21.)

---

## 4. Assets (logo, íconos, sonido)

1. **Logo:** en `Assets.xcassets`, nuevo Image Set llamado `logo`. Usa `public/img/logo.svg` (o un PNG exportado). `JoinScreen` hace `Image("logo")`.
2. **App Icon:** arrastra un ícono 1024×1024 al `AppIcon` (puedes partir de `public/img/icon-512.png` reescalado).
3. **Sonido del aviso de turno:** convierte `public/notification.mp3` a CAF y añádelo al bundle del target `Xaraoke` como `turn_alert.caf`:
   ```bash
   afconvert public/notification.mp3 ios/Xaraoke/turn_alert.caf -d ima4 -f caff
   ```
   Luego **Add Files…** ese `turn_alert.caf` al target `Xaraoke`. (Si no lo añades, el aviso usa el sonido por defecto: funciona igual.)

---

## 5. Paquete GoogleSignIn (solo si el servidor usa Google)

Si tu servidor corre con `DISABLE_GOOGLE_AUTH=true`, **salta este paso**: el login por nombre no lo necesita y `GoogleSignIn.swift` compila igual (está tras `#if canImport(GoogleSignIn)`).

Con Google:
1. **File → Add Package Dependencies…** → `https://github.com/google/GoogleSignIn-iOS` → añade el producto **GoogleSignIn** al target `Xaraoke`.
2. En **Google Cloud Console**, en el mismo proyecto del `GOOGLE_CLIENT_ID` del servidor, crea un **OAuth Client ID de tipo iOS** con Bundle ID `xyz.xalcker.xaraoke`. Descarga su `GoogleService-Info.plist`.
3. En `Xaraoke/Info.plist`, sustituye los marcadores:
   - `<GID_CLIENT_ID>` → el `CLIENT_ID` iOS (`...apps.googleusercontent.com`).
   - `<REVERSED_CLIENT_ID>` → el `REVERSED_CLIENT_ID` (`com.googleusercontent.apps....`).

---

## 6. Target del Widget (Live Activity — Fase 5)

1. **File → New → Target… → iOS → Widget Extension**. Product Name: `XaraokeWidget`. **Desmarca** "Include Live Activity" (traemos el código) y **desmarca** "Include Configuration App Intent".
2. Borra los archivos que genera el target.
3. **Add Files…** con **solo el target `XaraokeWidget` marcado** (sin copiar):
   - `XaraokeWidget/RoomActivityWidget.swift`
   - `XaraokeWidget/XaraokeWidgetBundle.swift`
   - `Xaraoke/Room/RoomActivity.swift`  ← **también** en este target (los atributos son compartidos)
   - `Xaraoke/Core/Models.swift`
   - `Xaraoke/Core/Songs.swift`
   - `Xaraoke/UI/Strings.swift`
4. Target `XaraokeWidget` → Minimum Deployments = **iOS 16.1**.
5. `INFOPLIST_FILE` = `XaraokeWidget/Info.plist`.
6. Bundle ID: `xyz.xalcker.xaraoke.XaraokeWidget` (por defecto queda así).

> Para compartir los mismos `.swift` entre app y widget sin duplicar, la alternativa limpia es marcar cada uno de esos archivos "compartidos" con **membership en ambos targets** (selector "Target Membership" del inspector de archivo), en vez de añadirlos dos veces.

---

## 7. Target de la Share Extension (Fase 4)

1. **File → New → Target… → iOS → Share Extension**. Product Name: `XaraokeShare`.
2. Borra los archivos generados (incluido su `MainInterface.storyboard` si aparece; nuestra extensión no usa UI).
3. **Add Files…** con **solo el target `XaraokeShare` marcado**:
   - `XaraokeShare/ShareViewController.swift`
   - `Xaraoke/Core/JoinLink.swift`  ← **también** aquí (trae `youtubeVideoId`)
4. `INFOPLIST_FILE` = `XaraokeShare/Info.plist`.
5. En ese `Info.plist`, revisa que `NSExtensionPrincipalClass` sea `XaraokeShare.ShareViewController` (el prefijo es el nombre del módulo del target; ajústalo si difiere).
6. Bundle ID: `xyz.xalcker.xaraoke.XaraokeShare`.

---

## 8. Capacidades (target Xaraoke → Signing & Capabilities)

Con tu equipo de firma seleccionado, pulsa **+ Capability** y añade:
- **Push Notifications** → enlaza `Xaraoke.entitlements` (`aps-environment`).
- **Background Modes** → marca **Remote notifications**.
- **Live Activities** ya se habilita con `NSSupportsLiveActivities` en el Info.plist (no hay capability aparte).

En **Apple Developer** (para push real): crea una **key APNs (.p8)**. La usa el **servidor**, no la app; configúrala con las variables `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (ver `ios/README.md`).

---

## 9. Compilar y correr

1. Selecciona el esquema `Xaraoke` y un **iPhone Simulator**.
2. `Cmd+B` (build), `Cmd+R` (run). En Simulator funciona todo menos lo que necesita hardware.
3. Para el servidor local: el Simulator llega a `127.0.0.1`/`localhost` directo (no hace falta el `adb reverse` de Android). Arranca el servidor (`npm start`), en la app escribe la dirección (p. ej. `127.0.0.1:8081`) o pulsa Unirse, y prueba.

### Qué se valida en Simulator vs iPhone real

| Función | Simulator | iPhone real |
|---|---|---|
| UI, unirse, sala, cola, buscador, YouTube | ✅ | ✅ |
| WebSocket + REST al servidor local | ✅ | ✅ (misma red / servidor accesible) |
| Deep link `xaraoke://` | ✅ (`xcrun simctl openurl booted "xaraoke://unirse?servidor=http%3A%2F%2F127.0.0.1%3A8081&sala=ABCD"`) | ✅ |
| Escáner de QR (cámara) | ❌ (no hay cámara) | ✅ |
| Vibración / haptics del aviso | ❌ | ✅ |
| Notificaciones locales | ✅ | ✅ |
| Live Activity (se ve) | ✅ (parcial) | ✅ |
| Entrega de push APNs (turno con app cerrada) | ⚠️ limitado | ✅ |
| Google Sign-In | ✅ (normalmente) | ✅ |

---

## 10. Orden recomendado la primera vez

1. Pasos 1–3 → build y `Cmd+U` (tests del Core en verde).
2. Paso 4 (logo/íconos) → la pantalla de inicio se ve bien.
3. Arranca el servidor con `DISABLE_GOOGLE_AUTH=true` y prueba unirse por nombre en Simulator.
4. Pasos 6–7 (widget y share) cuando quieras esas piezas.
5. Paso 5 (Google) y 8 (push + APNs en el servidor) al final, contra un iPhone real.

Referencia de configuración por fase: `ios/README.md`.
