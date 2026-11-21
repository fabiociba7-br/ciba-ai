package com.ciba.garcia

import android.Manifest
import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

@Composable
fun VoiceReferenceSection() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val recorder = remember { AudioReferenceRecorder(File(context.filesDir, "voice-references")) }
    var recording by remember { mutableStateOf(false) }
    var paused by remember { mutableStateOf(false) }
    var level by remember { mutableFloatStateOf(0f) }
    var duration by remember { mutableLongStateOf(0L) }
    var sampleFile by remember { mutableStateOf<File?>(null) }
    var status by remember { mutableStateOf("Grave uma amostra ou importe um arquivo de áudio.") }
    var busy by remember { mutableStateOf(false) }
    var previewing by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }

    fun stopPreview() {
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
        previewing = false
    }

    DisposableEffect(Unit) {
        onDispose {
            stopPreview()
            if (recorder.isRecording) recorder.cancel()
        }
    }

    val importPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) scope.launch {
            busy = true
            try {
                val imported = withContext(Dispatchers.IO) {
                    val dir = File(context.filesDir, "voice-references").apply { mkdirs() }
                    val mime = context.contentResolver.getType(uri).orEmpty()
                    require(mime.startsWith("audio/") || mime in setOf("application/octet-stream", "application/ogg")) {
                        "Selecione um arquivo de áudio."
                    }
                    val ext = when {
                        mime.contains("wav") -> ".wav"
                        mime.contains("mpeg") || mime.contains("mp3") -> ".mp3"
                        mime.contains("mp4") || mime.contains("m4a") -> ".m4a"
                        mime.contains("ogg") -> ".ogg"
                        else -> ".audio"
                    }
                    val target = File(dir, "voice-import-${System.currentTimeMillis()}$ext")
                    context.contentResolver.openInputStream(uri)?.use { input ->
                        FileOutputStream(target).use { output ->
                            val buffer = ByteArray(16 * 1024)
                            var total = 0L
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                require(total <= 100L * 1024 * 1024) { "O áudio importado deve ter até 100 MB." }
                                output.write(buffer, 0, count)
                            }
                        }
                    } ?: error("Não foi possível abrir o arquivo de áudio.")
                    require(target.length() > 0L) { "O arquivo de áudio está vazio." }
                    target
                }
                stopPreview()
                sampleFile = imported
                status = "Áudio importado e salvo em armazenamento privado. Original preservado."
            } catch (e: Exception) {
                status = e.message ?: "Falha ao importar áudio."
            } finally { busy = false }
        }
    }

    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            runCatching { recorder.start(); recording = true; paused = false; status = "Gravando em WAV PCM, mono, 48 kHz, 16 bits." }
                .onFailure { status = it.message ?: "Não foi possível iniciar o microfone." }
        } else status = "Permissão do microfone negada. Ative-a nas configurações do Android."
    }

    LaunchedEffect(recording) {
        while (recording) {
            level = recorder.peakLevel
            duration = recorder.durationMillis
            if (duration >= AudioReferenceRecorder.MAX_DURATION_SECONDS * 1000L) {
                status = "Limite de 3 minutos atingido. Finalize a gravação."
            }
            kotlinx.coroutines.delay(80)
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Amostra de voz", fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
        Text("A captura é feita no aparelho. WAV PCM mono a 48 kHz/16 bits, sem compressão com perdas nem aumento artificial de qualidade.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f).height(10.dp).background(Color(0xFFE7E1E5), RoundedCornerShape(8.dp))) {
                Box(Modifier.fillMaxWidth(level.coerceIn(0f, 1f)).fillMaxHeight().background(
                    if (level > 0.92f) Color(0xFFB3261E) else Color(0xFF24845A), RoundedCornerShape(8.dp)
                ))
            }
            Text(if (level > 0.92f) "Alto" else "Nível", fontSize = 11.sp)
        }
        Text(if (recording) {
            val seconds = duration / 1000L
            "Tempo: %02d:%02d%s".format(seconds / 60, seconds % 60, if (paused) " · pausado" else " · gravando")
        } else "Tempo da última gravação: ${duration / 1000}s", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    if (recording) {
                        runCatching { if (paused) recorder.resume() else recorder.pause() }
                            .onSuccess { paused = !paused; status = if (paused) "Gravação pausada." else "Gravação retomada." }
                            .onFailure { status = it.message ?: "Não foi possível alterar a gravação." }
                    } else microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
                },
                enabled = !busy && (recording || ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !recording),
                modifier = Modifier.weight(1f)
            ) { Text(if (!recording) "Gravar" else if (paused) "Continuar" else "Pausar") }
            OutlinedButton(
                onClick = {
                    busy = true
                    scope.launch {
                        try {
                            val saved = withContext(Dispatchers.IO) { recorder.stop() }
                            sampleFile = saved
                            recording = false; paused = false; level = 0f
                            status = "Gravação salva em WAV original no armazenamento privado."
                        } catch (e: Exception) {
                            status = e.message ?: "Falha ao salvar a gravação."
                        } finally { busy = false }
                    }
                },
                enabled = recording && !busy,
                modifier = Modifier.weight(1f)
            ) { Text("Finalizar") }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { importPicker.launch(arrayOf("audio/*")) }, enabled = !recording && !busy, modifier = Modifier.weight(1f)) {
                Text("Importar áudio")
            }
            OutlinedButton(onClick = {
                if (recording) recorder.cancel()
                recording = false; paused = false; level = 0f; duration = 0L
                sampleFile?.delete(); sampleFile = null
                stopPreview()
                status = "Amostra descartada. Você pode gravar ou importar outra."
            }, enabled = !busy && (sampleFile != null || recording), modifier = Modifier.weight(1f)) {
                Text("Descartar")
            }
        }
        if (sampleFile != null) {
            Text("Arquivo: ${sampleFile!!.name} · ${sampleFile!!.length() / 1024} KB", fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    stopPreview()
                    runCatching {
                        player = MediaPlayer().apply {
                            setDataSource(sampleFile!!.absolutePath)
                            setOnCompletionListener { stopPreview() }
                            prepare()
                            start()
                        }
                        previewing = true
                    }.onFailure { status = "Não foi possível reproduzir esta amostra: ${it.message}" }
                }, enabled = !recording && !busy && !previewing, modifier = Modifier.weight(1f)) { Text("Ouvir prévia") }
                OutlinedButton(onClick = { stopPreview() }, enabled = previewing, modifier = Modifier.weight(1f)) { Text("Parar prévia") }
            }
        }
        if (busy) CircularProgressIndicator(modifier = Modifier.size(20.dp))
        Text(status, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        Text("A amostra fica privada neste aparelho. A conexão com um motor de clonagem será adicionada somente após validar o modelo escolhido e sua compatibilidade.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
    }
}
