// Dónde poner la tarjeta del tutorial: lo mismo que cardPosition de public/js/tour.js. Va debajo
// del elemento resaltado si cabe, y si no arriba; si no cabe en ninguno de los dos lados, del lado
// con más espacio (puede tapar parte del elemento, pero nunca se sale de la pantalla). Sin
// elemento, al centro. Todo en píxeles.
// Equivalente a android/app/src/main/java/xyz/xalcker/xaraoke/core/TourLayout.kt

import Foundation

struct Area: Equatable {
    let left: Float
    let top: Float
    let width: Float
    let height: Float
    var bottom: Float { top + height }
}

struct CardSpot: Equatable {
    let left: Float
    let top: Float
}

func tourCardPosition(
    target: Area?,
    cardWidth: Float,
    cardHeight: Float,
    viewWidth: Float,
    viewHeight: Float,
    gap: Float,
    margin: Float
) -> CardSpot {
    let maxLeft = max(viewWidth - cardWidth - margin, margin)
    let maxTop = max(viewHeight - cardHeight - margin, margin)
    func clampLeft(_ v: Float) -> Float { min(max(v, margin), maxLeft) }
    func clampTop(_ v: Float) -> Float { min(max(v, margin), maxTop) }

    guard let target = target else {
        return CardSpot(left: clampLeft((viewWidth - cardWidth) / 2), top: clampTop((viewHeight - cardHeight) / 2))
    }
    let spaceBelow = viewHeight - target.bottom - gap - margin
    let spaceAbove = target.top - gap - margin
    let below = cardHeight <= spaceBelow || (cardHeight > spaceAbove && spaceBelow >= spaceAbove)
    let top = below ? target.bottom + gap : target.top - gap - cardHeight
    let centered = target.left + target.width / 2 - cardWidth / 2
    return CardSpot(left: clampLeft(centered), top: clampTop(top))
}
