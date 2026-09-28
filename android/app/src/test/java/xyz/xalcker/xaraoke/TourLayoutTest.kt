package xyz.xalcker.xaraoke

import org.junit.Assert.assertEquals
import org.junit.Test
import xyz.xalcker.xaraoke.core.Area
import xyz.xalcker.xaraoke.core.CardSpot
import xyz.xalcker.xaraoke.core.tourCardPosition

class TourLayoutTest {
    private fun place(target: Area?, cardHeight: Float = 200f) =
        tourCardPosition(target, cardWidth = 300f, cardHeight = cardHeight, viewWidth = 400f, viewHeight = 800f, gap = 12f, margin = 12f)

    @Test
    fun `sin elemento va al centro`() {
        assertEquals(CardSpot(50f, 300f), place(null))
    }

    @Test
    fun `debajo del elemento si cabe`() {
        assertEquals(CardSpot(50f, 162f), place(Area(0f, 100f, 400f, 50f)))
    }

    @Test
    fun `arriba del elemento si abajo no cabe`() {
        assertEquals(CardSpot(50f, 488f), place(Area(0f, 700f, 400f, 50f)))
    }

    @Test
    fun `nunca se sale de la pantalla`() {
        // Elemento en la orilla derecha: la tarjeta se recorre hacia adentro.
        assertEquals(88f, place(Area(350f, 100f, 40f, 40f)).left)
        // Tarjeta más alta que cualquier lado: se queda dentro, del lado con más espacio.
        assertEquals(88f, place(Area(0f, 350f, 400f, 100f), cardHeight = 700f).top)
    }
}
