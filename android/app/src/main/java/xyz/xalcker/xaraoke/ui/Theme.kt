package xyz.xalcker.xaraoke.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Los colores de public/css/tokens.css: el turquesa del logo sobre el morado oscuro de la marca.
object Brand {
    val accent = Color(0xFF49D6D8)
    val onAccent = Color(0xFF171124)
    val dark = Color(0xFF171124)
    val danger = Color(0xFFE53935)
    val dangerBanner = Color(0xFFC0392B)
    val muted = Color(0xFFB3B3B3)
    val surface = Color(0x33FFFFFF)
    val surfaceStrong = Color(0xFF241A36)
    val mine = Color(0x3349D6D8)

    // El degradado de fondo del web (sin la animación).
    val background = Brush.linearGradient(
        colors = listOf(Color(0xFF1F0C2E), Color(0xFF4E1F70), Color(0xFF142142), Color(0xFF0D0D1E)),
        start = Offset(Float.POSITIVE_INFINITY, 0f),
        end = Offset(0f, Float.POSITIVE_INFINITY),
    )
}

private val colors = darkColorScheme(
    primary = Brand.accent,
    onPrimary = Brand.onAccent,
    secondary = Brand.accent,
    onSecondary = Brand.onAccent,
    background = Brand.dark,
    onBackground = Color.White,
    surface = Brand.surfaceStrong,
    onSurface = Color.White,
    surfaceVariant = Color(0xFF2E2342),
    onSurfaceVariant = Brand.muted,
    surfaceContainerHigh = Brand.surfaceStrong,
    surfaceContainerHighest = Color(0xFF2E2342),
    error = Brand.danger,
    onError = Color.White,
    outline = Color(0x66FFFFFF),
)

@Composable
fun XaraokeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
fun GradientBackground(content: @Composable BoxScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(Brand.background), content = content)
}
