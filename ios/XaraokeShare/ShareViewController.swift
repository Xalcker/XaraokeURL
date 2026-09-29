// Share Extension: "Compartir → Xaraoke" desde la app de YouTube (o el navegador).
// Equivalente al intent-filter ACTION_SEND + handleIntent de android/.../MainActivity.kt.
//
// Recibe el texto o URL compartido, extrae el id del video de YouTube (reutiliza youtubeVideoId de
// Core, que debe añadirse también a este target en Xcode) y abre la app anfitriona con
// xaraoke://share?video=<id>. La app confirma y lo descarga/encola.
//
// Configuración en Xcode (Fase 4):
//   - Target "Share Extension".
//   - En su Info.plist, NSExtensionActivationRule que acepte una URL o texto (p. ej.
//     NSExtensionActivationSupportsWebURLWithMaxCount = 1 y ...TextWithMaxCount = 1).
//   - Añadir Core/JoinLink.swift (que contiene youtubeVideoId) a este target.

import UIKit
import UniformTypeIdentifiers
import Social

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        Task { await handleShare() }
    }

    private func handleShare() async {
        guard let item = (extensionContext?.inputItems.first as? NSExtensionItem),
              let providers = item.attachments else {
            return finish()
        }
        // Busca una URL o un texto entre lo compartido.
        var shared: String?
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    shared = url.absoluteString
                    break
                }
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    shared = text
                    break
                }
            }
        }
        guard let shared, let videoId = youtubeVideoId(shared) else {
            return finish()
        }
        openHost(videoId: videoId)
        finish()
    }

    // Abre la app anfitriona. Las extensiones no pueden usar UIApplication.shared directamente, así
    // que se sube por la jerarquía de responders hasta encontrar quien pueda abrir la URL.
    private func openHost(videoId: String) {
        guard let url = URL(string: "xaraoke://share?video=\(videoId)") else { return }
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = current.next
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
