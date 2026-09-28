// Qué hacer cuando se cierra el WebSocket: lo mismo que public/js/reconnect.js del remoto web.
// Equivalente a android/app/src/main/java/xyz/xalcker/xaraoke/core/Reconnect.kt

import Foundation

enum CloseAction {
    case retry
    case roomGone
    case login
    case nameTaken
    case stop
}

let ROOM_NOT_FOUND = 4004
let NOT_AUTHENTICATED = 4001
let ORIGIN_NOT_ALLOWED = 4003
let NO_ROOM_ID = 4005
let NAME_TAKEN = 4009

func closeAction(_ code: Int) -> CloseAction {
    switch code {
    case ROOM_NOT_FOUND: return .roomGone
    case NOT_AUTHENTICATED: return .login
    case NAME_TAKEN: return .nameTaken
    case ORIGIN_NOT_ALLOWED, NO_ROOM_ID: return .stop
    default: return .retry
    }
}

// Empieza en 3 s y se duplica hasta 30 s, para no martillear un servidor caído.
func nextRetryDelayMs(_ attempt: Int, firstMs: Int64 = 3_000, maxMs: Int64 = 30_000) -> Int64 {
    let n = min(max(attempt, 0), 20)
    return min(maxMs, firstMs << n)
}
