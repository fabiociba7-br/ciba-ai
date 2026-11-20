package com.ciba.garcia

import com.ciba.garcia.chatterbox.ChatterboxNative

import android.Manifest
import android.content.Context
import android.content.Intent
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
internal fun VoiceCloningSection(voiceOutput: LocalSpeechOutput) {
    val context = LocalContext.current
    val store = remember { VoiceProfileStore(context) }
    var profiles by remember { mutableStateOf(emptyList<GarciaVoiceProfile>()) }
    val scope = rememberCoroutineScope()
    var modelsReady by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var downloadProgress by remember { mutableStateOf<ChatterboxModelManager.DownloadProgress?>(null) }
    var pendingT3Uri by remember { mutableStateOf<Uri?>(null) }
    var pendingS3Uri by remember { mutableStateOf<Uri?>(null) }
    var modelPickerTarget by remember { mutableStateOf("T3") }
    val nativeAvailable = ChatterboxNative.isLibraryLoaded()
    var selectedFile by remember { mutableStateOf<File?>(null) }
    var profileName by remember { mutableStateOf("") }
    var status by remember { mutableStateOf(if (selectedFile != null) "Amostra salva neste aparelho." else "Nenhuma amostra de voz selecionada.") }
    var recording by remember { mutableStateOf(false) }
    var elapsed by remember { mutableIntStateOf(0) }
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var tempFile by remember { mutableStateOf<File?>(null) }
    var playing by remember { mutableStateOf(false) }
    var consentGiven by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    LaunchedEffect(Unit) {
        val initial = withContext(Dispatchers.IO) {
            Triple(
                ChatterboxModelManager.installed(context) != null,
                store.profiles(),
                store.currentProfile()
            )
        }
        modelsReady = initial.first
        profiles = initial.second
        selectedFile = initial.third?.sample
        profileName = initial.third?.name.orEmpty()
        status = if (initial.third != null) "Perfil local encontrado e validado." else "Nenhum perfil clonado está ativo."
    }

    // Use the Android GetContent picker for broad compatibility with device
    // document providers. The two files are selected in separate, explicit
    // actions; their SHA-256 values, not their display names or selection order,
    // determine whether they are the official T3 and S3Gen models.
    val modelPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) {
            status = "Nenhum arquivo selecionado. Os modelos atuais foram preservados."
        } else {
            val selectedT3 = if (modelPickerTarget == "T3") uri else pendingT3Uri
            val selectedS3 = if (modelPickerTarget == "S3Gen") uri else pendingS3Uri
            pendingT3Uri = selectedT3
            pendingS3Uri = selectedS3
            val selected = listOfNotNull(selectedT3, selectedS3)
            if (selected.size == 2) {
                pendingT3Uri = null
                pendingS3Uri = null
                scope.launch {
                    busy = true
                    downloadProgress = null
                    status = "Importando T3 e S3Gen. Validando os dois arquivos pelos SHA-256 oficiais..."
                    try {
                        ChatterboxModelManager.importModels(context, selected) { progress -> downloadProgress = progress }
                        modelsReady = true
                        downloadProgress = null
                        status = if (nativeAvailable) "T3 e S3Gen importados e verificados. Biblioteca nativa disponível; ouça a prévia para testar a inicialização e a síntese." else "Modelos verificados, mas a biblioteca nativa não está disponível para esta arquitetura."
                    } catch (error: Throwable) {
                        downloadProgress = null
                        status = error.message ?: "Falha ao importar os modelos. Os modelos anteriores foram preservados."
                    } finally {
                        busy = false
                    }
                }
            } else {
                status = if (modelPickerTarget == "T3") {
                    "Arquivo selecionado para T3. Agora toque em Selecionar S3Gen para escolher o segundo arquivo obrigatório."
                } else {
                    "Arquivo selecionado para S3Gen. Agora toque em Selecionar T3 para escolher o segundo arquivo obrigatório."
                }
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                busy = true
                try {
                    val file = withContext(Dispatchers.IO) { store.importAudio(uri) }
                    selectedFile = file
                    profileName = profileName.ifBlank { "Minha voz" }
                    status = "Áudio importado e validado. Salve o perfil para mantê-lo."
                } catch (error: Throwable) {
                    status = error.message ?: "Não foi possível importar o áudio."
                } finally { busy = false }
            }
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
                scope.launch {
                    try {
                        val saved = withContext(Dispatchers.IO) { store.saveRecording(file) }
                        selectedFile = saved
                        profileName = profileName.ifBlank { "Minha voz" }
                        status = "Gravação concluída e validada. Salve o perfil."
                    } catch (error: Throwable) {
                        status = error.message ?: "Não foi possível validar a gravação."
                    } finally { file.delete() }
                }
            } else {
                status = "A gravação ficou muito curta ou não pôde ser finalizada. Tente novamente."
                file.delete()
            }
        }
    }

    LaunchedEffect(recording) {
        while (recording) {
            delay(1_000)
            elapsed++
            if (elapsed >= 30) stopRecording()
        }
    }
    val currentRecorder by rememberUpdatedState(recorder)
    val currentTempFile by rememberUpdatedState(tempFile)
    val isRecordingNow by rememberUpdatedState(recording)
    val currentPlayer by rememberUpdatedState(player)
    DisposableEffect(Unit) {
        onDispose {
            if (isRecordingNow) runCatching { currentRecorder?.stop() }
            currentRecorder?.release()
            if (isRecordingNow) currentTempFile?.delete()
            currentPlayer?.release()
        }
    }

    Column(Modifier.fillMaxWidth().heightIn(max = 540.dp).verticalScroll(rememberScrollState())) {
        Text("Crie um perfil com sua própria voz", style = MaterialTheme.typography.titleSmall)
        if (busy) { Spacer(Modifier.height(6.dp)); Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp); Text(status, fontSize = 12.sp) } }
        Text("Importe uma gravação ou grave diretamente pelo microfone. Prefira 10–15 segundos falando sozinho, perto do aparelho, em ambiente silencioso e sem música. A amostra fica na área privada da Garcia.", fontSize = 12.sp)
        Spacer(Modifier.height(10.dp))
        Text(if (modelsReady) "Modelos locais Chatterbox instalados e verificados por SHA-256." else "Para clonar a voz, instale aproximadamente 1,1 GB de modelos locais. O download é feito uma vez e fica no armazenamento privado.", fontSize = 12.sp)
        Text("A síntese roda em CPU (até quatro threads). A primeira carga e cada frase podem demorar conforme o aparelho; latência e consumo ainda precisam ser medidos no seu Android. O modelo é multilingual com português, não o fine-tune dedicado pt-BR.", fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
        if (!nativeAvailable) Text("O runtime nativo de clonagem não está disponível para esta arquitetura. As opções de prévia e ativação ficarão desabilitadas.", fontSize = 11.sp, color = MaterialTheme.colorScheme.error)
        if (!modelsReady) {
            downloadProgress?.let { progress ->
                val total = progress.totalBytes
                val fraction = if (total > 0L) (progress.downloadedBytes.toFloat() / total).coerceIn(0f, 1f) else 0f
                val downloadedMb = progress.downloadedBytes / (1024f * 1024f)
                val totalMb = if (total > 0L) total / (1024f * 1024f) else 0L
                val remainingMb = if (total > 0L) ((total - progress.downloadedBytes).coerceAtLeast(0L) / (1024f * 1024f)) else null
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("Baixando ${progress.fileName}", fontSize = 12.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                    if (total > 0L) {
                        LinearProgressIndicator(progress = { fraction }, modifier = Modifier.fillMaxWidth())
                        Text("${(fraction * 100).toInt()}% · ${downloadedMb.toInt()} MB de ${totalMb} MB", fontSize = 12.sp)
                        Text("Faltam ${remainingMb} MB", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                    } else {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        Text("${downloadedMb.toInt()} MB baixados · tamanho total indisponível", fontSize = 12.sp)
                    }
                }
            }
            OutlinedButton(
                onClick = {
                    scope.launch {
                        busy = true
                        status = "Baixando os modelos Chatterbox. Mantenha a Garcia aberta..."
                        try {
                            ChatterboxModelManager.download(context) { progress -> downloadProgress = progress }
                            modelsReady = true
                            downloadProgress = null
                            status = "Modelos locais instalados e validados. Salve uma referência de 5–30 segundos para criar um perfil."
                        } catch (error: Throwable) {
                            downloadProgress = null
                            status = error.message ?: "Falha ao baixar os modelos."
                        } finally { busy = false }
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth()
            ) { Text(if (busy) "Aguarde..." else "Baixar modelos de voz") }
            Spacer(Modifier.height(6.dp))
            if (busy && downloadProgress != null) { val p = downloadProgress!!; val ratio = if (p.totalBytes > 0L) (p.downloadedBytes.toFloat() / p.totalBytes).coerceIn(0f, 1f) else 0f; Text("Importando ${p.fileName}", fontSize = 12.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold); if (p.totalBytes > 0L) { LinearProgressIndicator(progress = { ratio }, modifier = Modifier.fillMaxWidth()); Text("${(ratio * 100).toInt()}% · ${p.downloadedBytes / (1024 * 1024)} MB de ${p.totalBytes / (1024 * 1024)} MB · faltam ${(p.totalBytes - p.downloadedBytes).coerceAtLeast(0) / (1024 * 1024)} MB", fontSize = 11.sp) } else { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()); Text("${p.downloadedBytes / (1024 * 1024)} MB importados", fontSize = 11.sp) } }
        }
        Text("Gerenciar modelos Chatterbox", style = MaterialTheme.typography.titleSmall)
        Text(
            if (modelsReady) "Os modelos atuais permanecem instalados até T3 e S3Gen serem selecionados e os dois SHA-256 oficiais serem validados."
            else "São obrigatórios dois arquivos GGUF: T3 e S3Gen. Selecione cada um pelo botão correspondente; a ordem não altera a validação.",
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.secondary
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = {
                    modelPickerTarget = "T3"
                    status = "Abrindo o seletor de arquivos Android. Escolha o GGUF T3."
                    modelPicker.launch("*/*")
                },
                enabled = !busy,
                modifier = Modifier.weight(1f)
            ) { Text(if (pendingT3Uri != null) "Trocar T3" else "Selecionar T3") }
            OutlinedButton(
                onClick = {
                    modelPickerTarget = "S3Gen"
                    status = "Abrindo o seletor de arquivos Android. Escolha o GGUF S3Gen."
                    modelPicker.launch("*/*")
                },
                enabled = !busy,
                modifier = Modifier.weight(1f)
            ) { Text(if (pendingS3Uri != null) "Trocar S3Gen" else "Selecionar S3Gen") }
        }
        Text(
            "T3: ${if (pendingT3Uri != null) "selecionado" else "pendente"} · S3Gen: ${if (pendingS3Uri != null) "selecionado" else "pendente"}",
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.secondary
        )
        if (profiles.isNotEmpty()) {
            Text("Perfis de voz salvos", style = MaterialTheme.typography.titleSmall)
            profiles.forEach { profile ->
                val active = store.activeProfileId() == profile.id
                Column(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                    Text(if (active && profile.integrityValid) profile.name + " · Voz ativa" else if (active) profile.name + " · Referência inválida" else profile.name, fontWeight = if (active) androidx.compose.ui.text.font.FontWeight.Bold else androidx.compose.ui.text.font.FontWeight.Normal)
                    Text(if (profile.integrityValid) "Referência: ${profile.durationMs / 1000}s · SHA-256 validado · armazenamento privado" else "SHA-256 inválido ou arquivo ausente. Exclua e importe a referência novamente.", fontSize = 10.sp, color = if (profile.integrityValid) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(
                            onClick = {
                                busy = true
                                status = "Gerando uma amostra com o perfil '${profile.name}'..."
                                val accepted = voiceOutput.previewClonedProfile(profile) { result ->
                                    scope.launch {
                                        busy = false
                                        status = result.fold({ "Prévia da voz clonada concluída." }, { "Falha na prévia: ${it.message}" })
                                    }
                                }
                                if (!accepted) {
                                    busy = false
                                    status = "Instale os modelos locais Chatterbox antes de ouvir a voz clonada."
                                }
                            },
                            enabled = !busy && modelsReady && nativeAvailable && profile.integrityValid
                        ) { Text("Ouvir voz clonada") }
                        TextButton(
                            onClick = {
                                busy = true
                                status = "Ativando '${profile.name}' para as respostas da Garcia..."
                                val accepted = voiceOutput.selectClonedProfile(profile) { result ->
                                    scope.launch {
                                        busy = false
                                        status = result.fold(
                                            { "Voz '${profile.name}' definida para as respostas da Garcia." },
                                            { "Não foi possível ativar a voz: ${it.message}" }
                                        )
                                    }
                                }
                                if (!accepted) {
                                    busy = false
                                    status = "Não foi possível ativar: instale e valide os modelos locais primeiro."
                                }
                            },
                            enabled = !busy && modelsReady && nativeAvailable && profile.integrityValid
                        ) { Text(if (active && voiceOutput.isClonedRuntimeReady()) "Recarregar" else if (active) "Preparar" else "Usar esta voz") }
                        TextButton(
                            onClick = {
                                scope.launch {
                                    busy = true
                                    val wasActive = active
                                    try {
                                        withContext(Dispatchers.IO) { store.delete(profile.id) }
                                        voiceOutput.onProfileDeleted(profile.id, wasActive)
                                        profiles = withContext(Dispatchers.IO) { store.profiles() }
                                        if (selectedFile?.parentFile == profile.sample.parentFile) selectedFile = null
                                        status = if (wasActive) "Perfil excluído. Voz do sistema restaurada." else "Perfil excluído."
                                    } catch (error: Throwable) {
                                        status = error.message ?: "Não foi possível excluir o perfil."
                                    } finally { busy = false }
                                }
                            },
                            enabled = !busy
                        ) { Text("Excluir") }
                    }
                    HorizontalDivider()
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
            OutlinedTextField(value = profileName, onValueChange = { profileName = it.take(40) }, label = { Text("Nome do perfil") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            profiles.firstOrNull { it.sample == file }?.let { selectedProfile ->
                TextButton(onClick = {
                    runCatching {
                        store.rename(selectedProfile.id, profileName)
                        scope.launch {
                            profiles = withContext(Dispatchers.IO) { store.profiles() }
                            status = "Perfil renomeado."
                        }
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
                            val saved = withContext(Dispatchers.IO) {
                                val target = File(context.cacheDir, "voice-normalized-${UUID.randomUUID()}.wav")
                                target.parentFile?.mkdirs()
                                VoiceAudioNormalizer.toMonoWav(file, target)
                                val profile = store.save(file, profileName, target)
                                profile to store.profiles()
                            }
                            selectedFile = saved.first.sample
                            profileName = saved.first.name
                            profiles = saved.second
                            status = "Perfil salvo localmente. Ouça a prévia ou toque em Usar esta voz para ativá-lo."
                            busy = false
                        } catch (error: Throwable) {
                            busy = false
                            status = error.message ?: "Falha ao preparar o áudio."
                        }
                    }
                }, enabled = profileName.isNotBlank() && consentGiven && !recording && !busy && profiles.none { it.sample == file }, modifier = Modifier.weight(1f)) { Text(if (profiles.any { it.sample == file }) "Perfil salvo" else "Salvar perfil de voz") }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = consentGiven, onCheckedChange = { consentGiven = it })
                Text("Confirmo que esta é minha voz ou que tenho autorização explícita da pessoa gravada.", fontSize = 11.sp)
            }
        }
        Text(status, fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
        Spacer(Modifier.height(6.dp))
        Text("A gravação, a referência, o condicionamento e a síntese permanecem no armazenamento privado do aparelho. Nenhum áudio é enviado ao Worker ou a serviços externos. Sem modelo válido, prévia e ativação ficam desabilitadas.", fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
    }
}
