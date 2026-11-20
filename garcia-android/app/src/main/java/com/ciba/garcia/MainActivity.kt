package com.ciba.garcia

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.result.PickVisualMediaRequest
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import com.facebook.CallbackManager
import com.facebook.FacebookCallback
import com.facebook.FacebookException
import com.facebook.login.LoginManager
import com.facebook.login.LoginResult

private val Ink = Color(0xFFFFFFFF)
private val Panel = Color(0xFFFFF8FB)
private val Blue = Color(0xFFD96E98)
private val Muted = Color(0xFF777777)

private data class GarciaChat(val id: String, val title: String, val messages: List<Pair<String, String>>, val archived: Boolean = false)
private data class GarciaAttachment(
    val type: String,
    val name: String,
    val text: String? = null,
    val mimeType: String? = null,
    val base64: String? = null
)

private fun displayName(context: Context, uri: Uri, fallback: String): String =
    context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: fallback

private fun readImageAttachment(context: Context, uri: Uri): GarciaAttachment {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        ?: throw IllegalArgumentException("Não foi possível abrir a foto.")
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("A imagem selecionada é inválida.")
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        ?: throw IllegalArgumentException("Não foi possível processar a foto.")
    val maxSide = maxOf(decoded.width, decoded.height)
    val bitmap = if (maxSide > 1280) {
        val scale = 1280f / maxSide
        Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt().coerceAtLeast(1), (decoded.height * scale).toInt().coerceAtLeast(1), true)
            .also { if (it !== decoded) decoded.recycle() }
    } else decoded
    val output = java.io.ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 82, output)
    bitmap.recycle()
    if (output.size() > 1_450_000) throw IllegalArgumentException("A foto ficou muito grande. Escolha uma imagem menor.")
    return GarciaAttachment(
        type = "image",
        name = displayName(context, uri, "foto.jpg").take(120),
        mimeType = "image/jpeg",
        base64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
    )
}

private fun readCapturedImage(bitmap: Bitmap): GarciaAttachment {
    val output = java.io.ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output)
    bitmap.recycle()
    if (output.size() > 1_450_000) throw IllegalArgumentException("A foto capturada ficou muito grande.")
    return GarciaAttachment(type = "image", name = "foto-camera.jpg", mimeType = "image/jpeg",
        base64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
}

private fun readTextAttachment(context: Context, uri: Uri): GarciaAttachment {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri)?.lowercase().orEmpty()
    val allowed = mime.startsWith("text/") || mime in setOf("application/json", "application/xml")
    if (!allowed) throw IllegalArgumentException("Por enquanto, anexe arquivos de texto, Markdown, CSV, JSON ou XML.")
    val name = displayName(context, uri, "arquivo.txt")
    val output = java.io.ByteArrayOutputStream()
    resolver.openInputStream(uri)?.use { stream ->
        val buffer = ByteArray(8192)
        var total = 0
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            total += count
            if (total > 8 * 1024) throw IllegalArgumentException("O arquivo deve ter no máximo 8 KB.")
            output.write(buffer, 0, count)
        }
    } ?: throw IllegalArgumentException("Não foi possível abrir o arquivo.")
    val content = output.toString(Charsets.UTF_8.name())
    if (content.isBlank()) throw IllegalArgumentException("O arquivo está vazio.")
    if (content.length > 1_000) throw IllegalArgumentException("O texto do arquivo deve ter no máximo 1.000 caracteres para respeitar o limite gratuito do chat.")
    return GarciaAttachment(type = "file", name = name.take(120), text = content)
}

private fun extractBrowserRequest(message: String): String? {
    val text = message.trim()
    val hasNavigationVerb = Regex("(?i)\\b(abra|acesse|acessa|entre|visite|navegue|vai para|vá para)\\b").containsMatchIn(text)
    if (!hasNavigationVerb) return null
    val url = Regex("(?i)(?:https?://)?(?:www\\.)?[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}(?:/[^\\s]*)?").find(text)?.value
    if (url != null) return url
    val sitePhrase = Regex("(?i)\\b(?:abra|acesse|entre|visite|navegue)\\s+(?:no\\s+|na\\s+|em\\s+|o\\s+|a\\s+)?site\\s+(?:da\\s+|do\\s+)?(.+)$").find(text)
    return sitePhrase?.groupValues?.get(1)?.trim()?.takeIf { it.isNotBlank() }
}

private fun extractBrowserTask(message: String): String? {
    val task = Regex("(?i)\\b(?:pesquise|pesquisar|procure|busque|buscar|encontre)\\s+(?:por\\s+)?(.+)$").find(message)?.groupValues?.get(1)?.trim()
    return task?.takeIf { it.isNotBlank() }?.let { "pesquise $it" }
}

private val photoMarker = Regex("\\[\\[foto:(https://[^\\]\\s]+)\\]\\]")

private fun splitPhotos(text: String): Pair<String, List<String>> =
    photoMarker.replace(text, "").trim() to photoMarker.findAll(text).map { it.groupValues[1] }.toList()

class MainActivity : ComponentActivity() {
    private val facebookCallbackManager: CallbackManager = CallbackManager.Factory.create()
    private var pendingFacebookResult: ((Result<String>) -> Unit)? = null
    private var facebookExternalScreenOpened = false
    private val facebookReturnWatchdog = android.os.Handler(android.os.Looper.getMainLooper())
    private val facebookReturnTimeout = Runnable {
        completeFacebookLogin(
            Result.failure(
                IllegalStateException(
                    "O Facebook voltou para a Garcia sem concluir a autorização. Nenhuma conta foi vinculada. Tente novamente; se persistir, verifique a configuração do aplicativo na Meta."
                )
            )
        )
    }

    private fun completeFacebookLogin(result: Result<String>) {
        val callback = pendingFacebookResult ?: return
        pendingFacebookResult = null
        facebookExternalScreenOpened = false
        facebookReturnWatchdog.removeCallbacks(facebookReturnTimeout)
        callback(result)
    }

    fun startFacebookLogin(onResult: (Result<String>) -> Unit) {
        if (pendingFacebookResult != null) {
            onResult(Result.failure(IllegalStateException("Já existe uma autenticação do Facebook em andamento.")))
            return
        }
        pendingFacebookResult = onResult
        facebookExternalScreenOpened = false

        LoginManager.getInstance().registerCallback(facebookCallbackManager, object : FacebookCallback<LoginResult> {
            override fun onSuccess(result: LoginResult) {
                val token = result.accessToken.token
                if (token.isBlank()) {
                    completeFacebookLogin(Result.failure(IllegalStateException("O Facebook retornou uma autorização sem token de acesso.")))
                } else {
                    completeFacebookLogin(Result.success(token))
                }
            }
            override fun onCancel() {
                completeFacebookLogin(
                    Result.failure(IllegalStateException("A autenticação foi cancelada ou recusada no Facebook. Nenhuma conta foi vinculada."))
                )
            }
            override fun onError(error: FacebookException) {
                completeFacebookLogin(
                    Result.failure(IllegalStateException("Falha na autenticação do Facebook: ${error.message ?: error.javaClass.simpleName}", error))
                )
            }
        })

        try {
            LoginManager.getInstance().setLoginBehavior(com.facebook.login.LoginBehavior.WEB_ONLY)
            LoginManager.getInstance().logOut()
            LoginManager.getInstance().logInWithReadPermissions(
                this,
                listOf("public_profile", "user_posts", "user_photos", "user_videos")
            )
            GarciaLog.recordEvent(this, "Facebook", "Fluxo WEB_ONLY iniciado; aguardando retorno do OAuth.")
        } catch (error: Exception) {
            completeFacebookLogin(
                Result.failure(IllegalStateException("Não foi possível abrir a autenticação do Facebook: ${error.message ?: error.javaClass.simpleName}", error))
            )
        }
    }

    override fun onPause() {
        super.onPause()
        if (pendingFacebookResult != null) facebookExternalScreenOpened = true
    }

    override fun onResume() {
        super.onResume()
        if (pendingFacebookResult != null && facebookExternalScreenOpened) {
            facebookExternalScreenOpened = false
            facebookReturnWatchdog.removeCallbacks(facebookReturnTimeout)
            facebookReturnWatchdog.postDelayed(facebookReturnTimeout, 2500L)
        }
    }

    @Deprecated("Facebook SDK callback bridge")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        facebookCallbackManager.onActivityResult(requestCode, resultCode, data)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        // Voice conversation must always be started explicitly by the user for each app session.
        getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", false).apply()
        val store = SecureStore(this)
        val client = CibaAiClient(store)
        setContent { GarciaApp(store, client) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GarciaApp(store: SecureStore, client: CibaAiClient) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val chats = remember {
        mutableStateListOf<GarciaChat>().apply {
            val savedChats = store.loadChats()
            for (i in 0 until savedChats.length()) runCatching {
                val item = savedChats.getJSONObject(i)
                val messagesJson = item.optJSONArray("messages") ?: JSONArray()
                val messages = mutableListOf<Pair<String, String>>()
                for (j in 0 until messagesJson.length()) {
                    val message = messagesJson.getJSONObject(j)
                    messages.add(message.getString("role") to message.getString("content"))
                }
                add(GarciaChat(item.getString("id"), item.optString("title", "Nova conversa"), messages, item.optBoolean("archived", false)))
            }
            if (isEmpty()) {
                val legacy = store.loadHistory()
                val messages = mutableListOf<Pair<String, String>>()
                for (i in 0 until legacy.length()) runCatching {
                    val item = legacy.getJSONObject(i)
                    messages.add(item.getString("role") to item.getString("content"))
                }
                add(GarciaChat(UUID.randomUUID().toString(), "Conversa anterior", messages))
            }
        }
    }
    var currentChatId by remember { mutableStateOf(chats.first().id) }
    val history = remember { mutableStateListOf<Pair<String, String>>().apply { addAll(chats.first().messages) } }
    var input by remember { mutableStateOf("") }
    var attachment by remember { mutableStateOf<GarciaAttachment?>(null) }
    val whisperModelStore = remember { WhisperModelStore(context) }
    val whisperRecorder = remember { WhisperAudioRecorder() }
    var whisperModelInfo by remember { mutableStateOf<WhisperModelStore.ModelInfo?>(null) }
    var whisperStatus by remember { mutableStateOf("Modelo de voz não instalado") }
    var whisperRecording by remember { mutableStateOf(false) }
    var whisperBusy by remember { mutableStateOf(false) }
    var whisperDownloadProgress by remember { mutableIntStateOf(0) }
    var voiceAutoSendPending by remember { mutableStateOf(false) }
    var voiceAvailable by remember { mutableStateOf(false) }
    var voiceStatus by remember { mutableStateOf("Verificando voz offline…") }
    var voiceReplies by remember { mutableStateOf(context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).getBoolean("enabled", true)) }
    var voiceSpeaking by remember { mutableStateOf(false) }
    var continuousVoice by remember { mutableStateOf(context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).getBoolean("continuous", false)) }
    var autoListenPending by remember { mutableStateOf(false) }
    var awaitingTranscriptReview by remember { mutableStateOf(false) }
    var streamingListening by remember { mutableStateOf(false) }
    var streamingUnavailable by remember { mutableStateOf(false) }
    var streamingTranscript by remember { mutableStateOf("") }
    val streamingSpeech = remember {
        OnDeviceSpeechRecognizer(
            context,
            onPartial = { partial -> streamingTranscript = partial },
            onFinal = { transcript ->
                streamingListening = false
                streamingTranscript = transcript
                input = transcript
                awaitingTranscriptReview = false
                autoListenPending = false
                voiceAutoSendPending = true
                whisperStatus = "Fala reconhecida · enviando automaticamente"
            },
            onError = { message, retry ->
                streamingListening = false
                whisperStatus = message
                if (retry && continuousVoice && voiceReplies) {
                    autoListenPending = true
                } else if (continuousVoice && voiceReplies && whisperModelInfo != null) {
                    streamingUnavailable = true
                    whisperStatus = "$message Usando Whisper local."
                    autoListenPending = true
                } else {
                    continuousVoice = false
                    context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE)
                        .edit().putBoolean("continuous", false).apply()
                }
            }
        )
    }
    DisposableEffect(streamingSpeech) { onDispose { streamingSpeech.stop() } }
    val voiceOutput = remember {
        LocalSpeechOutput(
            context,
            { available, message -> voiceAvailable = available; voiceStatus = message },
            { voiceSpeaking = false; if (continuousVoice && voiceReplies && !awaitingTranscriptReview && input.isBlank()) autoListenPending = true },
            { voiceSpeaking = true }
        )
    }
    DisposableEffect(voiceOutput) { onDispose { voiceOutput.shutdown(); whisperRecorder.cancel() } }
    var showAttachmentOptions by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("Verificando conexão…") }
    var error by remember { mutableStateOf("") }
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) runCatching { readImageAttachment(context, uri) }
            .onSuccess { attachment = it; error = "" }
            .onFailure { error = it.message ?: "Não foi possível anexar a foto." }
    }
    val attachmentPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) runCatching { readTextAttachment(context, uri) }
            .onSuccess { attachment = it; error = "" }
            .onFailure { error = it.message ?: "Não foi possível anexar o arquivo." }
    }
    val cameraPicker = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap != null) runCatching { readCapturedImage(bitmap) }
            .onSuccess { attachment = it; error = "" }
            .onFailure { error = it.message ?: "Não foi possível capturar a foto." }
    }
    val whisperModelPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            whisperBusy = true
            whisperStatus = "Importando e verificando modelo…"
            try {
                val info = withContext(Dispatchers.IO) {
                    val imported = whisperModelStore.importModel(uri)
                    check(WhisperNative.nativeLoadModel(imported.file.absolutePath)) { "O Whisper não conseguiu carregar esse modelo." }
                    imported
                }
                whisperModelInfo = info
                whisperStatus = "Whisper pronto · SHA-256 ${info.sha256.take(12)}…"
                GarciaLog.recordEvent(context, "Voz", "Modelo Whisper importado e carregado localmente; SHA-256 ${info.sha256}")
            } catch (e: Exception) {
                whisperModelInfo = null
                whisperStatus = e.message ?: "Não foi possível instalar o modelo."
                GarciaLog.record(context, "Whisper modelo", e)
            } finally { whisperBusy = false }
        }
    }
    fun stopAndTranscribe() {
        if (!whisperRecording || whisperBusy) return
        whisperRecording = false
        whisperBusy = true
        whisperStatus = "Transcrevendo localmente…"
        scope.launch {
            try {
                val samples = withContext(Dispatchers.IO) { whisperRecorder.stop() }
                val audioDurationMs = samples.size * 1000L / WhisperAudioRecorder.SAMPLE_RATE
                val transcriptionStartedAt = SystemClock.elapsedRealtime()
                val transcript = try {
                    check(samples.size >= 1600) { "Gravação muito curta. Fale por pelo menos um segundo." }
                    val result = withContext(Dispatchers.Default) {
                        JSONObject(WhisperNative.nativeTranscribe(samples, "pt", Runtime.getRuntime().availableProcessors().coerceIn(2, 4)))
                    }
                    result.optString("text").trim()
                } finally {
                    samples.fill(0f)
                }
                val inferenceMs = SystemClock.elapsedRealtime() - transcriptionStartedAt
                val realtimeFactor = if (audioDurationMs > 0) inferenceMs.toDouble() / audioDurationMs else 0.0
                GarciaLog.recordEvent(
                    context,
                    "Desempenho de voz",
                    "Whisper: áudio ${audioDurationMs}ms · transcrição ${inferenceMs}ms · fator ${"%.2f".format(java.util.Locale.US, realtimeFactor)}x"
                )
                check(transcript.isNotBlank()) { "Não foi possível reconhecer fala nessa gravação." }
                if (continuousVoice) {
                    input = transcript
                    awaitingTranscriptReview = false
                    voiceAutoSendPending = true
                    whisperStatus = "Fala reconhecida · enviando automaticamente"
                } else {
                    input = listOf(input.trim(), transcript).filter { it.isNotBlank() }.joinToString(" ")
                    awaitingTranscriptReview = true
                    autoListenPending = false
                    whisperStatus = "Transcrição pronta · revise o texto antes de enviar"
                }
                GarciaLog.recordEvent(context, "Voz", "Transcrição local concluída · ${transcript.length} caracteres")
            } catch (e: Exception) {
                whisperStatus = e.message ?: "Falha na transcrição local"
                GarciaLog.record(context, "Whisper transcrição", e)
            } finally { whisperBusy = false }
        }
    }


    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            if (attachment != null || busy || whisperBusy) {
                error = "Conclua a operação atual e remova o anexo antes de iniciar outra captura."
            } else if (continuousVoice && streamingSpeech.isAvailable && !streamingUnavailable) {
                streamingTranscript = ""
                error = ""
                streamingListening = streamingSpeech.start()
                whisperStatus = if (streamingListening) "Reconhecimento offline em tempo real ativo" else whisperStatus
            } else if (whisperModelInfo == null) {
                error = "Instale um modelo Whisper em Configurações antes de gravar."
            } else scope.launch {
                try {
                    withContext(Dispatchers.IO) { whisperRecorder.start() }
                    whisperRecording = true
                    whisperStatus = "Gravando… toque em parar quando terminar"
                    scope.launch {
                        try {
                            val stopReason = withContext(Dispatchers.IO) {
                                while (whisperRecorder.readChunk()) { /* capture locally */ }
                                whisperRecorder.stopReason
                            }
                            if (whisperRecording) {
                                if (stopReason == VoiceActivityDetector.StopReason.NO_SPEECH) {
                                    whisperRecording = false
                                    withContext(Dispatchers.IO) { whisperRecorder.cancel() }
                                    whisperStatus = "Não detectei fala. Aguardando sua voz…"
                                    if (continuousVoice) autoListenPending = true
                                } else {
                                    stopAndTranscribe()
                                }
                            }
                        } catch (captureError: Exception) {
                            whisperRecording = false
                            withContext(Dispatchers.IO) { whisperRecorder.cancel() }
                            whisperStatus = captureError.message ?: "A captura de voz foi interrompida."
                            GarciaLog.record(context, "Whisper captura", captureError)
                        }
                    }
                } catch (e: Exception) { error = e.message ?: "Não foi possível iniciar a gravação."; whisperRecording = false }
            }
        } else {
            continuousVoice = false
            context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", false).apply()
            error = "A permissão do microfone foi negada. Ative-a nas configurações do Android para conversar por voz."
        }
    }
    LaunchedEffect(autoListenPending, continuousVoice, voiceReplies, input, attachment, busy, whisperBusy, whisperRecording) {
        if (!autoListenPending) return@LaunchedEffect
        if (!continuousVoice || !voiceReplies || input.isNotBlank() || attachment != null || whisperBusy || whisperRecording || streamingListening) {
            autoListenPending = false
        } else if (!busy) {
            autoListenPending = false
            microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) cameraPicker.launch(null)
        else error = "A permissão da câmera foi negada. Ative-a nas configurações do Android para fotografar."
    }
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                whisperModelStore.loadSavedModel()?.also { info ->
                    check(WhisperNative.nativeLoadModel(info.file.absolutePath)) { "O Whisper não conseguiu carregar o modelo salvo." }
                    info
                }
            }.onSuccess { info ->
                whisperModelInfo = info
                whisperStatus = if (info != null) "Whisper pronto · SHA-256 ${info.sha256.take(12)}…" else "Modelo de voz não instalado"
            }.onFailure { whisperStatus = it.message ?: "Modelo salvo inválido"; GarciaLog.record(context, "Whisper inicialização", it) }
        }
    }
    var activation by remember { mutableStateOf("") }
    var pairingCode by remember { mutableStateOf("") }
    var showSettings by remember { mutableStateOf(false) }
    var settingsSection by remember { mutableStateOf("menu") }
    var showBrowser by remember { mutableStateOf(false) }
    var browserStartRequest by remember { mutableStateOf<String?>(null) }
    var browserAutoSendPending by remember { mutableStateOf(false) }
    var browserStartTask by remember { mutableStateOf<String?>(null) }
    var showLogs by remember { mutableStateOf(false) }
    var showChats by remember { mutableStateOf(false) }
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    var showArchived by remember { mutableStateOf(false) }
    var menuChatId by remember { mutableStateOf<String?>(null) }
    var renameChatId by remember { mutableStateOf<String?>(null) }
    var renameTitle by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }
    var logs by remember { mutableStateOf("") }
    var usage by remember { mutableStateOf("") }
    var usageError by remember { mutableStateOf("") }
    var loadingUsage by remember { mutableStateOf(false) }
    var facebookLinked by remember { mutableStateOf(false) }
    var facebookBusy by remember { mutableStateOf(false) }
    var facebookError by remember { mutableStateOf("") }
    var showFacebookErrorDialog by remember { mutableStateOf(false) }
    var facebookStatusLoaded by remember { mutableStateOf(false) }
    var showFacebookManager by remember { mutableStateOf(false) }
    var connected by remember { mutableStateOf(store.get("device_token") != null) }
    val chatListState = androidx.compose.foundation.lazy.rememberLazyListState()

    LaunchedEffect(history.size, busy) {
        if (history.isNotEmpty()) {
            val lastItem = history.lastIndex + if (busy) 1 else 0
            chatListState.animateScrollToItem(lastItem.coerceAtLeast(0))
        }
    }

    fun persist() {
        val index = chats.indexOfFirst { it.id == currentChatId }
        val firstUser = history.firstOrNull { it.first == "user" }?.second.orEmpty()
        val title = firstUser.replace("\\s+".toRegex(), " ").take(42).ifBlank { "Nova conversa" }
        val old = chats.getOrNull(index)
        val current = GarciaChat(currentChatId, old?.title?.takeIf { it != "Nova conversa" } ?: title, history.toList(), old?.archived ?: false)
        if (index >= 0) chats[index] = current else chats.add(current)
        val array = JSONArray()
        chats.forEach { chat ->
            val messages = JSONArray()
            chat.messages.forEach { (role, content) -> messages.put(JSONObject().put("role", role).put("content", content)) }
            array.put(JSONObject().put("id", chat.id).put("title", chat.title).put("archived", chat.archived).put("messages", messages))
        }
        store.saveChats(array)
        store.saveHistory(JSONArray().apply {
            history.forEach { (role, content) -> put(JSONObject().put("role", role).put("content", content)) }
        })
    }

    fun selectChat(chat: GarciaChat) {
        if (busy) return
        autoListenPending = false
        awaitingTranscriptReview = false
        continuousVoice = false
        context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", false).apply()
        if (whisperRecording) { whisperRecording = false; whisperRecorder.cancel() }
        streamingSpeech.stop(); streamingListening = false
        voiceOutput.stop()
        persist()
        currentChatId = chat.id
        history.clear()
        history.addAll(chat.messages)
        input = ""
        error = ""
        showChats = false
    }

    fun newChat() {
        if (busy) return
        autoListenPending = false
        awaitingTranscriptReview = false
        continuousVoice = false
        context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", false).apply()
        if (whisperRecording) { whisperRecording = false; whisperRecorder.cancel() }
        streamingSpeech.stop(); streamingListening = false
        voiceOutput.stop()
        persist()
        val chat = GarciaChat(UUID.randomUUID().toString(), "Nova conversa", emptyList())
        chats.add(chat)
        currentChatId = chat.id
        history.clear()
        input = ""
        error = ""
        persist()
    }

    fun deleteChat(chat: GarciaChat) {
        if (busy) return
        chats.removeAll { it.id == chat.id }
        if (currentChatId == chat.id) {
            val next = chats.lastOrNull { !it.archived } ?: GarciaChat(UUID.randomUUID().toString(), "Nova conversa", emptyList()).also { chats.add(it) }
            currentChatId = next.id
            history.clear(); history.addAll(next.messages); input = ""; error = ""
        }
        persist()
    }

    fun renameChat(chat: GarciaChat, title: String) {
        val index = chats.indexOfFirst { it.id == chat.id }
        if (index >= 0 && title.isNotBlank()) chats[index] = chat.copy(title = title.trim().take(60))
        persist()
    }

    fun deleteCurrentChat() {
        if (busy) return
        chats.removeAll { it.id == currentChatId }
        val next = chats.lastOrNull() ?: GarciaChat(UUID.randomUUID().toString(), "Nova conversa", emptyList()).also { chats.add(it) }
        currentChatId = next.id
        history.clear()
        history.addAll(next.messages)
        input = ""
        error = ""
        confirmDelete = false
        persist()
    }

    fun activate() {
        if (activation.isBlank() || busy) return
        busy = true; error = ""
        scope.launch {
            try {
                withContext(Dispatchers.IO) { client.activate(activation.trim(), pairingCode.trim()) }
                connected = true
                status = "Conectada ao serviço da Garcia"
                activation = ""
                pairingCode = ""
            } catch (e: Exception) { GarciaLog.record(context, "ativação", e); error = e.message ?: "Não foi possível ativar." }
            finally { busy = false }
        }
    }

    fun send() {
        val text = input.trim()
        val selectedAttachment = attachment
        if ((text.isEmpty() && selectedAttachment == null) || busy || !connected) return
        if (selectedAttachment == null) {
            val browserRequest = extractBrowserRequest(text)
            if (browserRequest != null) {
                browserStartRequest = browserRequest
                browserStartTask = extractBrowserTask(text)
                showBrowser = true
                input = ""
                error = ""
                return
            }
        }
        val message = when (selectedAttachment?.type) {
            "file" -> buildString {
                append("Arquivo anexado: ").append(selectedAttachment.name).append("\n\n")
                append("<conteudo_do_arquivo>\n").append(selectedAttachment.text.orEmpty()).append("\n</conteudo_do_arquivo>")
                if (text.isNotBlank()) append("\n\nPergunta: ").append(text)
            }
            "image" -> buildString {
                append(text.ifBlank { "Analise a foto anexada e descreva o que você consegue identificar." })
                append("\n[Foto anexada: ").append(selectedAttachment.name).append("]")
            }
            else -> text
        }
        val messageLimit = if (browserAutoSendPending) 18_000 else 1_500
        if (message.length > messageLimit) {
            error = if (browserAutoSendPending) "O conteúdo desta página é grande demais para análise automática." else "A mensagem com o anexo ultrapassa o limite de 1.500 caracteres. Reduza a pergunta ou o conteúdo do arquivo."
            browserAutoSendPending = false
            return
        }
        val imagePayload = JSONArray()
        if (selectedAttachment?.type == "image") {
            imagePayload.put(JSONObject()
                .put("mime_type", selectedAttachment.mimeType)
                .put("data", selectedAttachment.base64))
        }
        browserAutoSendPending = false
        history.add("user" to message); input = ""; attachment = null; awaitingTranscriptReview = false
        autoListenPending = false; persist(); busy = true; error = ""
        scope.launch {
            try {
                val latestQuestion = history.lastOrNull { it.first == "user" }?.second.orEmpty()
                val webContext = withContext(Dispatchers.IO) {
                    val capability = "INFORMAÇÃO OPERACIONAL: este aplicativo possui conexão com o serviço da Garcia e navegador interno. Você pode receber resultados de pesquisa pública anexados ao contexto desta mensagem. Nunca afirme que não existe acesso à internet de forma absoluta; diferencie pesquisa automática, navegação manual e conexão com o serviço. Se não houver fontes anexadas, não diga que pesquisou."
                    if (GarciaWebSearch.needsSearch(latestQuestion)) {
                        runCatching { capability + "\n\n" + GarciaWebSearch.searchContext(latestQuestion) }
                            .onFailure { GarciaLog.record(context, "Pesquisa na internet", it) }
                            .getOrElse { capability + "\n\nA pesquisa automática falhou nesta solicitação: ${it.message ?: "erro de conexão"}. Não afirme que consultou fontes." }
                    } else capability
                }
                val snapshot = JSONArray()
                history.forEachIndexed { index, (role, content) ->
                    if (index == history.lastIndex && role == "user") {
                        snapshot.put(JSONObject().put("role", "user").put("content", webContext))
                    }
                    snapshot.put(JSONObject().put("role", role).put("content", content))
                }
                val answer = withContext(Dispatchers.IO) { client.chat(snapshot, imagePayload) }
                history.add("assistant" to answer); persist()
                if (continuousVoice && voiceReplies && voiceAvailable) {
                    val spoken = voiceOutput.speak(answer)
                    if (!spoken) autoListenPending = false
                } else autoListenPending = false
                GarciaLog.recordEvent(context, "chat", "HTTP 200 · resposta recebida e salva no histórico · ${answer.length} caracteres")
            } catch (e: Exception) { GarciaLog.record(context, "chat", e); error = e.message ?: "Falha ao conversar com a Garcia." }
            finally { busy = false }
        }
    }

    LaunchedEffect(voiceAutoSendPending, continuousVoice, busy, input) {
        if (voiceAutoSendPending && continuousVoice && !busy && input.isNotBlank()) {
            voiceAutoSendPending = false
            send()
        }
    }

    LaunchedEffect(browserAutoSendPending, busy, input, connected) {
        if (browserAutoSendPending && !busy && input.isNotBlank() && connected) {
            browserAutoSendPending = false
            send()
        }
    }

    fun connectFacebook() {
        if (facebookBusy || !connected) return
        val activity = context as? MainActivity
        if (activity == null) {
            facebookError = "Não foi possível iniciar o login com Facebook nesta tela."
            return
        }
        facebookBusy = true
        facebookError = ""
        GarciaLog.recordEvent(context, "Facebook", "Iniciando fluxo de vinculação.")
        activity.startFacebookLogin { loginResult ->
            loginResult.onSuccess { accessToken ->
                GarciaLog.recordEvent(context, "Facebook", "Login concluído; enviando solicitação de vínculo à Garcia.")
                scope.launch {
                    try {
                        val result = withContext(Dispatchers.IO) { client.linkFacebook(accessToken) }
                        val linkExists = result.optBoolean("linked", false)
                        val tokenStored = result.optBoolean("token_stored", false)
                        facebookLinked = linkExists && tokenStored
                        if (linkExists && !tokenStored) {
                            facebookError = "O Facebook consta como vinculado, mas o servidor não tem o token de acesso. A conexão está incompleta."
                            GarciaLog.recordEvent(context, "Facebook", "Vínculo antigo encontrado sem token armazenado.")
                        } else {
                            facebookError = ""
                            GarciaLog.recordEvent(context, "Facebook", "Status verificado · linked=$linkExists · token_stored=$tokenStored")
                        }
                        GarciaLog.recordEvent(context, "Facebook", if (facebookLinked) "Vínculo confirmado pelo servidor." else "Servidor respondeu sem confirmar o vínculo.")
                        if (!facebookLinked) {
                            facebookError = if (linkExists && !tokenStored) "O Facebook foi identificado, mas o servidor não confirmou o armazenamento do token." else "O servidor não confirmou o vínculo completo."
                        } else {
                            facebookStatusLoaded = false
                            showSettings = false
                            showFacebookManager = true
                        }
                    } catch (e: Exception) {
                        GarciaLog.record(context, "Facebook", e)
                        facebookError = e.message ?: "Não foi possível vincular o Facebook."
                        showFacebookErrorDialog = true
                    } finally {
                        facebookBusy = false
                    }
                }
            }.onFailure { e ->
                GarciaLog.record(context, "Facebook login", e)
                facebookError = e.message ?: "Falha no login com Facebook."
                showFacebookErrorDialog = true
                facebookBusy = false
            }
        }
    }

    fun loadUsage() {
        if (loadingUsage || !connected) return
        loadingUsage = true
        usageError = ""
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { client.usage() }
                val buckets = result.optJSONArray("buckets") ?: JSONArray()
                val day = result.optString("day", "hoje")
                val lines = mutableListOf("Data (UTC): $day")
                for (i in 0 until buckets.length()) {
                    val item = buckets.getJSONObject(i)
                    val key = item.optString("scope_key")
                    val label = when {
                        key == "global" -> "Global"
                        key == "app:${CibaAiClient.APP_ID}" -> "Aplicativo Garcia"
                        key.startsWith("device:") -> "Este dispositivo"
                        else -> key
                    }
                    lines.add("$label: ${item.optInt("requests", 0)} / ${item.optInt("request_limit", 0)} solicitações")
                }
                usage = if (buckets.length() == 0) "Ainda não há solicitações contabilizadas hoje.\nData (UTC): $day" else lines.joinToString("\n")
                GarciaLog.recordEvent(context, "uso", "Consulta de uso concluída · ${buckets.length()} limites")
            } catch (e: Exception) {
                usageError = e.message ?: "Não foi possível consultar o uso."
                GarciaLog.record(context, "uso", e)
            } finally { loadingUsage = false }
        }
    }

    LaunchedEffect(Unit) {
        try {
            val result = withContext(Dispatchers.IO) { client.status() }
            status = if (result.optString("status") == "ready") "Garcia conectada" else "Serviço indisponível"
        } catch (e: Exception) { GarciaLog.record(context, "conexão", e); status = "Sem conexão com o serviço da Garcia" }
    }

    LaunchedEffect(showSettings, connected) {
        if (showSettings && connected && !facebookStatusLoaded) {
            try {
                val result = withContext(Dispatchers.IO) { client.facebookStatus() }
                val linkExists = result.optBoolean("linked", false)
                        val tokenStored = result.optBoolean("token_stored", false)
                        facebookLinked = linkExists && tokenStored
                        GarciaLog.recordEvent(context, "Facebook", "Resposta do vínculo · linked=$linkExists · token_stored=$tokenStored")
                facebookStatusLoaded = true
            } catch (e: Exception) {
                facebookError = e.message ?: "Não foi possível consultar o vínculo Facebook."
            }
        }
    }

    MaterialTheme(colorScheme = lightColorScheme(
        primary = Blue, background = Ink, surface = Color.White, onBackground = Color(0xFF303030),
        onSurface = Color(0xFF303030), secondary = Muted
    )) {
      ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = connected && !busy && !continuousVoice,
        drawerContent = {
          ModalDrawerSheet(Modifier.width(310.dp), drawerContainerColor = Color(0xFFF8F7F5)) {
            Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
              Row(Modifier.fillMaxWidth().padding(vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.ic_garcia), null, Modifier.size(34.dp))
                Spacer(Modifier.width(10.dp)); Text("Garcia", fontWeight = FontWeight.Bold, fontSize = 20.sp)
              }
              Button(onClick = { newChat(); scope.launch { drawerState.close() } }, modifier = Modifier.fillMaxWidth(), enabled = !busy) { Text("+ Nova conversa") }
              Spacer(Modifier.height(12.dp))
              Text("Conversas", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp, top = 8.dp, bottom = 6.dp))
              LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                items(chats.filter { it.archived == showArchived }.asReversed(), key = { it.id }) { chat ->
                  Row(Modifier.fillMaxWidth().background(if (chat.id == currentChatId) Color(0xFFECE9E5) else Color.Transparent, RoundedCornerShape(10.dp)).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { selectChat(chat); scope.launch { drawerState.close() } }, modifier = Modifier.weight(1f), contentPadding = PaddingValues(vertical = 8.dp, horizontal = 2.dp)) {
                      Text(chat.title, maxLines = 1, color = Color(0xFF292929), modifier = Modifier.fillMaxWidth())
                    }
                    Box {
                      IconButton(onClick = { menuChatId = if (menuChatId == chat.id) null else chat.id }) { Icon(Icons.Default.MoreVert, "Opções da conversa") }
                      DropdownMenu(expanded = menuChatId == chat.id, onDismissRequest = { menuChatId = null }) {
                        DropdownMenuItem(text = { Text("Editar nome") }, leadingIcon = { Icon(Icons.Default.Edit, null) }, onClick = { renameChatId = chat.id; renameTitle = chat.title; menuChatId = null })
                        DropdownMenuItem(text = { Text(if (chat.archived) "Desarquivar" else "Arquivar") }, leadingIcon = { Icon(Icons.Default.Archive, null) }, onClick = { val i = chats.indexOfFirst { it.id == chat.id }; if (i >= 0) chats[i] = chat.copy(archived = !chat.archived); persist(); menuChatId = null; if (chat.id == currentChatId && !chat.archived) { val next = chats.lastOrNull { !it.archived }; if (next != null) selectChat(next) } })
                        DropdownMenuItem(text = { Text("Excluir", color = Color(0xFFB3261E)) }, leadingIcon = { Icon(Icons.Default.Delete, null, tint = Color(0xFFB3261E)) }, onClick = { deleteChat(chat); menuChatId = null })
                      }
                    }
                  }
                }
                if (chats.none { it.archived == showArchived }) item { Text(if (showArchived) "Nenhuma conversa arquivada" else "Nenhuma conversa ainda", color = Muted, modifier = Modifier.padding(12.dp)) }
              }
              TextButton(onClick = { showArchived = !showArchived }, modifier = Modifier.fillMaxWidth()) { Text(if (showArchived) "← Voltar às conversas" else "Conversas arquivadas") }
              HorizontalDivider()
              TextButton(onClick = { showBrowser = true; scope.launch { drawerState.close() } }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.Search, null); Spacer(Modifier.width(8.dp)); Text("Pesquisar na internet") }
               TextButton(onClick = { settingsSection = "menu"; showSettings = true; scope.launch { drawerState.close() } }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.Settings, null); Spacer(Modifier.width(8.dp)); Text("Configurações") }
            }
          }
        }
      ) {
        Scaffold(containerColor = Ink, topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.ic_garcia), contentDescription = "Símbolo Garcia", modifier = Modifier.size(42.dp))
                        Spacer(Modifier.width(11.dp))
                        Column {
                            Text("Garcia", fontWeight = FontWeight.Bold, fontSize = 19.sp)
                            Text(status, color = Muted, fontSize = 11.sp)
                        }
                    }
                },
                navigationIcon = { if (connected && !continuousVoice) IconButton(onClick = { scope.launch { drawerState.open() } }) { Icon(Icons.Default.Menu, "Abrir menu") } },
                actions = { if (connected && !continuousVoice) IconButton(onClick = { newChat() }, enabled = !busy) { Icon(Icons.Default.Edit, "Nova conversa") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink)
            )
        }, bottomBar = {
            if (connected) {
                Column(Modifier.fillMaxWidth().background(Panel).imePadding().navigationBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp)) {
                    if (attachment != null) {
                        Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("${if (attachment!!.type == "image") "Foto" else "Arquivo"}: ${attachment!!.name}", color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                            TextButton(onClick = { attachment = null }) { Text("Remover") }
                        }
                    }
                    Button(
                        onClick = {
                            if (continuousVoice) {
                                continuousVoice = false
                                context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", false).apply()
                                autoListenPending = false
                                voiceAutoSendPending = false
                                voiceOutput.stop()
                                if (whisperRecording) scope.launch(Dispatchers.IO) { whisperRecorder.cancel() }
                                streamingSpeech.stop(); streamingListening = false
                                whisperRecording = false
                                whisperStatus = "Conversa por voz encerrada"
                            } else if (!whisperBusy) {
                                if (whisperModelInfo == null && !streamingSpeech.isAvailable) error = "Este aparelho não oferece reconhecimento offline em tempo real. Baixe e instale o modelo Whisper nas Configurações."
                                else if (!voiceAvailable) error = "A voz offline em português não está pronta. Configure a voz do Android nas Configurações."
                                else if (input.isNotBlank() || attachment != null) error = "Envie ou limpe o texto pendente antes de iniciar a conversa por voz."
                                else {
                                    streamingUnavailable = false
                                    streamingTranscript = ""
                                    continuousVoice = true
                                    voiceReplies = true
                                    context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", true).putBoolean("enabled", true).apply()
                                    autoListenPending = false
                                    microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
                                }
                            }
                        },
                        enabled = (!busy && !whisperBusy && (whisperModelInfo != null || (streamingSpeech.isAvailable && !streamingUnavailable))) || continuousVoice,
                        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = if (continuousVoice) Color(0xFFB94F7C) else Blue)
                    ) {
                        Icon(if (continuousVoice) Icons.Default.Stop else Icons.Default.Mic, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (continuousVoice) "Encerrar conversa por voz" else "Conversar por voz")
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { showAttachmentOptions = true }, enabled = !busy,
                        modifier = Modifier.size(44.dp).background(Color(0xFFF1E8ED), CircleShape)) {
                        Icon(Icons.Default.AttachFile, contentDescription = "Adicionar foto ou arquivo", tint = Blue)
                    }
                    IconButton(
                        onClick = {
                            if (whisperRecording) {
                                stopAndTranscribe()
                            } else if (whisperModelInfo == null) {
                                error = "Instale o modelo Whisper nas Configurações para ditar mensagens."
                            } else if (!whisperBusy && !busy && !continuousVoice) {
                                microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        },
                        enabled = !busy && !whisperBusy && !continuousVoice && whisperModelInfo != null,
                        modifier = Modifier.size(44.dp).background(
                            if (whisperRecording) Color(0xFFFCE4EC) else Color(0xFFE8EEF8),
                            CircleShape
                        )
                    ) {
                        Icon(
                            if (whisperRecording) Icons.Default.Stop else Icons.Default.Mic,
                            contentDescription = if (whisperRecording) "Parar e transcrever" else "Falar para digitar",
                            tint = if (whisperRecording) Color(0xFFB94F7C) else Blue
                        )
                    }
                    BasicTextField(value = input, onValueChange = { input = it; if (it.isNotBlank()) autoListenPending = false },
                        modifier = Modifier.weight(1f).background(Color(0xFFF6EDF2), RoundedCornerShape(22.dp)).padding(horizontal = 17.dp, vertical = 12.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(color = Color(0xFF303030), fontSize = 15.sp, lineHeight = 21.sp),
                        minLines = 1, maxLines = 5,
                        decorationBox = { inner -> Box { if (input.isBlank()) Text("Converse com a Garcia…", color = Muted); inner() } })
                    Spacer(Modifier.width(7.dp))

                    IconButton(onClick = { send() }, enabled = !busy && (input.isNotBlank() || attachment != null),
                        modifier = Modifier.size(48.dp).background(Blue, CircleShape)) {
                        Icon(Icons.Default.ArrowUpward, "Enviar", tint = Color.White)
                    }
                    }
                }
            }
        }) { padding ->
            if (!connected) {
                Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), verticalArrangement = Arrangement.Center) {
                    Text("Sua inteligência pessoal.", fontSize = 30.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    Text("A Garcia funciona de forma independente. Para vincular este único dispositivo, informe os dois códigos privados de provisionamento emitidos para este aparelho.", color = Muted)
                    Spacer(Modifier.height(22.dp))
                    OutlinedTextField(activation, { activation = it }, Modifier.fillMaxWidth(), label = { Text("Código privado de registro") }, singleLine = true)
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(pairingCode, { pairingCode = it }, Modifier.fillMaxWidth(), label = { Text("Código de vínculo do proprietário") }, singleLine = true)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { activate() }, enabled = !busy && activation.isNotBlank() && pairingCode.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                        Text(if (busy) "Conectando…" else "Ativar Garcia")
                    }
                    if (error.isNotBlank()) Text(error, color = Color(0xFFB94F7C), modifier = Modifier.padding(top = 12.dp))
                    Text("Não existe cadastro de usuário ou senha. O vínculo é feito uma única vez neste aparelho e associa a Garcia ao seu proprietário.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 18.dp))
                }
            } else if (continuousVoice) {
                Column(
                    Modifier.fillMaxSize().padding(padding).padding(horizontal = 28.dp, vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Box(
                        Modifier.size(176.dp).background(
                            when {
                                (whisperRecording || streamingListening) -> Color(0xFFE5F0E9)
                                busy || whisperBusy -> Color(0xFFE8EEF8)
                                else -> Color(0xFFF3E8EF)
                            }, CircleShape
                        ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            when {
                                (whisperRecording || streamingListening) -> Icons.Default.Mic
                                busy || whisperBusy -> Icons.Default.Mic
                                else -> Icons.Default.Mic
                            },
                            contentDescription = null,
                            tint = when {
                                (whisperRecording || streamingListening) -> Color(0xFF24845A)
                                busy || whisperBusy -> Blue
                                else -> Color(0xFFB94F7C)
                            },
                            modifier = Modifier.size(76.dp)
                        )
                    }
                    Spacer(Modifier.height(30.dp))
                    Text(
                        when {
                            (whisperRecording || streamingListening) -> "Estou ouvindo você"
                            whisperBusy -> "Estou entendendo o que você disse…"
                            voiceSpeaking -> "A Garcia está falando"
                            busy -> "A Garcia está pensando…"
                            autoListenPending -> "Preparando para ouvir…"
                            else -> "Conversa por voz ativa"
                        },
                        fontSize = 23.sp, fontWeight = FontWeight.Bold, color = Color(0xFF303030)
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        when {
                            streamingListening && streamingTranscript.isNotBlank() -> streamingTranscript
                            whisperRecording || streamingListening -> if (streamingSpeech.isAvailable) "A transcrição aparece enquanto você fala. Pode continuar naturalmente." else "Pode falar naturalmente. Vou detectar sua pausa, entender a mensagem e responder em voz alta."
                            whisperBusy -> "Sua fala está sendo transcrita no próprio aparelho."
                            voiceSpeaking -> "Estou respondendo em voz alta. Quando terminar, volto a ouvir você automaticamente."
                            busy -> "Já estou preparando minha resposta. Depois volto a ouvir você automaticamente."
                            autoListenPending -> "Vou reabrir o microfone assim que terminar minha resposta."
                            else -> "Fale comigo normalmente. Não é necessário tocar no microfone a cada mensagem."
                        },
                        color = Muted, fontSize = 15.sp, lineHeight = 22.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                    if (error.isNotBlank()) {
                        Spacer(Modifier.height(12.dp))
                        Text(error, color = Color(0xFFB94F7C), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                    Spacer(Modifier.height(36.dp))
                    OutlinedButton(
                        onClick = {
                            continuousVoice = false
                            context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", false).apply()
                            autoListenPending = false
                            voiceAutoSendPending = false
                            awaitingTranscriptReview = false
                            voiceOutput.stop()
                            if (whisperRecording) scope.launch(Dispatchers.IO) { whisperRecorder.cancel() }
                            streamingSpeech.stop(); streamingListening = false
                            whisperRecording = false
                            whisperStatus = "Conversa por voz encerrada"
                        },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(54.dp)
                    ) {
                        Icon(Icons.Default.Stop, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Encerrar conversa por voz")
                    }
                }
            } else if (history.isEmpty()) {
                Column(Modifier.fillMaxSize().padding(padding).padding(26.dp), verticalArrangement = Arrangement.Center) {
                    Text("Olá. Eu sou a Garcia.", fontSize = 29.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(12.dp))
                    Text("Sua assistente de inteligência. Posso ajudar a pensar, planejar, pesquisar, escrever e organizar projetos. Por onde começamos?", color = Muted, fontSize = 16.sp)
                }
            } else {
                LazyColumn(
                    state = chatListState,
                    modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 15.dp),
                    contentPadding = PaddingValues(vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    items(history) { item ->
                        val user = item.first == "user"
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (user) Arrangement.End else Arrangement.Start) {
                            Column(
                                Modifier.widthIn(max = 340.dp)
                                    .background(if (user) Color(0xFFF8E8EF) else Panel, RoundedCornerShape(18.dp))
                                    .padding(15.dp)
                            ) {
                                Text(if (user) "Você" else "Garcia", color = if (user) Color(0xFFB94F7C) else Blue, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(5.dp))
                                val (shownText, photoUrls) = remember(item.second) { splitPhotos(item.second) }
                                if (shownText.isNotBlank()) {
                                    androidx.compose.foundation.text.selection.SelectionContainer {
                                        Text(shownText, fontSize = 15.sp, lineHeight = 23.sp)
                                    }
                                }
                                photoUrls.forEach { photoUrl ->
                                    Spacer(Modifier.height(8.dp))
                                    coil.compose.AsyncImage(
                                        model = photoUrl,
                                        contentDescription = "Foto do Facebook",
                                        modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp).clip(RoundedCornerShape(12.dp)),
                                        contentScale = androidx.compose.ui.layout.ContentScale.Fit
                                    )
                                }
                                if (!user) {
                                    TextButton(
                                        onClick = {
                                            if (voiceSpeaking) {
                                                voiceOutput.stop()
                                                voiceSpeaking = false
                                                autoListenPending = false
                                                whisperStatus = "Reprodução de voz interrompida."
                                            } else if (voiceAvailable) {
                                                val started = voiceOutput.speak(shownText)
                                                if (started) voiceSpeaking = true
                                                else error = "Não foi possível iniciar a reprodução desta resposta."
                                            } else {
                                                error = "Configure uma voz em português nas configurações de texto para fala do Android."
                                            }
                                        },
                                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 2.dp)
                                    ) {
                                        Icon(
                                            if (voiceSpeaking) Icons.Default.Stop else Icons.Default.Mic,
                                            contentDescription = null,
                                            modifier = Modifier.size(14.dp)
                                        )
                                        Spacer(Modifier.width(5.dp))
                                        Text(if (voiceSpeaking) "Parar de ouvir" else "Ouvir resposta", fontSize = 12.sp)
                                    }
                                    TextButton(
                                        onClick = {
                                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                            clipboard.setPrimaryClip(ClipData.newPlainText("Resposta da Garcia", shownText))
                                            GarciaLog.recordEvent(context, "chat", "Resposta copiada · ${item.second.length} caracteres")
                                        },
                                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 2.dp)
                                    ) {
                                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(5.dp))
                                        Text("Copiar resposta", fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                    if (busy) item { Text("Garcia está pensando…", color = Muted, modifier = Modifier.padding(8.dp)) }
                    if (error.isNotBlank()) item { Text(error, color = Color(0xFFB94F7C), modifier = Modifier.padding(8.dp)) }
                }
            }
        }
      }
    }

    if (renameChatId != null) {
        AlertDialog(onDismissRequest = { renameChatId = null }, title = { Text("Editar nome da conversa") },
            text = { OutlinedTextField(value = renameTitle, onValueChange = { renameTitle = it }, singleLine = true, label = { Text("Nome") }) },
            confirmButton = { TextButton(onClick = { chats.firstOrNull { it.id == renameChatId }?.let { renameChat(it, renameTitle) }; renameChatId = null }) { Text("Salvar") } },
            dismissButton = { TextButton(onClick = { renameChatId = null }) { Text("Cancelar") } })
    }

    if (showAttachmentOptions) {
        ModalBottomSheet(
            onDismissRequest = { showAttachmentOptions = false },
            containerColor = Color(0xFFFFFBFD),
            dragHandle = { BottomSheetDefaults.DragHandle(color = Color(0xFFD8C8D0)) }
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 24.dp)) {
                Text("Adicionar à conversa", fontSize = 19.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(start = 8.dp, bottom = 10.dp))
                ListItem(
                    headlineContent = { Text("Câmera", fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("Tirar uma foto agora") },
                    leadingContent = { Icon(Icons.Default.CameraAlt, null, tint = Blue, modifier = Modifier.size(24.dp)) },
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable {
                        showAttachmentOptions = false
                        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                        if (granted) cameraPicker.launch(null) else cameraPermission.launch(Manifest.permission.CAMERA)
                    }
                )
                ListItem(
                    headlineContent = { Text("Fotos", fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("Escolher uma imagem da galeria") },
                    leadingContent = { Icon(Icons.Default.PhotoLibrary, null, tint = Blue, modifier = Modifier.size(24.dp)) },
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable {
                        showAttachmentOptions = false
                        photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }
                )
                ListItem(
                    headlineContent = { Text("Arquivos", fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("Anexar documentos de texto, CSV, JSON ou XML") },
                    leadingContent = { Icon(Icons.Default.InsertDriveFile, null, tint = Blue, modifier = Modifier.size(24.dp)) },
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable {
                        showAttachmentOptions = false
                        attachmentPicker.launch(arrayOf("text/*", "application/json", "application/xml"))
                    }
                )
                TextButton(onClick = { showAttachmentOptions = false }, modifier = Modifier.align(Alignment.End)) { Text("Cancelar") }
            }
        }
    }

    if (showChats) {
        AlertDialog(onDismissRequest = { showChats = false },
            title = { Text("Conversas salvas") },
            text = {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                    chats.asReversed().forEach { chat ->
                        TextButton(onClick = { selectChat(chat) }, modifier = Modifier.fillMaxWidth()) {
                            Text(chat.title, modifier = Modifier.fillMaxWidth(), color = Color(0xFF303030))
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showChats = false }) { Text("Fechar") } }
        )
    }

    if (confirmDelete) {
        AlertDialog(onDismissRequest = { confirmDelete = false },
            title = { Text("Excluir conversa?") },
            text = { Text("Esta conversa será removida deste aparelho. As outras conversas salvas serão mantidas.") },
            confirmButton = { TextButton(onClick = { deleteCurrentChat() }) { Text("Excluir") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancelar") } }
        )
    }

    if (showSettings) {
        val voiceOptions = voiceOutput.availableVoices()
        val sectionTitle = when (settingsSection) {
            "voice" -> "Voz e conversação"
            "voiceClone" -> "Clonar minha voz"
            "speech" -> "Transcrição de voz"
            "accounts" -> "Contas e integrações"
            "diagnostics" -> "Uso e diagnóstico"
            "privacy" -> "Privacidade e segurança"
            else -> "Configurações da Garcia"
        }
        AlertDialog(
            onDismissRequest = { showSettings = false; settingsSection = "menu" },
            title = { Text(sectionTitle) },
            text = {
                Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState())) {
                    if (settingsSection == "menu") {
                        Text("Escolha uma área para configurar.", color = Muted, fontSize = 13.sp)
                        Spacer(Modifier.height(8.dp))
                        listOf(
                            "voice" to ("Voz e conversação" to "Escolha uma voz, ouça amostras e configure a conversa por voz"),
                            "voiceClone" to ("Clonar minha voz" to "Importar ou gravar uma amostra e preparar um perfil de voz"),
                            "speech" to ("Transcrição de voz" to "Instalar, reparar ou remover o modelo Whisper"),
                            "accounts" to ("Contas e integrações" to "Facebook e serviços conectados"),
                            "diagnostics" to ("Uso e diagnóstico" to "Consumo, logs e estado da conexão"),
                            "privacy" to ("Privacidade e segurança" to "Como credenciais, histórico e navegação são tratados")
                        ).forEach { (key, item) ->
                            ListItem(
                                headlineContent = { Text(item.first, fontWeight = FontWeight.SemiBold) },
                                supportingContent = { Text(item.second, fontSize = 12.sp) },
                                modifier = Modifier.fillMaxWidth().clickable { settingsSection = key }
                            )
                        }
                        ListItem(
                            headlineContent = { Text("Internet e sites", fontWeight = FontWeight.SemiBold) },
                            supportingContent = { Text("Pesquisar, abrir páginas e entrar em sites", fontSize = 12.sp) },
                            leadingContent = { Icon(Icons.Default.Search, null, tint = Blue) },
                            modifier = Modifier.fillMaxWidth().clickable { showSettings = false; settingsSection = "menu"; showBrowser = true }
                        )
                    } else if (settingsSection == "voice") {
                        Text(voiceStatus, color = Muted, fontSize = 12.sp)
                        Spacer(Modifier.height(8.dp))
                        Text("Voz da Garcia", fontWeight = FontWeight.Bold)
                        if (voiceOptions.isEmpty()) {
                            Text("Nenhuma voz em português foi encontrada. Instale outras vozes nas configurações de texto para fala do Android.", color = Muted, fontSize = 12.sp)
                        } else {
                            voiceOptions.forEach { voice ->
                                val selected = voice.id == voiceOutput.selectedVoice()
                                Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(voice.name, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal, fontSize = 13.sp)
                                        Text("${voice.language} · ${if (voice.offline) "Offline" else "Requer internet"}", color = Muted, fontSize = 11.sp)
                                    }
                                    TextButton(onClick = {
                                        if (!voiceOutput.previewVoice(voice.id)) error = "Não foi possível reproduzir a amostra desta voz."
                                    }, enabled = voiceAvailable) { Text("Ouvir") }
                                    TextButton(onClick = {
                                        if (!voiceOutput.selectVoice(voice.id)) error = "Não foi possível selecionar esta voz."
                                    }, enabled = voiceAvailable && !selected) { Text(if (selected) "Atual" else "Usar") }
                                }
                                HorizontalDivider()
                            }
                        }
                        TextButton(onClick = { context.startActivity(android.content.Intent(android.speech.tts.TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)) }) { Text("Instalar mais vozes no Android") }
                        Spacer(Modifier.height(8.dp))
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("Permitir respostas faladas no modo de voz", modifier = Modifier.weight(1f), fontSize = 13.sp)
                            Switch(checked = voiceReplies, onCheckedChange = { enabled ->
                                voiceReplies = enabled
                                context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply()
                                if (!enabled) {
                                    voiceOutput.stop(); continuousVoice = false; autoListenPending = false
                                    if (whisperRecording) { whisperRecording = false; whisperRecorder.cancel() }
                                    streamingSpeech.stop(); streamingListening = false
                                    context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", false).apply()
                                }
                            }, enabled = voiceAvailable)
                        }
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("Conversação contínua por voz", modifier = Modifier.weight(1f), fontSize = 13.sp)
                            Switch(checked = continuousVoice, onCheckedChange = { enabled ->
                                continuousVoice = enabled
                                context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE).edit().putBoolean("continuous", enabled).apply()
                                autoListenPending = enabled
                                awaitingTranscriptReview = false
                                if (!enabled) {
                                    voiceOutput.stop()
                                    if (whisperRecording) { whisperRecording = false; whisperRecorder.cancel() }
                                    streamingSpeech.stop(); streamingListening = false
                                    whisperStatus = "Conversa por voz pausada"
                                } else if (!voiceReplies) error = "Ative também a leitura automática das respostas."
                                else if (whisperModelInfo == null && (!streamingSpeech.isAvailable || streamingUnavailable)) error = "Instale o modelo Whisper ou disponibilize o reconhecimento offline do Android."
                            }, enabled = voiceAvailable && voiceReplies && (whisperModelInfo != null || streamingSpeech.isAvailable) && !busy && !whisperRecording && !streamingListening)
                        }
                        Text(if (streamingSpeech.isAvailable) "No modo de conversa por voz, a Garcia responde falando. Fora desse modo, as respostas aparecem somente em texto. O reconhecimento de fala é offline e o áudio não é enviado ao servidor." else "No modo de conversa por voz, a Garcia responde falando. Fora desse modo, as respostas aparecem somente em texto. A fala é transcrita localmente pelo Whisper; o áudio bruto não é enviado ao servidor.", color = Muted, fontSize = 11.sp)
                    } else if (settingsSection == "voiceClone") {
                        VoiceCloningSection()
                    } else if (settingsSection == "speech") {
                        Text("Modelo de transcrição local", fontWeight = FontWeight.Bold)
                        Text(whisperStatus, color = Muted, fontSize = 12.sp)
                        Text("Modelo multilíngue tiny quantizado · 32 MB. O arquivo fica no aparelho e é verificado por SHA-256.", color = Muted, fontSize = 12.sp)
                        Button(onClick = {
                            if (!whisperBusy && !whisperRecording) scope.launch {
                                whisperBusy = true; whisperDownloadProgress = 0; whisperStatus = "Baixando modelo Whisper oficial…"
                                try {
                                    val info = withContext(Dispatchers.IO) {
                                        whisperModelStore.downloadModel { downloaded, total ->
                                            whisperDownloadProgress = if (total > 0L) ((downloaded * 100) / total).toInt().coerceIn(0, 100) else 0
                                        }.also { check(WhisperNative.nativeLoadModel(it.file.absolutePath)) { "O Whisper baixou o modelo, mas não conseguiu carregá-lo." } }
                                    }
                                    whisperModelInfo = info
                                    whisperStatus = "Whisper pronto · modelo verificado · SHA-256 ${info.sha256.take(12)}…"
                                    GarciaLog.recordEvent(context, "Voz", "Modelo Whisper baixado, verificado e carregado · ${info.sizeBytes} bytes")
                                } catch (e: Exception) {
                                    whisperStatus = e.message ?: "Falha ao baixar o modelo Whisper"
                                    GarciaLog.record(context, "Whisper download", e)
                                } finally { whisperBusy = false }
                            }
                        }, enabled = !whisperBusy && !whisperRecording, modifier = Modifier.fillMaxWidth()) {
                            Text(if (whisperBusy) "Baixando modelo… ${whisperDownloadProgress}%" else if (whisperModelInfo == null) "Baixar e instalar Whisper (32 MB)" else "Baixar novamente / reparar Whisper")
                        }
                        OutlinedButton(onClick = { whisperModelPicker.launch(arrayOf("application/octet-stream", "application/x-ggml", "application/*", "*/*")) }, enabled = !whisperBusy && !whisperRecording, modifier = Modifier.fillMaxWidth()) { Text("Importar modelo manualmente (opcional)") }
                        if (whisperModelInfo != null) {
                            Text("Modelo: ${whisperModelInfo!!.file.name} · ${whisperModelInfo!!.sizeBytes / (1024 * 1024)} MB", color = Muted, fontSize = 11.sp)
                            TextButton(onClick = {
                                scope.launch(Dispatchers.IO) { runCatching { WhisperNative.nativeRelease(); whisperModelStore.forgetModel() } }
                                whisperModelInfo = null; whisperStatus = "Modelo removido"
                            }, enabled = !whisperBusy && !whisperRecording) { Text("Remover modelo") }
                        }
                    } else if (settingsSection == "accounts") {
                        Text("Dispositivo ativado e token protegido pelo Android Keystore.", color = Muted, fontSize = 12.sp)
                        if (connected) {
                            Text("Conta Facebook", fontWeight = FontWeight.Bold)
                            Text(if (facebookLinked) "Facebook vinculado a esta conta proprietária." else "Não vinculado. O Facebook não substitui os códigos privados de ativação.", color = Muted, fontSize = 13.sp)
                            Button(onClick = { connectFacebook() }, enabled = !facebookBusy, modifier = Modifier.fillMaxWidth()) {
                                Text(when { facebookBusy -> "Conectando Facebook…"; facebookLinked -> "Reconectar / atualizar permissões"; else -> "Vincular Facebook" })
                            }
                            if (facebookLinked) {
                                Text("A Garcia consulta dados conforme as permissões pessoais concedidas pela Meta.", color = Muted, fontSize = 12.sp)
                                OutlinedButton(onClick = { showFacebookManager = true }, modifier = Modifier.fillMaxWidth()) { Text("Abrir dados do Facebook") }
                            }
                            if (facebookError.isNotBlank()) Text(facebookError, color = Color(0xFFB94F7C), fontSize = 12.sp)
                        } else Text("Ative o dispositivo para liberar integrações.", color = Muted)
                    } else if (settingsSection == "diagnostics") {
                        Text(status, color = Muted)
                        Button(onClick = { loadUsage() }, enabled = connected && !loadingUsage, modifier = Modifier.fillMaxWidth()) { Text(if (loadingUsage) "Consultando…" else "Consultar uso") }
                        if (loadingUsage) CircularProgressIndicator()
                        if (usage.isNotBlank()) { Text("Uso diário", fontWeight = FontWeight.Bold); Text(usage, color = Muted, fontSize = 13.sp) }
                        if (usageError.isNotBlank()) Text(usageError, color = Color(0xFFB94F7C), fontSize = 13.sp)
                        OutlinedButton(onClick = { logs = GarciaLog.read(context); showSettings = false; showLogs = true }, modifier = Modifier.fillMaxWidth()) { Text("Ver logs de diagnóstico") }
                    } else if (settingsSection == "privacy") {
                        Text("Histórico e credenciais locais são protegidos pelo Android Keystore. A navegação em sites acontece em uma janela interna; quando um site exigir login, digite seus dados diretamente no próprio site.", color = Muted, fontSize = 13.sp)
                        Spacer(Modifier.height(8.dp))
                        Text("A Garcia não lê nem copia os campos de senha. Ao compartilhar uma página, somente o texto visível será enviado à conversa. Não compartilhe códigos de autenticação ou senhas no chat quando puder autenticar diretamente no site.", color = Muted, fontSize = 13.sp)
                    }
                    if (error.isNotBlank()) Text(error, color = Color(0xFFB94F7C), fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                }
            },
            confirmButton = {
                if (settingsSection == "menu") TextButton(onClick = { showSettings = false }) { Text("Fechar") }
                else TextButton(onClick = { settingsSection = "menu"; error = "" }) { Text("Voltar") }
            },
            dismissButton = { if (settingsSection != "menu") TextButton(onClick = { showSettings = false; settingsSection = "menu" }) { Text("Fechar") } }
        )
    }

    if (showBrowser) {
        GarciaBrowserDialog(
            initialRequest = browserStartRequest,
            initialTask = browserStartTask,
            onDismiss = { showBrowser = false; browserStartRequest = null; browserStartTask = null },
            onSharePage = { pageContext ->
                input = pageContext
                attachment = null
                error = ""
                browserAutoSendPending = true
                showBrowser = false
            }
        )
    }

    if (showFacebookErrorDialog && facebookError.isNotBlank()) {
        AlertDialog(
            onDismissRequest = { showFacebookErrorDialog = false },
            title = { Text("Não foi possível conectar ao Facebook") },
            text = { Text(facebookError) },
            confirmButton = {
                TextButton(onClick = { showFacebookErrorDialog = false }) { Text("Entendi") }
            }
        )
    }

    if (showFacebookManager) {
        FacebookManagerDialog(client = client, onDismiss = { showFacebookManager = false })
    }

    if (showLogs) {
        AlertDialog(onDismissRequest = { showLogs = false },
            title = { Text("Logs de diagnóstico") },
            text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Text(logs, fontSize = 12.sp, lineHeight = 17.sp)
            } },
            confirmButton = { TextButton(onClick = {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Logs Garcia", logs))
            }) { Text("Copiar") } },
            dismissButton = { Row {
                TextButton(onClick = { GarciaLog.clear(context); logs = GarciaLog.read(context) }) { Text("Limpar") }
                TextButton(onClick = { showLogs = false }) { Text("Fechar") }
            } }
        )
    }
}
