package xyz.xalcker.xaraoke

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import xyz.xalcker.xaraoke.core.CloseAction
import xyz.xalcker.xaraoke.core.JoinLink
import xyz.xalcker.xaraoke.core.QueueItem
import xyz.xalcker.xaraoke.core.TurnTracker
import xyz.xalcker.xaraoke.core.closeAction
import xyz.xalcker.xaraoke.core.formatTime
import xyz.xalcker.xaraoke.core.nextRetryDelayMs
import xyz.xalcker.xaraoke.core.normalizeForSearch
import xyz.xalcker.xaraoke.core.normalizeServerUrl
import xyz.xalcker.xaraoke.core.parseJoinText
import xyz.xalcker.xaraoke.core.parseSongFilename
import xyz.xalcker.xaraoke.core.songDisplay
import xyz.xalcker.xaraoke.core.songsBeforeMyTurn
import xyz.xalcker.xaraoke.core.youtubeVideoId

class JoinLinkTest {
    @Test
    fun `el QR de la pantalla principal trae el servidor y la sala`() {
        assertEquals(
            JoinLink("http://192.168.0.72:8081", "ABCD"),
            parseJoinText("http://192.168.0.72:8081/remote.html?sala=abcd"),
        )
        assertEquals(
            JoinLink("https://karaoke.xalcker.xyz", "QWER"),
            parseJoinText("https://karaoke.xalcker.xyz/remote.html?sala=QWER"),
        )
    }

    @Test
    fun `un enlace sin sala solo trae el servidor`() {
        assertEquals(JoinLink("http://10.0.0.5:8081", null), parseJoinText("http://10.0.0.5:8081/remote.html"))
    }

    @Test
    fun `solo el codigo de la sala`() {
        assertEquals(JoinLink(null, "WXYZ"), parseJoinText(" wxyz "))
    }

    @Test
    fun `el enlace propio de la app`() {
        assertEquals(
            JoinLink("http://192.168.0.72:8081", "ABCD"),
            parseJoinText("xaraoke://unirse?servidor=http%3A%2F%2F192.168.0.72%3A8081&sala=ABCD"),
        )
    }

    @Test
    fun `lo que no es de una sala no se entiende`() {
        assertNull(parseJoinText("hola mundo"))
        assertNull(parseJoinText("ABCDE"))
        assertNull(parseJoinText("ftp://servidor/archivo"))
        assertNull(parseJoinText(""))
    }

    @Test
    fun `la direccion escrita a mano se completa con http`() {
        assertEquals("http://192.168.0.72:8081", normalizeServerUrl("192.168.0.72:8081"))
        assertEquals("http://192.168.0.72:8081", normalizeServerUrl(" http://192.168.0.72:8081/ "))
        assertEquals("https://karaoke.xalcker.xyz", normalizeServerUrl("HTTPS://karaoke.xalcker.xyz/remote.html"))
        assertNull(normalizeServerUrl(""))
        assertNull(normalizeServerUrl("ftp://x"))
    }

    @Test
    fun `el id de un video compartido desde YouTube`() {
        assertEquals("dQw4w9WgXcQ", youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc"))
        assertEquals("dQw4w9WgXcQ", youtubeVideoId("Mira esto https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"))
        assertEquals("dQw4w9WgXcQ", youtubeVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ"))
        assertEquals("dQw4w9WgXcQ", youtubeVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"))
        assertNull(youtubeVideoId("https://vimeo.com/123456"))
        assertNull(youtubeVideoId("https://youtu.be/corto"))
        assertNull(youtubeVideoId("sin enlace"))
    }
}

class SongsTest {
    @Test
    fun `el titulo puede llevar guiones`() {
        val d = parseSongFilename("Queen - Bohemian Rhapsody - Remastered 2011.mp4", "?")
        assertEquals("Queen", d.artist)
        assertEquals("Bohemian Rhapsody - Remastered 2011", d.title)
        assertEquals("?", parseSongFilename("SinArtista.mp4", "?").artist)
    }

    @Test
    fun `las descargas de YouTube se muestran con su titulo`() {
        val d = songDisplay("1b4e28ba-2fa1-11d2-883f-0016d3cca427.mp4", "Karaoke de algo", "?")
        assertEquals("YouTube", d.artist)
        assertEquals("Karaoke de algo", d.title)
    }

    @Test
    fun `la busqueda ignora acentos y mayusculas`() {
        assertEquals("de musica ligera", normalizeForSearch("De Música Ligera"))
    }

    @Test
    fun `formato del tiempo`() {
        assertEquals("0:00", formatTime(-1.0))
        assertEquals("3:05", formatTime(185.7))
    }
}

class ReconnectTest {
    @Test
    fun `los codigos del servidor`() {
        assertEquals(CloseAction.ROOM_GONE, closeAction(4004))
        assertEquals(CloseAction.LOGIN, closeAction(4001))
        assertEquals(CloseAction.NAME_TAKEN, closeAction(4009))
        assertEquals(CloseAction.STOP, closeAction(4003))
        assertEquals(CloseAction.RETRY, closeAction(1006))
    }

    @Test
    fun `la espera se duplica hasta 30 segundos`() {
        assertEquals(3_000, nextRetryDelayMs(0))
        assertEquals(6_000, nextRetryDelayMs(1))
        assertEquals(30_000, nextRetryDelayMs(10))
        assertEquals(30_000, nextRetryDelayMs(1000))
    }
}

class TurnTrackerTest {
    private fun item(id: String, name: String) = QueueItem(id = id, song = "A - $id.mp4", name = name, title = null)

    @Test
    fun `avisa una vez cuando faltan 10 segundos y la siguiente es tuya`() {
        val t = TurnTracker()
        val queue = listOf(item("1", "Ana"), item("2", "Beto"))
        t.onConnected()
        assertNull(t.onQueue(queue, "Beto"))
        assertNull(t.onTime(30.0, queue, "Beto"))
        assertEquals(TurnTracker.Alert(TurnTracker.Kind.UP_NEXT, "2"), t.onTime(9.0, queue, "Beto"))
        assertNull(t.onTime(8.0, queue, "Beto"))
        // Ya se avisó: cuando empieza no se vuelve a avisar.
        assertNull(t.onQueue(listOf(item("2", "Beto")), "Beto"))
    }

    @Test
    fun `avisa cuando tu cancion empieza sin aviso previo`() {
        val t = TurnTracker()
        t.onConnected()
        assertNull(t.onQueue(listOf(item("1", "Ana"), item("2", "Beto")), "Beto"))
        // Saltaron la de Ana: no hubo aviso de 10 segundos.
        assertEquals(
            TurnTracker.Alert(TurnTracker.Kind.STARTING, "2"),
            t.onQueue(listOf(item("2", "Beto")), "Beto"),
        )
    }

    @Test
    fun `al conectar con tu cancion ya sonando no avisa`() {
        val t = TurnTracker()
        t.onConnected()
        assertNull(t.onQueue(listOf(item("2", "Beto")), "Beto"))
    }

    @Test
    fun `cuantas faltan para tu turno`() {
        val queue = listOf(item("1", "Ana"), item("2", "Carla"), item("3", "Beto"))
        assertEquals(2, songsBeforeMyTurn(queue, "Beto"))
        assertEquals(0, songsBeforeMyTurn(queue, "Ana"))
        assertNull(songsBeforeMyTurn(queue, "Nadie"))
    }
}
