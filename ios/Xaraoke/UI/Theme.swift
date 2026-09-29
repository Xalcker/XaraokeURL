// Los colores de public/css/tokens.css: el turquesa del logo sobre el morado oscuro de la marca.
// Equivalente a android/.../ui/Theme.kt

import SwiftUI

enum Brand {
    static let accent = Color(red: 0x49/255, green: 0xD6/255, blue: 0xD8/255)
    static let onAccent = Color(red: 0x17/255, green: 0x11/255, blue: 0x24/255)
    static let dark = Color(red: 0x17/255, green: 0x11/255, blue: 0x24/255)
    static let danger = Color(red: 0xE5/255, green: 0x39/255, blue: 0x35/255)
    static let dangerBanner = Color(red: 0xC0/255, green: 0x39/255, blue: 0x2B/255)
    static let muted = Color(red: 0xB3/255, green: 0xB3/255, blue: 0xB3/255)
    static let surface = Color.white.opacity(0.2)
    static let surfaceStrong = Color(red: 0x24/255, green: 0x1A/255, blue: 0x36/255)
    static let mine = accent.opacity(0.2)
    static let warning = Color(red: 0xFF/255, green: 0xC1/255, blue: 0x07/255)

    // El degradado de fondo del web (sin la animación).
    static let background = LinearGradient(
        colors: [
            Color(red: 0x1F/255, green: 0x0C/255, blue: 0x2E/255),
            Color(red: 0x4E/255, green: 0x1F/255, blue: 0x70/255),
            Color(red: 0x14/255, green: 0x21/255, blue: 0x42/255),
            Color(red: 0x0D/255, green: 0x0D/255, blue: 0x1E/255),
        ],
        startPoint: .topTrailing,
        endPoint: .bottomLeading
    )
}

// Fondo degradado que envuelve toda la app.
struct GradientBackground<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            content
        }
        .tint(Brand.accent)
        .foregroundStyle(.white)
    }
}
