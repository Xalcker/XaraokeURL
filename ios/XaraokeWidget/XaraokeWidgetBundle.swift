// Punto de entrada del target de widget (Live Activity de la sala). Fase 5.

import SwiftUI
#if canImport(WidgetKit) && canImport(ActivityKit)
import WidgetKit

@main
struct XaraokeWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            RoomActivityWidget()
        }
    }
}
#endif
