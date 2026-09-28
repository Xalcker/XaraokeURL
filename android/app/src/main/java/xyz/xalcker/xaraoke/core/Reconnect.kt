package xyz.xalcker.xaraoke.core

import kotlin.math.min

// Qué hacer cuando se cierra el WebSocket: lo mismo que public/js/reconnect.js del remoto web.
enum class CloseAction { RETRY, ROOM_GONE, LOGIN, NAME_TAKEN, STOP }

const val ROOM_NOT_FOUND = 4004
const val NOT_AUTHENTICATED = 4001
const val ORIGIN_NOT_ALLOWED = 4003
const val NO_ROOM_ID = 4005
const val NAME_TAKEN = 4009

fun closeAction(code: Int): CloseAction = when (code) {
    ROOM_NOT_FOUND -> CloseAction.ROOM_GONE
    NOT_AUTHENTICATED -> CloseAction.LOGIN
    NAME_TAKEN -> CloseAction.NAME_TAKEN
    ORIGIN_NOT_ALLOWED, NO_ROOM_ID -> CloseAction.STOP
    else -> CloseAction.RETRY
}

// Empieza en 3 s y se duplica hasta 30 s, para no martillear un servidor caído.
fun nextRetryDelayMs(attempt: Int, firstMs: Long = 3_000, maxMs: Long = 30_000): Long {
    val n = attempt.coerceIn(0, 20)
    return min(maxMs, firstMs shl n)
}
