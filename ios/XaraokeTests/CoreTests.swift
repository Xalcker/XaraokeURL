// Porte de android/app/src/test/java/xyz/xalcker/xaraoke/CoreTest.kt

import XCTest
@testable import Xaraoke

final class JoinLinkTests: XCTestCase {
    func testQRTraeServidorYSala() {
        XCTAssertEqual(
            JoinLink(serverUrl: "http://192.168.0.72:8081", roomCode: "ABCD"),
            parseJoinText("http://192.168.0.72:8081/remote.html?sala=abcd")
        )
        XCTAssertEqual(
            JoinLink(serverUrl: "https://karaoke.xalcker.xyz", roomCode: "QWER"),
            parseJoinText("https://karaoke.xalcker.xyz/remote.html?sala=QWER")
        )
    }

    func testEnlaceSinSalaSoloTraeServidor() {
        XCTAssertEqual(
            JoinLink(serverUrl: "http://10.0.0.5:8081", roomCode: nil),
            parseJoinText("http://10.0.0.5:8081/remote.html")
        )
    }

    func testSoloElCodigoDeLaSala() {
        XCTAssertEqual(JoinLink(serverUrl: nil, roomCode: "WXYZ"), parseJoinText(" wxyz "))
    }

    func testEnlacePropioDeLaApp() {
        XCTAssertEqual(
            JoinLink(serverUrl: "http://192.168.0.72:8081", roomCode: "ABCD"),
            parseJoinText("xaraoke://unirse?servidor=http%3A%2F%2F192.168.0.72%3A8081&sala=ABCD")
        )
    }

    func testLoQueNoEsDeUnaSalaNoSeEntiende() {
        XCTAssertNil(parseJoinText("hola mundo"))
        XCTAssertNil(parseJoinText("ABCDE"))
        XCTAssertNil(parseJoinText("ftp://servidor/archivo"))
        XCTAssertNil(parseJoinText(""))
    }

    func testDireccionEscritaAManoSeCompletaConHttp() {
        XCTAssertEqual("http://192.168.0.72:8081", normalizeServerUrl("192.168.0.72:8081"))
        XCTAssertEqual("http://192.168.0.72:8081", normalizeServerUrl(" http://192.168.0.72:8081/ "))
        XCTAssertEqual("https://karaoke.xalcker.xyz", normalizeServerUrl("HTTPS://karaoke.xalcker.xyz/remote.html"))
        XCTAssertNil(normalizeServerUrl(""))
        XCTAssertNil(normalizeServerUrl("ftp://x"))
    }

    func testIdDeVideoCompartidoDesdeYouTube() {
        XCTAssertEqual("dQw4w9WgXcQ", youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc"))
        XCTAssertEqual("dQw4w9WgXcQ", youtubeVideoId("Mira esto https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"))
        XCTAssertEqual("dQw4w9WgXcQ", youtubeVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ"))
        XCTAssertEqual("dQw4w9WgXcQ", youtubeVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"))
        XCTAssertNil(youtubeVideoId("https://vimeo.com/123456"))
        XCTAssertNil(youtubeVideoId("https://youtu.be/corto"))
        XCTAssertNil(youtubeVideoId("sin enlace"))
    }
}

final class SongsTests: XCTestCase {
    func testElTituloPuedeLlevarGuiones() {
        let d = parseSongFilename("Queen - Bohemian Rhapsody - Remastered 2011.mp4", unknownArtist: "?")
        XCTAssertEqual("Queen", d.artist)
        XCTAssertEqual("Bohemian Rhapsody - Remastered 2011", d.title)
        XCTAssertEqual("?", parseSongFilename("SinArtista.mp4", unknownArtist: "?").artist)
    }

    func testDescargasDeYouTubeSeMuestranConSuTitulo() {
        let d = songDisplay("1b4e28ba-2fa1-11d2-883f-0016d3cca427.mp4", title: "Karaoke de algo", unknownArtist: "?")
        XCTAssertEqual("YouTube", d.artist)
        XCTAssertEqual("Karaoke de algo", d.title)
    }

    func testBusquedaIgnoraAcentosYMayusculas() {
        XCTAssertEqual("de musica ligera", normalizeForSearch("De Música Ligera"))
    }

    func testFormatoDelTiempo() {
        XCTAssertEqual("0:00", formatTime(-1.0))
        XCTAssertEqual("3:05", formatTime(185.7))
    }
}

final class ReconnectTests: XCTestCase {
    func testLosCodigosDelServidor() {
        XCTAssertEqual(CloseAction.roomGone, closeAction(4004))
        XCTAssertEqual(CloseAction.login, closeAction(4001))
        XCTAssertEqual(CloseAction.nameTaken, closeAction(4009))
        XCTAssertEqual(CloseAction.stop, closeAction(4003))
        XCTAssertEqual(CloseAction.retry, closeAction(1006))
    }

    func testLaEsperaSeDuplicaHasta30Segundos() {
        XCTAssertEqual(3_000, nextRetryDelayMs(0))
        XCTAssertEqual(6_000, nextRetryDelayMs(1))
        XCTAssertEqual(30_000, nextRetryDelayMs(10))
        XCTAssertEqual(30_000, nextRetryDelayMs(1000))
    }
}

final class TurnTrackerTests: XCTestCase {
    private func item(_ id: String, _ name: String) -> QueueItem {
        QueueItem(id: id, song: "A - \(id).mp4", name: name, title: nil)
    }

    func testAvisaUnaVezCuandoFaltan10SegundosYLaSiguienteEsTuya() {
        let t = TurnTracker()
        let queue = [item("1", "Ana"), item("2", "Beto")]
        t.onConnected()
        XCTAssertNil(t.onQueue(queue, me: "Beto"))
        XCTAssertNil(t.onTime(remainingSeconds: 30.0, queue: queue, me: "Beto"))
        XCTAssertEqual(
            TurnTracker.Alert(kind: .upNext, songId: "2"),
            t.onTime(remainingSeconds: 9.0, queue: queue, me: "Beto")
        )
        XCTAssertNil(t.onTime(remainingSeconds: 8.0, queue: queue, me: "Beto"))
        // Ya se avisó: cuando empieza no se vuelve a avisar.
        XCTAssertNil(t.onQueue([item("2", "Beto")], me: "Beto"))
    }

    func testAvisaCuandoTuCancionEmpiezaSinAvisoPrevio() {
        let t = TurnTracker()
        t.onConnected()
        XCTAssertNil(t.onQueue([item("1", "Ana"), item("2", "Beto")], me: "Beto"))
        // Saltaron la de Ana: no hubo aviso de 10 segundos.
        XCTAssertEqual(
            TurnTracker.Alert(kind: .starting, songId: "2"),
            t.onQueue([item("2", "Beto")], me: "Beto")
        )
    }

    func testAlConectarConTuCancionYaSonandoNoAvisa() {
        let t = TurnTracker()
        t.onConnected()
        XCTAssertNil(t.onQueue([item("2", "Beto")], me: "Beto"))
    }

    func testCuantasFaltanParaTuTurno() {
        let queue = [item("1", "Ana"), item("2", "Carla"), item("3", "Beto")]
        XCTAssertEqual(2, songsBeforeMyTurn(queue, me: "Beto"))
        XCTAssertEqual(0, songsBeforeMyTurn(queue, me: "Ana"))
        XCTAssertNil(songsBeforeMyTurn(queue, me: "Nadie"))
    }
}
