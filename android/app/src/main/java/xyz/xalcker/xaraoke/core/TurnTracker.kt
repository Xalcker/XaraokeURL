package xyz.xalcker.xaraoke.core

// Decide cuándo avisar "te toca cantar", una sola vez por canción.
//
//   UP_NEXT:  tu canción es la siguiente y a la que suena le quedan 10 segundos o menos (lo mismo
//             que el remoto web).
//   STARTING: tu canción pasó a ser la de arriba sin que hubiera aviso previo (por ejemplo,
//             porque saltaron la anterior). El web no avisa en este caso: con el teléfono en el
//             bolsillo, es justo cuando más falta hace.
//
// La primera cola después de conectar no avisa STARTING: quien abre la app con su canción ya
// sonando no necesita que el teléfono le grite.
class TurnTracker {
    enum class Kind { UP_NEXT, STARTING }

    data class Alert(val kind: Kind, val songId: String)

    private val alerted = LinkedHashSet<String>()
    private var primed = false

    // Se llama al abrir cada conexión nueva con la sala.
    fun onConnected() {
        primed = false
    }

    fun onQueue(queue: List<QueueItem>, me: String): Alert? {
        val first = !primed
        primed = true
        val head = queue.firstOrNull() ?: return null
        if (me.isEmpty() || head.name != me || head.id in alerted) return null
        remember(head.id)
        return if (first) null else Alert(Kind.STARTING, head.id)
    }

    fun onTime(remainingSeconds: Double, queue: List<QueueItem>, me: String): Alert? {
        if (remainingSeconds <= 0 || remainingSeconds > 10) return null
        val next = queue.getOrNull(1) ?: return null
        if (me.isEmpty() || next.name != me || next.id in alerted) return null
        remember(next.id)
        return Alert(Kind.UP_NEXT, next.id)
    }

    private fun remember(id: String) {
        alerted.add(id)
        // Solo importan las últimas: los ids no se repiten.
        while (alerted.size > 50) alerted.remove(alerted.first())
    }
}

// ¿Cuántas canciones faltan antes de la primera tuya? null si no tienes ninguna.
fun songsBeforeMyTurn(queue: List<QueueItem>, me: String): Int? {
    if (me.isEmpty()) return null
    val index = queue.indexOfFirst { it.name == me }
    return if (index == -1) null else index
}
