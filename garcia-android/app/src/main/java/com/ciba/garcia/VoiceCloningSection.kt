package com.ciba.garcia

import android.Manifest
import android.content.Context
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID

@Suppress("DEPRECATION")
private fun createVoiceRecorder(context: Context): MediaRecorder =
    if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()

private const val VOICE_SAMPLE_TEXT = """Olá! Meu nome é [diga seu nome]. Esta é uma gravação da minha voz para criar um perfil pessoal na Garcia. Hoje o dia está tranquilo e estou falando em meu ritmo natural. Gosto de conversar com clareza, mas também sei mudar a entonação quando conto uma história, faço uma pergunta ou demonstro entusiasmo. Agora vou falar um pouco mais devagar. Depois, vou falar normalmente, como faço no dia a dia. A Garcia deverá usar esta amostra somente com a minha autorização."""

private class VoiceReferenceStore(private val context: Context) {
    private val directory = File(context.filesDir, "voice-references").apply { mkdirs() }
    private val prefs = context.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)

    fun currentFile(): File? = prefs.getString("active_sample", null)?.let(::File)?.takeIf { it.isFile }
    fun currentName(): String = prefs.getString("active_name", "").orEmpty()

    fun import(uri: Uri): File {
        val displayName = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }.orEmpty()
        val extension = displayName.substringAfterLast(".", "m4a").lowercase().filter { it.isLetterOrDigit() }.take(8).ifBlank { "m4a" }
        val target = File(directory, "reference-${UUID.randomUUID()}.$extension")
        context.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(target).use { output -> input.copyTo(output) }
        } ?: error("Não foi possível abrir o áudio selecionado.")
        validate(target)
        return target
    }

    fun saveRecording(source: File): File {
        validate(source)
        val target = File(directory, "reference-${UUID.randomUUID()}.m4a")
        source.copyTo(target, overwrite = true)
        validate(target)
        return target
    }

    fun saveProfile(file: File, name: String) {
        require(name.isNotBlank()) { "Digite um nome para o perfil." }
        prefs.edit().putString("active_sample", file.absolutePath)
            .putString("active_name", name.trim()).apply()
    }

    private fun validate(file: File) {
        require(file.isFile && file.length() > 1024) { "O arquivo de áudio está vazio ou inválido." }
        require(file.length() <= 50L * 1024 * 1024) { "O áudio deve ter no máximo 50 MB." }
        val metadata = MediaMetadataRetriever()
        try {
            metadata.setDataSource(file.absolutePath)
            require(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes") {
                "O arquivo selecionado não contém uma faixa de áudio."
            }
            val duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            require(duration in 5_000L..120_000L) {
                "Use uma gravação entre 5 segundos e 2 minutos. O ideal para a clonagem é 10 a 15 segundos de fala limpa."
            }
        } finally {
            metadata.release()
        }
    }
}

@Composable
internal fun VoiceCloningSection() {
    val context = LocalContext.current
    val store = remember { VoiceReferenceStore(context) }
    var selectedFile by remember { mutableStateOf(store.currentFile()) }
    var profileName by remember { mutableStateOf(store.currentName()) }
    var status by remember { mutableStateOf(if (selectedFile != null) "Amostra salva neste aparelho." else "Nenhuma amostra de voz selecionada.") }
    var recording by remember { mutableStateOf(false) }
    var elapsed by remember { mutableIntStateOf(0) }
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var tempFile by remember { mutableStateOf<File?>(null) }
    var playing by remember { mutableStateOf(false) }
    var consentGiven by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            runCatching { store.import(uri) }
                .onSuccess { selectedFile = it; profileName = profileName.ifBlank { "Minha voz" }; status = "Áudio importado e validado. Salve o perfil para mantê-lo." }
                .onFailure { status = it.message ?: "Não foi possível importar o áudio." }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            runCatching {
                val file = File(context.cacheDir, "voice-capture-${UUID.randomUUID()}.m4a")
                val active = createVoiceRecorder(context)
                active.setAudioSource(MediaRecorder.AudioSource.MIC)
                active.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                active.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                active.setAudioEncodingBitRate(128_000)
                active.setAudioSamplingRate(24_000)
                active.setMaxDuration(30_000)
                active.setOutputFile(file.absolutePath)
                active.prepare()
                active.start()
                recorder = active
                tempFile = file
                recording = true
                elapsed = 0
                status = "Gravando. Leia o texto com voz natural e sem pressa."
            }.onFailure { status = it.message ?: "Não foi possível iniciar a gravação." }
        } else status = "Permissão de microfone negada. Você ainda pode importar um áudio."
    }

    fun stopRecording() {
        val active = recorder
        val file = tempFile
        recorder = null
        recording = false
        runCatching { active?.stop() }.onFailure { status = "A gravação ficou muito curta ou não pôde ser finalizada." }
        active?.release()
        if (file != null && file.exists()) {
            runCatching { store.saveRecording(file) }
                .onSuccess { selectedFile = it; profileName = profileName.ifBlank { "Minha voz" }; status = "Gravação concluída e validada. Salve o perfil." }
                .onFailure { status = it.message ?: "Não foi possível validar a gravação." }
            file.delete()
        }
    }

    LaunchedEffect(recording) {
        while (recording) {
            delay(1_000)
            elapsed++
            if (elapsed >= 30) stopRecording()
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            runCatching { recorder?.stop() }
            recorder?.release()
            player?.release()
        }
    }

    Column(Modifier.fillMaxWidth().heightIn(max = 540.dp).verticalScroll(rememberScrollState())) {
        Text("Crie um perfil com sua própria voz", style = MaterialTheme.typography.titleSmall)
        Text("Importe uma gravação ou grave diretamente pelo microfone. A amostra fica armazenada na área privada da Garcia.", fontSize = 12.sp)
        Spacer(Modifier.height(10.dp))
        OutlinedButton(onClick = { picker.launch(arrayOf("audio/*")) }, enabled = !recording, modifier = Modifier.fillMaxWidth()) {
            Text("Selecionar arquivo de áudio")
        }
        Button(onClick = {
            if (recording) stopRecording()
            else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                permission.launch(Manifest.permission.RECORD_AUDIO)
            } else permission.launch(Manifest.permission.RECORD_AUDIO)
        }, modifier = Modifier.fillMaxWidth()) {
            Text(if (recording) "Parar gravação · ${elapsed}s / 30s" else "Gravar minha voz")
        }
        Spacer(Modifier.height(8.dp))
        Text("Texto sugerido para leitura", style = MaterialTheme.typography.titleSmall)
        Text("Troque \"[diga seu nome]\" pelo seu nome antes de começar.", fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
        Text(VOICE_SAMPLE_TEXT, fontSize = 13.sp)
        TextButton(onClick = {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Texto para clonagem de voz", VOICE_SAMPLE_TEXT))
            status = "Texto copiado."
        }) { Text("Copiar texto") }
        Spacer(Modifier.height(8.dp))
        selectedFile?.let { file ->
            Text("Amostra: ${file.name} · ${(file.length() / 1024)} KB", fontSize = 12.sp)
            OutlinedTextField(value = profileName, onValueChange = { profileName = it }, label = { Text("Nome do perfil") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    runCatching {
                        player?.release()
                        player = MediaPlayer().apply { setDataSource(file.absolutePath); setOnCompletionListener { playing = false; it.release(); player = null }; prepare(); start() }
                        playing = true
                    }.onFailure { status = it.message ?: "Não foi possível reproduzir a amostra." }
                }, enabled = !recording && !playing, modifier = Modifier.weight(1f)) { Text("Ouvir amostra") }
                Button(onClick = {
                    runCatching { store.saveProfile(file, profileName); status = "Perfil '${profileName.trim()}' salvo localmente." }
                        .onFailure { status = it.message ?: "Não foi possível salvar o perfil." }
                }, enabled = profileName.isNotBlank() && consentGiven && !recording, modifier = Modifier.weight(1f)) { Text("Salvar perfil") }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Checkbox(checked = consentGiven, onCheckedChange = { consentGiven = it })
                Text("Confirmo que esta é minha voz ou que tenho autorização explícita da pessoa gravada.", fontSize = 11.sp)
            }
        }
        Text(status, fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
        Spacer(Modifier.height(6.dp))
        Text("Atenção: esta etapa prepara e salva a amostra. A clonagem neural Chatterbox e a geração de áudio com o perfil ainda dependem da integração do mecanismo nativo; não será exibida como concluída antes de funcionar.", fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
    }
}
