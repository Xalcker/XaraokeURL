// Tutorial guiado: los mismos pasos y textos que el del web/Android. Esta versión de la Fase 3
// muestra los pasos como tarjetas (avanzar/atrás/saltar); el resaltado del elemento concreto sobre
// la pantalla se afinará en una fase posterior reutilizando tourCardPosition (core/TourLayout).

import SwiftUI

private struct TourStep {
    let titleKey: String
    let textKey: String
}

private let tourSteps: [TourStep] = [
    TourStep(titleKey: "tour_room_title", textKey: "tour_room_text"),
    TourStep(titleKey: "tour_now_playing_title", textKey: "tour_now_playing_text"),
    TourStep(titleKey: "tour_play_pause_title", textKey: "tour_play_pause_text"),
    TourStep(titleKey: "tour_skip_title", textKey: "tour_skip_text"),
    TourStep(titleKey: "tour_search_title", textKey: "tour_search_text"),
    TourStep(titleKey: "tour_browse_title", textKey: "tour_browse_text"),
    TourStep(titleKey: "tour_queue_title", textKey: "tour_queue_text"),
    TourStep(titleKey: "tour_alerts_title", textKey: "tour_alerts_text"),
    TourStep(titleKey: "tour_help_title", textKey: "tour_help_text"),
]

struct TourView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0

    var body: some View {
        let step = tourSteps[index]
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(L("tour_counter", index + 1, tourSteps.count))
                    .font(.footnote).foregroundStyle(Brand.muted)
                Spacer()
                Button(L("tour_skip")) { dismiss() }
            }
            Spacer()
            Text(L(step.titleKey)).font(.title2.weight(.bold)).foregroundStyle(Brand.accent)
            Text(L(step.textKey)).foregroundStyle(.white)
            Spacer()
            HStack {
                if index > 0 {
                    Button(L("tour_back")) { index -= 1 }.buttonStyle(.bordered)
                }
                Spacer()
                if index < tourSteps.count - 1 {
                    Button(L("tour_next")) { index += 1 }.buttonStyle(.borderedProminent)
                } else {
                    Button(L("tour_done")) { dismiss() }.buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Brand.background.ignoresSafeArea())
    }
}
