// Vista de la Live Activity de la sala (pantalla de bloqueo e Isla Dinámica).
// Fase 5. Va en el target de extensión de widget (XaraokeWidget), que debe incluir también
// Room/RoomActivity.swift (los atributos) y UI/Strings.swift + Core/Songs.swift si se quiere
// reutilizar el resumen de turno; aquí el texto ya viene resuelto en el ContentState.
//
// Requiere iOS 16.1+. El bundle del widget se declara con @main en XaraokeWidgetBundle.

import SwiftUI
#if canImport(ActivityKit) && canImport(WidgetKit)
import ActivityKit
import WidgetKit

@available(iOS 16.1, *)
struct RoomActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RoomActivityAttributes.self) { context in
            // Pantalla de bloqueo / banner.
            LockScreenView(attributes: context.attributes, state: context.state)
                .padding()
                .activityBackgroundTint(Color.black.opacity(0.6))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "music.note").foregroundStyle(.cyan)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.nowPlaying).font(.caption).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(turnLine(context.state)).font(.caption2).foregroundStyle(.secondary)
                }
            } compactLeading: {
                Image(systemName: "music.mic").foregroundStyle(.cyan)
            } compactTrailing: {
                Text(compactTurn(context.state)).font(.caption2)
            } minimal: {
                Image(systemName: "music.mic").foregroundStyle(.cyan)
            }
        }
    }
}

@available(iOS 16.1, *)
private struct LockScreenView: View {
    let attributes: RoomActivityAttributes
    let state: RoomActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Xaraoke · \(attributes.roomCode)").font(.caption).foregroundStyle(.cyan)
                Spacer()
                if state.paused { Text("⏸").font(.caption) }
            }
            HStack(spacing: 6) {
                Image(systemName: "music.note").foregroundStyle(.cyan)
                Text(state.hostConnected ? state.nowPlaying : "—")
                    .font(.subheadline.weight(.semibold)).lineLimit(1)
            }
            Text(turnLine(state)).font(.caption).foregroundStyle(.secondary)
        }
    }
}

// El servidor envía los textos ya resueltos en el ContentState; aquí solo se elige la línea.
@available(iOS 16.1, *)
private func turnLine(_ state: RoomActivityAttributes.ContentState) -> String {
    switch state.songsAhead {
    case .none: return L("queue_summary_none")
    case .some(0): return L("queue_summary_playing")
    case .some(1): return L("queue_summary_next")
    case .some(let n): return LPlural("queue_summary_ahead", n)
    }
}

@available(iOS 16.1, *)
private func compactTurn(_ state: RoomActivityAttributes.ContentState) -> String {
    switch state.songsAhead {
    case .none: return "–"
    case .some(0): return "🎤"
    case .some(let n): return "\(n)"
    }
}
#endif
