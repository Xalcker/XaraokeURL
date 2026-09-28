// La pantalla de la sala: encabezado, mini-reproductor, avisos, buscador y "Mi lista".
// Equivalente a android/.../ui/RoomScreen.kt
//
// Layout adaptable: desde 600 pt de ancho, dos columnas sin pestañas (Mi lista + buscador);
// más angosto, una columna con pestañas Buscar / Mi lista.

import SwiftUI

struct RoomScreen: View {
    @ObservedObject var controller: AppController
    let state: RoomState
    @EnvironmentObject private var ui: UIState

    @State private var tab = 0
    @State private var showTour = false

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width >= 600
            VStack(spacing: 0) {
                Header(controller: controller, state: state, onTutorial: { showTour = true })
                if wide {
                    HStack(spacing: 0) {
                        QueuePanel(controller: controller, state: state, leading: AnyView(
                            VStack(spacing: 0) {
                                MiniPlayer(controller: controller, state: state, edge: 0)
                                Banners(controller: controller, state: state, edge: 0)
                                Text(L("tab_queue")).fontWeight(.bold).foregroundStyle(Brand.accent)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                            }
                        ))
                        .frame(maxWidth: .infinity)
                        Divider().overlay(Color.white.opacity(0.2))
                        SearchPanel(controller: controller).frame(maxWidth: .infinity)
                    }
                } else {
                    MiniPlayer(controller: controller, state: state)
                    Banners(controller: controller, state: state)
                    Picker("", selection: $tab) {
                        Text(L("tab_search")).tag(0)
                        Text(tab == 1 ? L("tab_queue") : queueTabLabel).tag(1)
                    }
                    .pickerStyle(.segmented).padding(.horizontal, 12).padding(.vertical, 6)
                    if tab == 0 {
                        SearchPanel(controller: controller)
                    } else {
                        QueuePanel(controller: controller, state: state)
                    }
                }
            }
            .overlay(alignment: .bottom) {
                if let request = state.ratingRequests.first {
                    RatingCard(
                        title: L("now_playing",
                                 songDisplay(request.song, title: request.title, unknownArtist: L("unknown_artist")).artist,
                                 songDisplay(request.song, title: request.title, unknownArtist: L("unknown_artist")).title),
                        onRate: { controller.rate(request.id, value: $0) }
                    )
                    .frame(maxWidth: 560)
                }
            }
        }
        .onAppear {
            if controller.takeFirstTour() { showTour = true }
        }
        .sheet(isPresented: $showTour) {
            TourView()
        }
    }

    private var mineCount: Int { state.queue.filter(state.isMine).count }
    private var queueTabLabel: String {
        mineCount > 0 ? "\(L("tab_queue")) (\(mineCount))" : L("tab_queue")
    }
}

// Encabezado: código de sala, usuario y menú (tutorial, cambiar sala, ajustes, cerrar sesión).
private struct Header: View {
    @ObservedObject var controller: AppController
    let state: RoomState
    let onTutorial: () -> Void

    var body: some View {
        HStack {
            Text(L("room_code", state.roomCode)).fontWeight(.bold).foregroundStyle(Brand.accent)
            Text(L("user", state.myName)).font(.footnote).foregroundStyle(Brand.muted)
                .lineLimit(1).truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Menu {
                Button(L("tour_open"), action: onTutorial)
                Button(L("leave_room")) { controller.leaveRoom() }
                Button(L("notification_settings")) {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                if controller.session.auth?.google == true {
                    Button(L("sign_out")) { controller.signOut() }
                }
            } label: {
                Image(systemName: "ellipsis").accessibilityLabel(L("menu"))
            }
        }
        .padding(.leading, 16).padding(.trailing, 8).padding(.top, 4)
    }
}

// La barra de arriba: lo que suena, su avance y los botones, siempre a la vista.
private struct MiniPlayer: View {
    @ObservedObject var controller: AppController
    let state: RoomState
    var edge: CGFloat = 12
    @EnvironmentObject private var ui: UIState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center) {
                info.frame(maxWidth: .infinity, alignment: .leading)
                controls
            }
            let fraction = progressFraction
            ProgressView(value: fraction)
                .tint(Brand.accent)
            if state.active && !state.controlAllowed {
                Text(L("controls_locked")).font(.footnote).foregroundStyle(Brand.muted)
            }
        }
        .padding(14)
        .background(Brand.surface, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, edge).padding(.vertical, 6)
    }

    private var info: some View {
        let unknown = L("unknown_artist")
        let head = state.head
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(L("now_playing_label").uppercased()).font(.caption2).foregroundStyle(Brand.muted)
                if state.active && state.paused {
                    Text(L("paused_tag")).font(.caption2).foregroundStyle(Brand.onAccent)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Brand.accent, in: RoundedRectangle(cornerRadius: 4))
                }
            }
            HStack(spacing: 4) {
                Image(systemName: "music.note").font(.system(size: 18)).foregroundStyle(Brand.accent)
                Text(head.map {
                    let d = songDisplay($0.song, title: $0.title, unknownArtist: unknown)
                    return L("now_playing", d.artist, d.title)
                } ?? L("queue_empty"))
                .fontWeight(.semibold).lineLimit(2)
            }
            if let p = state.headProgress, p.duration > 0 {
                Text(L("time_left", formatTime(p.currentTime), formatTime(p.duration), formatTime(p.duration - p.currentTime)))
                    .font(.footnote).foregroundStyle(Brand.muted)
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 8) {
            Button(action: controller.playPause) {
                let paused = state.active && state.paused
                Image(systemName: paused ? "play.fill" : "pause.fill")
                    .frame(width: 52, height: 52)
                    .accessibilityLabel(L(paused ? "play" : "pause"))
            }
            .buttonStyle(.borderedProminent)
            .disabled(!state.canPlayPause)

            SkipButton(controller: controller, state: state)
        }
    }

    private var progressFraction: Double {
        guard let p = state.headProgress, p.duration > 0 else { return 0 }
        return min(max(p.currentTime / p.duration, 0), 1)
    }
}

// Con la canción de otra persona, el botón vota; el anillo tiene un segmento por voto necesario.
private struct SkipButton: View {
    @ObservedObject var controller: AppController
    let state: RoomState
    @EnvironmentObject private var ui: UIState

    var body: some View {
        let votes = state.skipVotes
        let label = state.skipVoteMode
            ? L(votes.voted ? "vote_skip_done" : "vote_skip", votes.count, votes.threshold)
            : L("skip")
        return ZStack {
            if state.skipVoteMode {
                VoteRing(count: votes.count, threshold: votes.threshold).frame(width: 56, height: 56)
            }
            Button(action: onTap) {
                Image(systemName: "forward.end.fill")
                    .frame(width: 44, height: 44)
                    .background(state.skipVoteMode ? Color.clear : Color.white.opacity(0.13), in: Circle())
            }
            .disabled(!state.canSkip)
            .opacity(state.skipVoteMode && votes.voted ? 0.5 : 1)
        }
        .frame(width: 56, height: 56)
        .accessibilityLabel(label)
    }

    private func onTap() {
        guard let head = state.head else { return }
        if state.skipVoteMode {
            if !state.skipVotes.voted { controller.voteSkip(head.id) }
            return
        }
        let unknown = L("unknown_artist")
        let d = songDisplay(head.song, title: head.title, unknownArtist: unknown)
        let songText = L("now_playing", d.artist, d.title)
        ui.requestConfirm(ConfirmRequest(
            message: state.isMine(head) ? L("confirm_skip_mine", songText) : L("confirm_skip_other", songText, head.name),
            confirmLabel: L("confirm_skip_yes"),
            danger: true,
            stillValid: { $0?.head?.id == head.id && $0?.controlAllowed == true },
            onConfirm: { controller.skip(head.id) }
        ))
    }
}

private struct VoteRing: View {
    let count: Int
    let threshold: Int
    var body: some View {
        let total = max(threshold, 1)
        Canvas { ctx, size in
            let stroke: CGFloat = 4
            let gap: Double = total > 1 ? 14 : 0
            let span = 360.0 / Double(total)
            let rect = CGRect(x: stroke/2, y: stroke/2, width: size.width - stroke, height: size.height - stroke)
            for i in 0..<total {
                let start = -90 + Double(i) * span + gap/2
                let end = start + span - gap
                var path = Path()
                path.addArc(center: CGPoint(x: size.width/2, y: size.height/2),
                            radius: rect.width/2,
                            startAngle: .degrees(start), endAngle: .degrees(end), clockwise: false)
                ctx.stroke(path, with: .color(i < count ? Brand.accent : Color.white.opacity(0.27)),
                           style: StrokeStyle(lineWidth: stroke, lineCap: .round))
            }
        }
    }
}

// Avisos: reconectando, host desconectado, "¡Prepárate!".
private struct Banners: View {
    @ObservedObject var controller: AppController
    let state: RoomState
    var edge: CGFloat = 12

    var body: some View {
        VStack(spacing: 0) {
            if state.connection == .retrying {
                banner(L("conn_retrying"), color: Brand.dangerBanner, icon: "wifi.slash")
            }
            if state.connection == .open && !state.hostConnected {
                banner(L("host_disconnected"), color: Brand.dangerBanner)
            }
            if state.turnBanner {
                banner(L("turn_banner"), color: Brand.accent, textColor: Brand.onAccent)
                    .onTapGesture { controller.dismissTurnBanner() }
            }
        }
    }

    private func banner(_ message: String, color: Color, textColor: Color = .white, icon: String? = nil) -> some View {
        HStack {
            if let icon { Image(systemName: icon).foregroundStyle(textColor) }
            Text(message).fontWeight(.semibold).foregroundStyle(textColor)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(color, in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, edge).padding(.vertical, 4)
    }
}

// Calificar el karaoke (el video y la música) de una canción tuya que terminó.
private struct RatingCard: View {
    let title: String
    let onRate: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L("rating_title", title)).fontWeight(.bold)
            Text(L("rating_hint")).font(.footnote).foregroundStyle(Brand.muted)
            HStack(spacing: 8) {
                Button { onRate(1) } label: { Label(L("rating_up"), systemImage: "hand.thumbsup.fill") }
                    .buttonStyle(.borderedProminent)
                Button { onRate(-1) } label: { Label(L("rating_down"), systemImage: "hand.thumbsdown.fill") }
                    .buttonStyle(.bordered)
                Spacer()
                Button(L("rating_skip")) { onRate(0) }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.surfaceStrong, in: RoundedRectangle(cornerRadius: 20))
        .shadow(radius: 12)
    }
}
