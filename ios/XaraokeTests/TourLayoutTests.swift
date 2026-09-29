// Porte de android/app/src/test/java/xyz/xalcker/xaraoke/TourLayoutTest.kt

import XCTest
@testable import Xaraoke

final class TourLayoutTests: XCTestCase {
    private func place(_ target: Area?, cardHeight: Float = 200) -> CardSpot {
        tourCardPosition(
            target: target,
            cardWidth: 300, cardHeight: cardHeight,
            viewWidth: 400, viewHeight: 800,
            gap: 12, margin: 12
        )
    }

    func testSinElementoVaAlCentro() {
        XCTAssertEqual(CardSpot(left: 50, top: 300), place(nil))
    }

    func testDebajoDelElementoSiCabe() {
        XCTAssertEqual(CardSpot(left: 50, top: 162), place(Area(left: 0, top: 100, width: 400, height: 50)))
    }

    func testArribaDelElementoSiAbajoNoCabe() {
        XCTAssertEqual(CardSpot(left: 50, top: 488), place(Area(left: 0, top: 700, width: 400, height: 50)))
    }

    func testNuncaSeSaleDeLaPantalla() {
        // Elemento en la orilla derecha: la tarjeta se recorre hacia adentro.
        XCTAssertEqual(88, place(Area(left: 350, top: 100, width: 40, height: 40)).left)
        // Tarjeta más alta que cualquier lado: se queda dentro, del lado con más espacio.
        XCTAssertEqual(88, place(Area(left: 0, top: 350, width: 400, height: 100), cardHeight: 700).top)
    }
}
