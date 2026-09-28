package xyz.xalcker.xaraoke

import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes

// Un texto para la pantalla que todavía no se tradujo: un recurso de la app (con sus argumentos)
// o un mensaje que ya viene traducido del servidor.
sealed interface UiText {
    data class Res(@StringRes val id: Int, val args: List<Any> = emptyList()) : UiText
    data class Plural(@PluralsRes val id: Int, val count: Int) : UiText
    data class Raw(val text: String) : UiText

    fun resolve(resources: Resources): String = when (this) {
        is Res -> resources.getString(id, *args.toTypedArray())
        is Plural -> resources.getQuantityString(id, count, count)
        is Raw -> text
    }
}

fun text(@StringRes id: Int, vararg args: Any): UiText = UiText.Res(id, args.toList())
