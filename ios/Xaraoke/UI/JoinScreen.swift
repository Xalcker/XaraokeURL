// Pantalla de entrada: servidor, luego sala (nombre o Google).
// Equivalente a android/.../ui/JoinScreen.kt
//
// El escaneo de QR real llega en la Fase 4 (Vision/DataScanner). Por ahora `onScan` está enlazado a
// un stub que avisa; toda la navegación por servidor/sala funciona sin cámara (código a mano).

import SwiftUI

struct JoinScreen: View {
    @ObservedObject var controller: AppController
    let session: SessionState
    var onScan: () -> Void = {}

    @State private var serverInput = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Image("logo")
                    .resizable().scaledToFit().frame(width: 96, height: 96)
                    .accessibilityHidden(true)

                VStack(spacing: 16) {
                    if session.serverUrl == nil {
                        serverStep
                    } else if session.loadingServer {
                        serverLine(session.serverUrl ?? "")
                        HStack(spacing: 12) {
                            ProgressView()
                            Text(L("server_connecting"))
                        }
                    } else if session.serverError != nil || session.auth == nil {
                        serverLine(session.serverUrl ?? "")
                        if let err = session.serverError { errorText(err) }
                        Button(action: controller.retryServer) {
                            Text(L("retry")).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        scanButton
                    } else {
                        roomStep
                    }
                }
                .frame(maxWidth: 480)
            }
            .padding(.horizontal, 24).padding(.vertical, 32)
        }
    }

    // --- pasos ---

    private var serverStep: some View {
        VStack(spacing: 16) {
            title(L("server_title"))
            Text(L("server_hint")).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            Button(action: scan) {
                Label(L("join_scan"), systemImage: "qrcode.viewfinder")
                    .font(.system(size: 17)).frame(maxWidth: .infinity).frame(height: 56)
            }
            .buttonStyle(.borderedProminent)
            Divider().overlay(Brand.muted)
            TextField(L("server_label"), text: $serverInput, prompt: Text(L("server_placeholder")))
                .textFieldStyle(.roundedBorder)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit { controller.setServer(serverInput) }
                .foregroundStyle(.black)
            if let err = session.serverError { errorText(err) }
            Button(action: { controller.setServer(serverInput) }) {
                Text(L("server_connect")).frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    @ViewBuilder
    private var roomStep: some View {
        if let auth = session.auth {
            serverLine(session.serverUrl ?? "")
            title(L("join_title"))

            if auth.google && session.myName == nil {
                Text(L("login_prompt")).multilineTextAlignment(.center).frame(maxWidth: .infinity)
                if let domain = auth.allowedDomain {
                    Text(L("login_domain_hint", domain))
                        .multilineTextAlignment(.center).foregroundStyle(Brand.muted).frame(maxWidth: .infinity)
                }
                Button(action: controller.requestGoogleSignIn) {
                    Label(L(session.signingIn ? "login_signing_in" : "login_google"), systemImage: "person.crop.circle")
                        .font(.system(size: 17)).frame(maxWidth: .infinity).frame(height: 56)
                }
                .buttonStyle(.borderedProminent)
                .disabled(session.signingIn)
                if let err = session.joinError { errorText(err) }
            } else {
                if auth.google {
                    HStack {
                        Text(L("signed_in_as", session.myName ?? "")).foregroundStyle(Brand.muted)
                        Spacer()
                        Button(L("sign_out")) { controller.signOut() }
                    }
                }
                Text(L("join_hint")).multilineTextAlignment(.center).frame(maxWidth: .infinity)
                if !auth.google {
                    TextField(L("join_name_label"), text: nameBinding)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.words)
                        .foregroundStyle(.black)
                }
                HStack(spacing: 8) {
                    TextField(L("join_code_label"), text: codeBinding)
                        .textFieldStyle(.roundedBorder)
                        .font(.title2.weight(.bold))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .foregroundStyle(.black)
                        .onSubmit(join)
                    Button(action: scan) {
                        Image(systemName: "qrcode.viewfinder").frame(height: 40)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel(L("join_scan"))
                }
                if let err = session.joinError { errorText(err) }
                Button(action: join) {
                    Text(L(session.joining ? "join_verifying" : "join_button"))
                        .font(.system(size: 17)).frame(maxWidth: .infinity).frame(height: 52)
                }
                .buttonStyle(.borderedProminent)
                .disabled(session.joining)
            }
        }
    }

    // --- piezas ---

    private func serverLine(_ serverUrl: String) -> some View {
        HStack {
            Text(L("server_current", stripScheme(serverUrl)))
                .foregroundStyle(Brand.muted).font(.footnote)
            Spacer()
            Button(L("server_change")) { controller.changeServer() }
        }
    }

    private var scanButton: some View {
        Button(action: scan) {
            Label(L("join_scan"), systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }

    private func title(_ value: String) -> some View {
        Text(value).font(.title2.weight(.bold)).multilineTextAlignment(.center).frame(maxWidth: .infinity)
    }

    private func errorText(_ value: String) -> some View {
        Text(value).foregroundStyle(Brand.danger).multilineTextAlignment(.center).frame(maxWidth: .infinity)
    }

    // --- acciones ---

    private func join() { controller.join(session.roomCode, name: session.nameInput) }

    private func scan() { onScan() }

    private func stripScheme(_ url: String) -> String {
        if let range = url.range(of: "://") { return String(url[range.upperBound...]) }
        return url
    }

    // Enlaces al controlador (SessionState es de solo lectura desde aquí).
    private var nameBinding: Binding<String> {
        Binding(get: { session.nameInput }, set: { controller.setNameInput($0) })
    }
    private var codeBinding: Binding<String> {
        Binding(get: { session.roomCode }, set: { controller.setRoomCodeInput($0) })
    }
}
