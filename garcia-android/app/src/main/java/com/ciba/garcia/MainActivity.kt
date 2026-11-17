package com.ciba.garcia

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.result.PickVisualMediaRequest
import android.os.Bundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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

class MainActivity : ComponentActivity() {
    private val facebookCallbackManager: CallbackManager = CallbackManager.Factory.create()

    fun startFacebookLogin(onResult: (Result<String>) -> Unit) {
        LoginManager.getInstance().registerCallback(facebookCallbackManager, object : FacebookCallback<LoginResult> {
            override fun onSuccess(result: LoginResult) {
                onResult(Result.success(result.accessToken.token))
            }
            override fun onCancel() {
                onResult(Result.failure(IllegalStateException("Login com Facebook cancelado.")))
            }
            override fun onError(error: FacebookException) {
                onResult(Result.failure(error))
            }
        })
        LoginManager.getInstance().logInWithReadPermissions(
            this,
            listOf("public_profile", "pages_show_list", "pages_read_engagement", "pages_messaging")
        )
    }

    @Deprecated("Facebook SDK callback bridge")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        facebookCallbackManager.onActivityResult(requestCode, resultCode, data)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
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
    var activation by remember { mutableStateOf("") }
    var pairingCode by remember { mutableStateOf("") }
    var showSettings by remember { mutableStateOf(false) }
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
                status = "Conectada ao Ciba AI"
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
        if (message.length > 1_500) { error = "A mensagem com o anexo ultrapassa o limite de 1.500 caracteres. Reduza a pergunta ou o conteúdo do arquivo."; return }
        val imagePayload = JSONArray()
        if (selectedAttachment?.type == "image") {
            imagePayload.put(JSONObject()
                .put("mime_type", selectedAttachment.mimeType)
                .put("data", selectedAttachment.base64))
        }
        history.add("user" to message); input = ""; attachment = null; persist(); busy = true; error = ""
        scope.launch {
            try {
                val snapshot = JSONArray()
                history.forEach { (role, content) -> snapshot.put(JSONObject().put("role", role).put("content", content)) }
                val answer = withContext(Dispatchers.IO) { client.chat(snapshot, imagePayload) }
                history.add("assistant" to answer); persist()
                GarciaLog.recordEvent(context, "chat", "HTTP 200 · resposta recebida e salva no histórico · ${answer.length} caracteres")
            } catch (e: Exception) { GarciaLog.record(context, "chat", e); error = e.message ?: "Falha ao conversar com a Garcia." }
            finally { busy = false }
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
                GarciaLog.recordEvent(context, "Facebook", "Login concluído; enviando solicitação de vínculo ao Ciba AI.")
                scope.launch {
                    try {
                        val result = withContext(Dispatchers.IO) { client.linkFacebook(accessToken) }
                        facebookLinked = result.optBoolean("linked", false)
                        GarciaLog.recordEvent(context, "Facebook", if (facebookLinked) "Vínculo confirmado pelo servidor." else "Servidor respondeu sem confirmar o vínculo.")
                        if (!facebookLinked) {
                            facebookError = "O servidor não confirmou o vínculo."
                        } else {
                            facebookStatusLoaded = false
                            showSettings = false
                            showFacebookManager = true
                        }
                    } catch (e: Exception) {
                        GarciaLog.record(context, "Facebook", e)
                        facebookError = e.message ?: "Não foi possível vincular o Facebook."
                    } finally {
                        facebookBusy = false
                    }
                }
            }.onFailure { e ->
                GarciaLog.record(context, "Facebook login", e)
                facebookError = e.message ?: "Falha no login com Facebook."
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
                usage = if (buckets.length() == 0) "Ainda não há solicitações contabilizadas hoje.\\nData (UTC): $day" else lines.joinToString("\\n")
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
            status = if (result.optString("status") == "ready") "Ciba AI conectado" else "Serviço indisponível"
        } catch (e: Exception) { GarciaLog.record(context, "conexão", e); status = "Sem conexão com o Ciba AI" }
    }

    LaunchedEffect(showSettings, connected) {
        if (showSettings && connected && !facebookStatusLoaded) {
            try {
                val result = withContext(Dispatchers.IO) { client.facebookStatus() }
                facebookLinked = result.optBoolean("linked", false)
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
        gesturesEnabled = connected && !busy,
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
              TextButton(onClick = { showSettings = true; scope.launch { drawerState.close() } }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.Settings, null); Spacer(Modifier.width(8.dp)); Text("Configurações") }
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
                navigationIcon = { if (connected) IconButton(onClick = { scope.launch { drawerState.open() } }) { Icon(Icons.Default.Menu, "Abrir menu") } },
                actions = { if (connected) IconButton(onClick = { newChat() }, enabled = !busy) { Icon(Icons.Default.Edit, "Nova conversa") } },
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
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { showAttachmentOptions = true }, enabled = !busy) {
                        Icon(Icons.Default.AttachFile, contentDescription = "Adicionar foto ou arquivo", tint = Blue)
                    }
                    BasicTextField(value = input, onValueChange = { input = it },
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
                                androidx.compose.foundation.text.selection.SelectionContainer {
                                    Text(item.second, fontSize = 15.sp, lineHeight = 23.sp)
                                }
                                if (!user) {
                                    TextButton(
                                        onClick = {
                                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                            clipboard.setPrimaryClip(ClipData.newPlainText("Resposta da Garcia", item.second))
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
        AlertDialog(
            onDismissRequest = { showAttachmentOptions = false },
            title = { Text("Adicionar anexo") },
            text = {
                Column {
                    TextButton(
                        onClick = {
                            showAttachmentOptions = false
                            photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Fotos", modifier = Modifier.fillMaxWidth()) }
                    TextButton(
                        onClick = {
                            showAttachmentOptions = false
                            attachmentPicker.launch(arrayOf("text/*", "application/json", "application/xml"))
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Arquivos", modifier = Modifier.fillMaxWidth()) }
                }
            },
            confirmButton = { TextButton(onClick = { showAttachmentOptions = false }) { Text("Cancelar") } }
        )
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
        AlertDialog(onDismissRequest = { showSettings = false },
            title = { Text("Garcia · Configurações") },
            text = {
                Column {
                    Text(status, color = Muted)
                    Spacer(Modifier.height(8.dp))
                    Text(if (connected) "Dispositivo ativado e token protegido pelo Android Keystore." else "Dispositivo ainda não ativado.")
                    if (connected) {
                        Spacer(Modifier.height(12.dp))
                        Text("Conta Facebook", fontWeight = FontWeight.Bold)
                        Text(
                            if (facebookLinked) "Facebook vinculado a esta conta proprietária."
                            else "Não vinculado. O Facebook não substitui os códigos privados de ativação.",
                            color = Muted, fontSize = 13.sp
                        )
                        Spacer(Modifier.height(6.dp))
                        Button(
                            onClick = { connectFacebook() },
                            enabled = !facebookBusy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(when {
                                facebookBusy -> "Conectando Facebook…"
                                facebookLinked -> "Reconectar / atualizar permissões"
                                else -> "Vincular Facebook"
                            })
                        }
                        if (facebookLinked) {
                            OutlinedButton(
                                onClick = { showFacebookManager = true },
                                modifier = Modifier.fillMaxWidth()
                            ) { Text("Abrir dados do Facebook") }
                        }
                        if (facebookError.isNotBlank()) {
                            Text(facebookError, color = Color(0xFFB94F7C), fontSize = 12.sp)
                        }
                    }
                    if (loadingUsage) { Spacer(Modifier.height(10.dp)); CircularProgressIndicator() }
                    if (usage.isNotBlank()) {
                        Spacer(Modifier.height(10.dp))
                        Text("Uso diário", fontWeight = FontWeight.Bold)
                        Text(usage, color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
                    }
                    if (usageError.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(usageError, color = Color(0xFFB94F7C), fontSize = 13.sp)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { loadUsage() }, enabled = connected && !loadingUsage) {
                Text(if (loadingUsage) "Consultando…" else "Consultar uso")
            } },
            dismissButton = { Row {
                TextButton(onClick = { logs = GarciaLog.read(context); showSettings = false; showLogs = true }) { Text("Ver logs") }
                TextButton(onClick = { showSettings = false }) { Text("Fechar") }
            } }
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
