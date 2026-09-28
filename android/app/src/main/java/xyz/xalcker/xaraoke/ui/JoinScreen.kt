package xyz.xalcker.xaraoke.ui

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import xyz.xalcker.xaraoke.AppController
import xyz.xalcker.xaraoke.R
import xyz.xalcker.xaraoke.SessionState
import xyz.xalcker.xaraoke.core.parseJoinText
import xyz.xalcker.xaraoke.text

@Composable
fun JoinScreen(controller: AppController, session: SessionState, modifier: Modifier = Modifier) {
    val activity = checkNotNull(LocalActivity.current)
    val scope = rememberCoroutineScope()

    val scan: () -> Unit = {
        scope.launch {
            when (val result = scanQrCode(activity)) {
                is ScanResult.Text -> {
                    val link = parseJoinText(result.value)
                    if (link == null) controller.toast(text(R.string.scan_not_found))
                    else controller.openJoinLink(link)
                }
                ScanResult.Unavailable -> controller.toast(text(R.string.scan_unavailable))
                ScanResult.Cancelled -> Unit
            }
        }
    }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Image(painterResource(R.drawable.logo), contentDescription = null, modifier = Modifier.size(96.dp))
        Column(
            Modifier.widthIn(max = 480.dp).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when {
                session.serverUrl == null -> ServerStep(controller, session, scan)
                session.loadingServer -> {
                    ServerLine(controller, session.serverUrl)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator(Modifier.size(24.dp))
                        Text(stringResource(R.string.server_connecting))
                    }
                }
                session.serverError != null || session.auth == null -> {
                    ServerLine(controller, session.serverUrl)
                    session.serverError?.let { ErrorText(it.asString()) }
                    Button(onClick = controller::retryServer, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.retry))
                    }
                    ScanButton(scan)
                }
                else -> RoomStep(controller, session, scan)
            }
        }
    }
}

@Composable
private fun ServerStep(controller: AppController, session: SessionState, scan: () -> Unit) {
    var server by rememberSaveable { mutableStateOf("") }
    Title(stringResource(R.string.server_title))
    Text(stringResource(R.string.server_hint), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    Button(onClick = scan, modifier = Modifier.fillMaxWidth().height(56.dp)) {
        Icon(Icons.Filled.QrCodeScanner, contentDescription = null)
        Spacer(Modifier.size(8.dp))
        Text(stringResource(R.string.join_scan), fontSize = 17.sp)
    }
    HorizontalDivider(Modifier.padding(vertical = 8.dp))
    OutlinedTextField(
        value = server,
        onValueChange = { server = it },
        label = { Text(stringResource(R.string.server_label)) },
        placeholder = { Text(stringResource(R.string.server_placeholder)) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
        keyboardActions = KeyboardActions(onGo = { controller.setServer(server) }),
        modifier = Modifier.fillMaxWidth(),
    )
    session.serverError?.let { ErrorText(it.asString()) }
    OutlinedButton(onClick = { controller.setServer(server) }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.server_connect))
    }
}

@Composable
private fun RoomStep(controller: AppController, session: SessionState, scan: () -> Unit) {
    val activity = checkNotNull(LocalActivity.current)
    val scope = rememberCoroutineScope()
    val auth = session.auth ?: return
    ServerLine(controller, session.serverUrl.orEmpty())
    Title(stringResource(R.string.join_title))

    if (auth.google && session.myName == null) {
        Text(stringResource(R.string.login_prompt), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        auth.allowedDomain?.let {
            Text(
                stringResource(R.string.login_domain_hint, it),
                textAlign = TextAlign.Center,
                color = Brand.muted,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Button(
            onClick = controller::requestGoogleSignIn,
            enabled = !session.signingIn,
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            Icon(Icons.Filled.AccountCircle, contentDescription = null)
            Spacer(Modifier.size(8.dp))
            Text(stringResource(if (session.signingIn) R.string.login_signing_in else R.string.login_google), fontSize = 17.sp)
        }
        session.joinError?.let { ErrorText(it.asString()) }
        return
    }

    if (auth.google) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.signed_in_as, session.myName.orEmpty()),
                color = Brand.muted,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = {
                controller.signOut()
                scope.launch { clearGoogleCredential(activity) }
            }) { Text(stringResource(R.string.sign_out)) }
        }
    }

    val join = { controller.join(session.roomCode, session.nameInput) }
    Text(stringResource(R.string.join_hint), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    if (!auth.google) {
        OutlinedTextField(
            value = session.nameInput,
            onValueChange = controller::setNameInput,
            label = { Text(stringResource(R.string.join_name_label)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = session.roomCode,
            onValueChange = controller::setRoomCodeInput,
            label = { Text(stringResource(R.string.join_code_label)) },
            singleLine = true,
            textStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = 6.sp),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                keyboardType = KeyboardType.Ascii,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Go,
            ),
            keyboardActions = KeyboardActions(onGo = { join() }),
            modifier = Modifier.weight(1f),
        )
        OutlinedButton(onClick = scan, modifier = Modifier.height(56.dp)) {
            Icon(Icons.Filled.QrCodeScanner, contentDescription = stringResource(R.string.join_scan))
        }
    }
    session.joinError?.let { ErrorText(it.asString()) }
    Button(onClick = join, enabled = !session.joining, modifier = Modifier.fillMaxWidth().height(52.dp)) {
        Text(stringResource(if (session.joining) R.string.join_verifying else R.string.join_button), fontSize = 17.sp)
    }
}

@Composable
private fun ServerLine(controller: AppController, serverUrl: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(
            stringResource(R.string.server_current, serverUrl.substringAfter("://")),
            color = Brand.muted,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = controller::changeServer) { Text(stringResource(R.string.server_change)) }
    }
}

@Composable
private fun ScanButton(scan: () -> Unit) {
    OutlinedButton(onClick = scan, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Filled.QrCodeScanner, contentDescription = null)
        Spacer(Modifier.size(8.dp))
        Text(stringResource(R.string.join_scan))
    }
}

@Composable
private fun Title(value: String) {
    Text(
        value,
        style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.Bold,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
fun ErrorText(value: String) {
    Text(value, color = Brand.danger, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
}
