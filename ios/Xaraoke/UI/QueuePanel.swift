// La lista de todos, con tus canciones resaltadas: puedes reordenar las tuyas entre sí y quitarlas.
// Equivalente a android/.../ui/QueuePanel.kt

import SwiftUI

struct QueuePanel: View {
    @ObservedObject var controller: AppController
    let state: RoomState
    // Contenido que va arriba de la lista y se desplaza con ella (mini-reproductor y avisos en ancho).
    var leading: AnyView? = nil

    @EnvironmentObject private var ui: UIState

    private var waiting: [QueueItem] { Array(state.queue.dropFirst()) }
    private var mineIds: [String] { waiting.filter(state.isMine).map { $0.id } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if let leading { leading }
                Text(turnSummary(state))
                    .fontWeight(.semibold).foregroundStyle(Brand.accent).padding(.vertical, 4)

                if waiting.isEmpty {
                    Hint(L("queue_empty_list"))
                }
                ForEach(waiting, id: \.id) { item in
                    row(item)
                }
            }
            .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 160)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func row(_ item: QueueItem) -> some View {
        let mine = state.isMine(item)
        let title = songDisplay(item.song, title: item.title, unknownArtist: L("unknown_artist")).title
        return HStack(alignment: .center, spacing: 4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).fontWeight(.bold).lineLimit(2)
                HStack(spacing: 8) {
                    Text(mine ? L("queue_you") : item.name)
                        .font(.footnote)
                        .foregroundStyle(mine ? Brand.accent : Brand.muted)
                    RatingBadge(controller.library.ratings[item.song])
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)

            if mine {
                if mineIds.count > 1 {
                    let position = mineIds.firstIndex(of: item.id) ?? 0
                    Button { controller.moveSong(item.id, up: true) } label: {
                        Image(systemName: "chevron.up")
                    }
                    .disabled(position == 0)
                    .accessibilityLabel(L("move_up"))
                    Button { controller.moveSong(item.id, up: false) } label: {
                        Image(systemName: "chevron.down")
                    }
                    .disabled(position >= mineIds.count - 1)
                    .accessibilityLabel(L("move_down"))
                }
                Button(role: .destructive) { confirmRemove(item, title: title) } label: {
                    Text(L("queue_remove")).foregroundStyle(Brand.danger)
                }
            }
        }
        .padding(.leading, 14).padding(.trailing, 4)
        .background(mine ? Brand.mine : Brand.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func confirmRemove(_ item: QueueItem, title: String) {
        ui.requestConfirm(ConfirmRequest(
            message: L("confirm_remove", title),
            confirmLabel: L("confirm_remove_yes"),
            danger: true,
            stillValid: { $0?.queue.dropFirst().contains(where: { $0.id == item.id }) == true },
            onConfirm: { controller.removeSong(item.id) }
        ))
    }
}

// ¿Cuánto falta para tu turno? El mismo texto que la notificación de Android.
func turnSummary(_ state: RoomState) -> String {
    switch songsBeforeMyTurn(state.queue, me: state.myName) {
    case .none: return L("queue_summary_none")
    case .some(0): return L("queue_summary_playing")
    case .some(1): return L("queue_summary_next")
    case .some(let ahead): return LPlural("queue_summary_ahead", ahead)
    }
}

// Pulgares arriba y abajo de una canción, sumando todas las salas (nada si nadie la calificó).
struct RatingBadge: View {
    let totals: RatingTotals?
    init(_ totals: RatingTotals?) { self.totals = totals }

    var body: some View {
        if let t = totals, t.up + t.down > 0 {
            HStack(spacing: 3) {
                Image(systemName: "hand.thumbsup.fill").font(.system(size: 11)).foregroundStyle(Brand.muted)
                Text("\(t.up)").font(.caption2).foregroundStyle(Brand.muted)
                Spacer().frame(width: 4)
                Image(systemName: "hand.thumbsdown.fill").font(.system(size: 11)).foregroundStyle(Brand.muted)
                Text("\(t.down)").font(.caption2).foregroundStyle(Brand.muted)
            }
            .accessibilityLabel(L("rating_total", t.up, t.down))
        }
    }
}

// Texto de ayuda gris (o amarillo de aviso).
struct Hint: View {
    let message: String
    var warning: Bool = false
    init(_ message: String, warning: Bool = false) { self.message = message; self.warning = warning }
    var body: some View {
        Text(message).foregroundStyle(warning ? Brand.warning : Brand.muted).padding(.vertical, 8)
    }
}
