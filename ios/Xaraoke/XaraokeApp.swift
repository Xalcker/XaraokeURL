// Punto de entrada de la app. Crea el AppController (que vive lo que vive la app), lo enlaza a la
// pantalla y reacciona al volver a primer plano y a los enlaces xaraoke:// (los QR llegan por el
// escáner en la Fase 4).
// Equivalente a android/.../XaraokeApp.kt + MainActivity.kt

import SwiftUI

@main
struct XaraokeApp: App {
    @StateObject private var controller = AppController(notifier: Notifications.shared)
    @Environment(\.scenePhase) private var scenePhase
    // Recibe el device token de APNs (Fase 5).
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            AppRoot(controller: controller)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    // Primero, la vuelta del inicio de sesión con Google (su propio esquema).
                    if GoogleSignIn.handle(url) { return }
                    // Compartir desde la Share Extension: xaraoke://share?video=<id o url>
                    if let videoId = sharedVideoId(from: url) {
                        controller.shareVideo(videoId)
                        return
                    }
                    // Enlace propio (xaraoke://unirse?servidor=...&sala=ABCD) o el QR del host como URL.
                    if let link = parseJoinText(url.absoluteString) {
                        controller.openJoinLink(link)
                    }
                }
                // Al entrar a una sala se pide permiso de notificaciones (aviso con app cerrada).
                .onReceive(controller.$room.map { $0 != nil }.removeDuplicates()) { inRoom in
                    guard inRoom else { return }
                    Task {
                        if await !Notifications.shared.canNotify() {
                            let granted = await Notifications.shared.requestAuthorization()
                            if !granted { controller.showToast(L("notifications_denied")) }
                        }
                    }
                }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { controller.onAppForeground() }
        }
    }

    // De xaraoke://share?video=<id|url>: acepta un id de 11 chars directo o un enlace de YouTube.
    private func sharedVideoId(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "xaraoke", url.host == "share" else { return nil }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        guard let raw = comps?.queryItems?.first(where: { $0.name == "video" })?.value else { return nil }
        // Puede venir el id ya extraído o el enlace completo.
        return youtubeVideoId(raw) ?? (raw.count == 11 ? raw : nil)
    }
}
