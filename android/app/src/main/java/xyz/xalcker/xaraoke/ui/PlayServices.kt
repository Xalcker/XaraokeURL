package xyz.xalcker.xaraoke.ui

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.tasks.await

sealed interface GoogleSignInResult {
    data class Token(val idToken: String) : GoogleSignInResult
    data object Cancelled : GoogleSignInResult
    data class Failed(val message: String?) : GoogleSignInResult
}

// Pide a Credential Manager un ID token de Google para `serverClientId` (el client ID "Web" del
// servidor: es la audiencia que el servidor verifica).
//
// Primero intenta sin mostrar nada, con una cuenta que ya autorizó la app (así, cuando vence la
// sesión, se vuelve a entrar sola). Si no hay ninguna, muestra el botón de "Acceder con Google".
suspend fun signInWithGoogle(activity: Activity, serverClientId: String, allowedDomain: String?): GoogleSignInResult {
    val manager = CredentialManager.create(activity)
    val silent = GetCredentialRequest.Builder()
        .addCredentialOption(
            GetGoogleIdOption.Builder()
                .setServerClientId(serverClientId)
                .setFilterByAuthorizedAccounts(true)
                .setAutoSelectEnabled(true)
                .build()
        )
        .build()
    try {
        return tokenOf(manager.getCredential(activity, silent).credential)
    } catch (_: NoCredentialException) {
        // Nunca autorizó una cuenta: se le muestra el selector.
    } catch (_: GetCredentialCancellationException) {
        return GoogleSignInResult.Cancelled
    } catch (e: Exception) {
        // Cualquier otro problema del intento silencioso: se prueba con el selector.
    }

    val interactive = GetCredentialRequest.Builder()
        .addCredentialOption(
            GetSignInWithGoogleOption.Builder(serverClientId)
                .apply { if (!allowedDomain.isNullOrBlank()) setHostedDomainFilter(allowedDomain) }
                .build()
        )
        .build()
    return try {
        tokenOf(manager.getCredential(activity, interactive).credential)
    } catch (_: GetCredentialCancellationException) {
        GoogleSignInResult.Cancelled
    } catch (e: Exception) {
        GoogleSignInResult.Failed(e.message)
    }
}

private fun tokenOf(credential: androidx.credentials.Credential): GoogleSignInResult =
    if (credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
        GoogleSignInResult.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken)
    } else {
        GoogleSignInResult.Failed(null)
    }

// Olvida la cuenta elegida, para que al volver a iniciar sesión se pueda escoger otra.
suspend fun clearGoogleCredential(activity: Activity) {
    runCatching {
        CredentialManager.create(activity).clearCredentialState(androidx.credentials.ClearCredentialStateRequest())
    }
}

sealed interface ScanResult {
    data class Text(val value: String) : ScanResult
    data object Cancelled : ScanResult
    data object Unavailable : ScanResult
}

// Lector de QR de Google Play Services. Abre su propia pantalla de cámara, así que la app no
// necesita (ni pide) permiso de cámara, y funciona igual contra un servidor HTTP de la red local.
suspend fun scanQrCode(activity: Activity): ScanResult {
    val options = GmsBarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .enableAutoZoom()
        .build()
    val scanner = GmsBarcodeScanning.getClient(activity, options)
    return try {
        // La primera vez puede faltar descargar el módulo del lector.
        val installed = ModuleInstall.getClient(activity).areModulesAvailable(scanner).await().areModulesAvailable()
        if (!installed) {
            ModuleInstall.getClient(activity)
                .installModules(ModuleInstallRequest.newBuilder().addApi(scanner).build())
                .await()
        }
        val barcode = scanner.startScan().await()
        barcode.rawValue?.let { ScanResult.Text(it) } ?: ScanResult.Cancelled
    } catch (e: com.google.android.gms.common.api.ApiException) {
        ScanResult.Unavailable
    } catch (e: kotlinx.coroutines.CancellationException) {
        // Cerrar el lector cancela su Task, y await() lo reporta así; solo se propaga si de verdad
        // se canceló quien llama (se fue de la pantalla).
        currentCoroutineContext().ensureActive()
        ScanResult.Cancelled
    } catch (e: Exception) {
        // startScan() termina con una excepción de "cancelado" si la persona cierra el lector.
        if (e.message?.contains("cancel", ignoreCase = true) == true) ScanResult.Cancelled else ScanResult.Unavailable
    }
}
