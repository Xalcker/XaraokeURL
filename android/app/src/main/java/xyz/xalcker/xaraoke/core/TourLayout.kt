package xyz.xalcker.xaraoke.core

// Dónde poner la tarjeta del tutorial: lo mismo que cardPosition de public/js/tour.js. Va debajo
// del elemento resaltado si cabe, y si no arriba; si no cabe en ninguno de los dos lados, del lado
// con más espacio (puede tapar parte del elemento, pero nunca se sale de la pantalla). Sin
// elemento, al centro. Todo en píxeles.
data class Area(val left: Float, val top: Float, val width: Float, val height: Float) {
    val bottom get() = top + height
}

data class CardSpot(val left: Float, val top: Float)

fun tourCardPosition(
    target: Area?,
    cardWidth: Float,
    cardHeight: Float,
    viewWidth: Float,
    viewHeight: Float,
    gap: Float,
    margin: Float,
): CardSpot {
    val maxLeft = (viewWidth - cardWidth - margin).coerceAtLeast(margin)
    val maxTop = (viewHeight - cardHeight - margin).coerceAtLeast(margin)
    fun clampLeft(v: Float) = v.coerceIn(margin, maxLeft)
    fun clampTop(v: Float) = v.coerceIn(margin, maxTop)
    if (target == null) {
        return CardSpot(clampLeft((viewWidth - cardWidth) / 2), clampTop((viewHeight - cardHeight) / 2))
    }
    val spaceBelow = viewHeight - target.bottom - gap - margin
    val spaceAbove = target.top - gap - margin
    val below = cardHeight <= spaceBelow || (cardHeight > spaceAbove && spaceBelow >= spaceAbove)
    val top = if (below) target.bottom + gap else target.top - gap - cardHeight
    val centered = target.left + target.width / 2 - cardWidth / 2
    return CardSpot(clampLeft(centered), clampTop(top))
}
