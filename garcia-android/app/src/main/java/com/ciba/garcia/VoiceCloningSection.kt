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
import androidx.compose.ui.Alignment
import kotlinx.coroutines.launch
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

private const val VOICE_SAMPLE_TEXT = """Olá, meu nome é [seu nome]. Esta é minha voz, falando de forma natural. Hoje o dia está agradável. Gosto de conversar com clareza. Como você está? Que ótima notícia! Agora vou falar um pouco mais devagar e depois no meu ritmo habitual."""

@Composable
internal fun VoiceCloningSection() {
    val context = LocalContext.current
    val store = remember { VoiceProfileStore(context) }
    var profiles by remember { mutableStateOf(store.profiles()) }
    val scope = rememberCoroutineScope()
    var modelsReady by remember { mutableStateOf(ChatterboxModelManager.installed(context) != null) }
    var busy by remember { mutableStateOf(false) }
    var activeWav by remember { mutableStateOf(store.currentWav()) }
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
                active.setAudioChannels(1)
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
        val stopped = runCatching { active?.stop(); true }.getOrElse { false }
        active?.release()
        if (file != null && file.exists()) {
            if (stopped) {
                runCatching { store.saveRecording(file) }
                    .onSuccess { selectedFile = it; profileName = profileName.ifBlank { "Minha voz" }; status = "Gravação concluída e validada. Salve o perfil." }
                    .onFailure { status = it.message ?: "Não foi possível validar a gravação." }
            } else status = "A gravação ficou muito curta ou não pôde ser finalizada. Tente novamente."
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
        Spacer(Modifier.height(10.dp))
        Text(if (modelsReady) "Modelos Chatterbox instalados neste aparelho." else "Para clonar a voz, a Garcia precisa baixar aproximadamente 640 MB de modelos. O download é feito uma vez e fica no armazenamento privado.", fontSize = 12.sp)
        if (!modelsReady) {
            OutlinedButton(
                onClick = {
                    scope.launch {
                        busy = true
                        status = "Baixando os modelos Chatterbox. Mantenha a Garcia aberta..."
                        try {
                            ChatterboxModelManager.download(context) { message -> status = message }
                            modelsReady = true
                            status = "Modelos instalados. Agora salve e prepare sua amostra."
                        } catch (error: Throwable) {
                            status = error.message ?: "Falha ao baixar os modelos."
                        } finally { busy = false }
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth()
            ) { Text(if (busy) "Aguarde..." else "Baixar modelos de voz") }
        }
        if (activeWav != null && modelsReady) {
            OutlinedButton(
                onClick = {
                    val wav = activeWav
                    if (wav != null) {
                        busy = true
                        status = "Preparando o perfil de voz..."
                        ClonedVoiceRuntime.activate(context, profile.wav) { result ->
                            scope.launch {
                                busy = false
                                status = result.fold(
                                    { "Voz clonada e pronta para uso nas conversas por voz." },
                                    { "Falha ao preparar a voz: ${it.message}" }
                                )
                            }
                        }
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Preparar perfil salvo") }
        }
        if (profiles.isNotEmpty()) {
            Text("Perfis de voz salvos", style = MaterialTheme.typography.titleSmall)
            profiles.forEach { profile ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(
                        onClick = {
                            store.select(profile)
                            selectedFile = profile.sample
                            profileName = profile.name
                            activeWav = profile.wav
                            status = "Perfil '${profile.name}' selecionado."
                            if (modelsReady) {
                                busy = true
                                ClonedVoiceRuntime.activate(context, profile.wav) { result ->
                                    scope.launch {
                                        busy = false
                                        status = result.fold(
                                            { "Voz '${profile.name}' pronta para a conversa." },
                                            { "Falha ao carregar o perfil: ${it.message}" }
                                        )
                                    }
                                }
                            }
                        },
                        enabled = !busy,
                        modifier = Modifier.weight(1f)
                    ) { Text(if (store.activeProfileId() == profile.id) "✓ " + profile.name else profile.name) }
                    OutlinedButton(onClick = {
                        store.delete(profile.id)
                        profiles = store.profiles()
                        if (store.activeProfileId() == null) {
                            selectedFile = null
                            activeWav = null
                            profileName = ""
                            ClonedVoiceRuntime.release()
                            status = "Perfil excluído."
                        }
                    }, enabled = !busy) { Text("Excluir") }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
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
        Text("Troque \"[seu nome]\" pelo seu nome antes de começar.", fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
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
            store.activeProfileId()?.let { activeId ->
                TextButton(onClick = {
                    runCatching {
                        store.rename(activeId, profileName)
                        profiles = store.profiles()
                        status = "Perfil renomeado."
                    }.onFailure { status = it.message ?: "Não foi possível renomear o perfil." }
                }, enabled = profileName.isNotBlank() && !busy) { Text("Renomear perfil") }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    runCatching {
                        player?.release()
                        player = MediaPlayer().apply { setDataSource(file.absolutePath); setOnCompletionListener { playing = false; it.release(); player = null }; prepare(); start() }
                        playing = true
                    }.onFailure { status = it.message ?: "Não foi possível reproduzir a amostra." }
                }, enabled = !recording && !playing, modifier = Modifier.weight(1f)) { Text("Ouvir amostra") }
                Button(onClick = {
                    scope.launch {
                        busy = true
                        status = "Convertendo a amostra para WAV mono..."
                        try {
                            val profile = withContext(Dispatchers.IO) {
                                val target = File(context.filesDir, "voice-references/profile-${UUID.randomUUID()}.wav")
                                VoiceAudioNormalizer.toMonoWav(file, target)
                                store.save(file, profileName, target)
                            }
                            selectedFile = profile.sample
                            profileName = profile.name
                            profiles = store.profiles()
                            activeWav = profile.wav
                            status = "Perfil salvo. A amostra está pronta para o Chatterbox."
                            if (modelsReady) {
                                status = "Preparando sua voz. Na primeira vez, a análise pode demorar."
                                ClonedVoiceRuntime.activate(context, wav) { result ->
                                    scope.launch {
                                        busy = false
                                        status = result.fold(
                                            { "Voz clonada e pronta. A Garcia já pode falar com este perfil." },
                                            { "Não foi possível preparar a voz: ${it.message}" }
                                        )
                                    }
                                }
                            } else busy = false
                        } catch (error: Throwable) {
                            busy = false
                            status = error.message ?: "Falha ao preparar o áudio."
                        }
                    }
                }, enabled = profileName.isNotBlank() && consentGiven && !recording && !busy, modifier = Modifier.weight(1f)) { Text("Salvar e preparar voz") }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = consentGiven, onCheckedChange = { consentGiven = it })
                Text("Confirmo que esta é minha voz ou que tenho autorização explícita da pessoa gravada.", fontSize = 11.sp)
            }
        }
        Text(status, fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
        Spacer(Modifier.height(6.dp))
        Text("A gravação e o processamento acontecem localmente. Os modelos são baixados uma única vez; depois, a Garcia reutiliza o perfil salvo.", fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
    }
}
