// La raíz de la interfaz: elige entre unirse y la sala, y monta las confirmaciones, el aviso de
// "descargando" y los mensajes breves (toasts).
// Equivalente a android/.../ui/AppRoot.kt

import SwiftUI

// Una pregunta de confirmación. `stillValid` la cierra sola si deja de tener sentido mientras está
// abierta (por ejemplo, la canción que se iba a saltar ya terminó), igual que en el remoto web.
struct ConfirmRequest: Identifiable {
    let id = UUID()
    let message: String
    let confirmLabel: String
    var danger: Bool = false
    var stillValid: (RoomState?) -> Bool = { _ in true }
    var onDismiss: () -> Void = {}
    var onConfirm: () -> Void
}

// Estado compartido de la UI: la confirmación abierta, el "descargando" y el toast.
@MainActor
final class UIState: ObservableObject {
    @Published var confirm: ConfirmRequest?
    @Published var busy = false
    @Published var toast: String?

    func requestConfirm(_ request: ConfirmRequest) { confirm = request }

    func runBusy(_ work: @escaping () async -> Void) {
        Task {
            busy = true
            await work()
            busy = false
        }
    }

    func showToast(_ message: String) {
        toast = message
        let shown = message
        Task {
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            if toast == shown { toast = nil }
        }
    }
}

struct AppRoot: View {
    @ObservedObject var controller: AppController
    @StateObject private var ui = UIState()
    @State private var showScanner = false
    // Cada petición de inicio de sesión con Google que ya se atendió (evita reabrirlo al redibujar).
    @State private var handledSignIn = 0

    var body: some View {
        GradientBackground {
            ZStack {
                if let room = controller.room {
                    RoomScreen(controller: controller, state: room)
                } else {
                    JoinScreen(controller: controller, session: controller.session, onScan: { showScanner = true })
                }
            }
            .environmentObject(ui)

            // Toast (mensaje breve) abajo.
            if let toast = ui.toast {
                VStack {
                    Spacer()
                    Text(toast)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .background(Brand.surfaceStrong, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(.white)
                        .padding(.bottom, 32)
                        .shadow(radius: 8)
                }
                .transition(.opacity)
            }

            // Aviso de descarga en curso: no se cierra tocando fuera.
            if ui.busy {
                Color.black.opacity(0.4).ignoresSafeArea()
                HStack(spacing: 16) {
                    ProgressView()
                    Text(L("yt_downloading"))
                }
                .padding(.horizontal, 24).padding(.vertical, 20)
                .background(Brand.surfaceStrong, in: RoundedRectangle(cornerRadius: 24))
            }
        }
        .animation(.default, value: ui.toast)
        // Los toasts del controlador se muestran aquí.
        .onReceive(controller.$toast.compactMap { $0 }) { message in
            ui.showToast(message)
            controller.clearToast()
        }
        // Escáner de QR (Fase 4). En Simulator reporta "no disponible".
        .sheet(isPresented: $showScanner) {
            QRScannerSheet { result in
                switch result {
                case .text(let value):
                    if let link = parseJoinText(value) { controller.openJoinLink(link) }
                    else { controller.showToast(L("scan_not_found")) }
                case .unavailable:
                    controller.showToast(L("scan_unavailable"))
                case .cancelled:
                    break
                }
            }
        }
        // Inicio de sesión con Google cuando el controlador lo pide (una vez por pedido).
        .onReceive(controller.$session.map(\.googleSignInRequest).removeDuplicates()) { request in
            guard request != 0, request != handledSignIn else { return }
            handledSignIn = request
            guard let clientId = controller.session.auth?.googleClientId else { return }
            let domain = controller.session.auth?.allowedDomain
            Task {
                switch await GoogleSignIn.signIn(serverClientId: clientId, allowedDomain: domain) {
                case .token(let idToken): controller.onGoogleIdToken(idToken)
                case .cancelled: controller.onGoogleSignInFailed(nil)
                case .failed: controller.onGoogleSignInFailed(L("login_failed"))
                }
            }
        }
        // Video compartido desde YouTube: se confirma cuando ya hay sala.
        .onChange(of: shareTrigger) { _ in presentShareIfReady() }
        .onAppear { presentShareIfReady() }
        // Una confirmación que ya no aplica se cierra sola.
        .onReceive(controller.$room) { room in
            if let c = ui.confirm, !c.stillValid(room) { ui.confirm = nil }
        }
        .alert(item: $ui.confirm) { request in
            Alert(
                title: Text(request.message),
                primaryButton: request.danger
                    ? .destructive(Text(request.confirmLabel), action: request.onConfirm)
                    : .default(Text(request.confirmLabel), action: request.onConfirm),
                secondaryButton: .cancel(Text(L("confirm_cancel")), action: request.onDismiss)
            )
        }
    }

    private var shareTrigger: String { "\(controller.pendingShare ?? "")-\(controller.room != nil)" }

    private func presentShareIfReady() {
        guard let share = controller.pendingShare, controller.room != nil else { return }
        ui.requestConfirm(ConfirmRequest(
            message: L("share_confirm"),
            confirmLabel: L("confirm_add"),
            onDismiss: { controller.clearPendingShare() },
            onConfirm: {
                controller.clearPendingShare()
                ui.runBusy {
                    let result = await controller.downloadAndQueue(videoId: share, query: nil, suffix: nil)
                    if case .failure(let error) = result {
                        ui.showToast(controller.errorText(error, fallback: "yt_download_failed"))
                    }
                }
            }
        ))
    }
}
