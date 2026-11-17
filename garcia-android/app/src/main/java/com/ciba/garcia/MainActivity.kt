package com.ciba.garcia

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
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
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Mic
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

private val Ink = Color(0xFFFFFFFF)
private val Panel = Color(0xFFFFF8FB)
private val Blue = Color(0xFFD96E98)
private val Muted = Color(0xFF777777)

class MainActivity : ComponentActivity() {
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
    val history = remember { mutableStateListOf<Pair<String, String>>().apply {
        val saved = store.loadHistory()
        for (i in 0 until saved.length()) runCatching {
            val item = saved.getJSONObject(i)
            add(item.getString("role") to item.getString("content"))
        }
    } }
    var input by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("Verificando conexão…") }
    var error by remember { mutableStateOf("") }
    var activation by remember { mutableStateOf("") }
    var pairingCode by remember { mutableStateOf("") }
    var showSettings by remember { mutableStateOf(false) }
    var showLogs by remember { mutableStateOf(false) }
    var logs by remember { mutableStateOf("") }
    var usage by remember { mutableStateOf("") }
    var connected by remember { mutableStateOf(store.get("device_token") != null) }

    fun persist() {
        val array = JSONArray()
        history.forEach { (role, content) -> array.put(JSONObject().put("role", role).put("content", content)) }
        store.saveHistory(array)
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
        if (text.isEmpty() || busy || !connected) return
        history.add("user" to text); input = ""; persist(); busy = true; error = ""
        scope.launch {
            try {
                val snapshot = JSONArray()
                history.forEach { (role, content) -> snapshot.put(JSONObject().put("role", role).put("content", content)) }
                val answer = withContext(Dispatchers.IO) { client.chat(snapshot) }
                history.add("assistant" to answer); persist()
                GarciaLog.recordEvent(context, "chat", "HTTP 200 · resposta recebida e salva no histórico · ${answer.length} caracteres")
            } catch (e: Exception) { GarciaLog.record(context, "chat", e); error = e.message ?: "Falha ao conversar com a Garcia." }
            finally { busy = false }
        }
    }

    LaunchedEffect(Unit) {
        try {
            val result = withContext(Dispatchers.IO) { client.status() }
            status = if (result.optString("status") == "ready") "Ciba AI conectado" else "Serviço indisponível"
        } catch (e: Exception) { GarciaLog.record(context, "conexão", e); status = "Sem conexão com o Ciba AI" }
    }

    MaterialTheme(colorScheme = lightColorScheme(
        primary = Blue, background = Ink, surface = Color.White, onBackground = Color(0xFF303030),
        onSurface = Color(0xFF303030), secondary = Muted
    )) {
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
                actions = { IconButton(onClick = { showSettings = true }) { Icon(Icons.Default.Settings, "Configurações") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink)
            )
        }, bottomBar = {
            if (connected) {
                Row(Modifier.fillMaxWidth().background(Panel).imePadding().navigationBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(value = input, onValueChange = { input = it },
                        modifier = Modifier.weight(1f).background(Color(0xFFF6EDF2), RoundedCornerShape(22.dp)).padding(horizontal = 17.dp, vertical = 14.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(color = Color(0xFF303030), fontSize = 15.sp),
                        decorationBox = { inner -> Box { if (input.isBlank()) Text("Converse com a Garcia…", color = Muted); inner() } })
                    Spacer(Modifier.width(7.dp))
                    IconButton(onClick = { send() }, enabled = !busy && input.isNotBlank(),
                        modifier = Modifier.size(48.dp).background(Blue, CircleShape)) {
                        Icon(Icons.Default.ArrowUpward, "Enviar", tint = Color.White)
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
                    OutlinedTextField(activation, { activation = it }, Modifier.fillMaxWidth(),
                        label = { Text("Código privado de registro") }, singleLine = true)
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(pairingCode, { pairingCode = it }, Modifier.fillMaxWidth(),
                        label = { Text("Código de vínculo do proprietário") }, singleLine = true)
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
                LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 15.dp), contentPadding = PaddingValues(vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(history) { item ->
                        val user = item.first == "user"
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (user) Arrangement.End else Arrangement.Start) {
                            Column(Modifier.widthIn(max = 330.dp).background(if (user) Color(0xFFF8E8EF) else Panel, RoundedCornerShape(18.dp)).padding(15.dp)) {
                                Text(if (user) "Você" else "Garcia", color = if (user) Color(0xFFB94F7C) else Blue, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(5.dp))
                                Text(item.second, fontSize = 15.sp, lineHeight = 22.sp)
                            }
                        }
                    }
                    if (busy) item { Text("Garcia está pensando…", color = Muted, modifier = Modifier.padding(8.dp)) }
                    if (error.isNotBlank()) item { Text(error, color = Color(0xFFB94F7C), modifier = Modifier.padding(8.dp)) }
                }
            }
        }
    }

    if (showSettings) {
        AlertDialog(onDismissRequest = { showSettings = false },
            title = { Text("Garcia · Configurações") },
            text = {
                Column {
                    Text(status, color = Muted)
                    Spacer(Modifier.height(8.dp))
                    Text(if (connected) "Dispositivo ativado e token protegido pelo Android Keystore." else "Dispositivo ainda não ativado.")
                    if (usage.isNotBlank()) Text(usage, color = Muted)
                }
            },
            confirmButton = { TextButton(onClick = {
                showSettings = false
                if (connected) scope.launch {
                    usage = runCatching { withContext(Dispatchers.IO) { client.usage().toString(2) } }.getOrElse { it.message ?: "Indisponível" }
                }
            }) { Text("Consultar uso") } },
            dismissButton = { Row {
                TextButton(onClick = { logs = GarciaLog.read(context); showSettings = false; showLogs = true }) { Text("Ver logs") }
                TextButton(onClick = { showSettings = false }) { Text("Fechar") }
            } }
        )
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

