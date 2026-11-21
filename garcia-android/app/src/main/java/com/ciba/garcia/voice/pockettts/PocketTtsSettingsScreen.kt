package com.ciba.garcia.voice.pockettts

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@Composable
fun PocketTtsSettingsScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val modelManager = remember { PocketTtsModelPackManager(File(context.filesDir, "pockettts/models")) }
    val profileManager = remember { PocketTtsVoiceProfileManager(File(context.filesDir, "pockettts/profiles")) }
    val preferences = remember { context.getSharedPreferences("garcia_pockettts", Context.MODE_PRIVATE) }
    var packs by remember { mutableStateOf(emptyList<PocketTtsModelPackManager.InstalledPack>()) }
    var profiles by remember { mutableStateOf(emptyList<PocketTtsVoiceProfileManager.VoiceProfile>()) }
    var selectedPackId by remember { mutableStateOf(preferences.getString("selected_pack", null).orEmpty()) }
    var selectedProfileId by remember { mutableStateOf(preferences.getString("selected_profile", "").orEmpty()) }
    var profileName by remember { mutableStateOf("Minha voz") }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("Verificando armazenamento privado…") }
    var showDeletePack by remember { mutableStateOf<String?>(null) }
    var showDeleteProfile by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                modelManager.listInstalledPacks() to profileManager.listProfiles()
            }
            packs = result.first
            profiles = result.second
            if (packs.none { it.id == selectedPackId }) selectedPackId = ""
            if (profiles.none { it.id == selectedProfileId }) selectedProfileId = ""
            preferences.edit().putString("selected_pack", selectedPackId)
                .putString("selected_profile", selectedProfileId).apply()
        }
    }

    LaunchedEffect(Unit) { refresh() }

    val packPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            status = "Importando pacote e verificando os arquivos…"
            try {
                val pack = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { modelManager.installPack(it) }
                        ?: error("Não foi possível abrir o pacote selecionado.")
                }
                selectedPackId = pack.id
                preferences.edit().putString("selected_pack", pack.id).apply()
                refresh()
                status = "Modelo instalado: ${pack.name} · ${pack.languageTag} · ${pack.precision.uppercase()}"
            } catch (error: Exception) {
                status = error.message ?: "Falha ao importar o pacote Pocket TTS."
            } finally { busy = false }
        }
    }

    val profilePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            status = "Decodificando e convertendo áudio para WAV PCM 24 kHz mono…"
            try {
                val profile = withContext(Dispatchers.IO) {
                    val normalizedWav = PocketTtsAudioImporter.decodeToPcmWav(context.contentResolver, uri)
                    profileManager.importWav(profileName, normalizedWav.inputStream())
                }
                selectedProfileId = profile.id
                preferences.edit().putString("selected_profile", profile.id).apply()
                refresh()
                status = "Perfil ${profile.displayName} importado · ${"%.1f".format(profile.durationSeconds)} s"
            } catch (error: Exception) {
                status = error.message ?: "Falha ao importar o perfil vocal."
            } finally { busy = false }
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text("Pocket TTS nativo · clonagem offline", fontWeight = FontWeight.Bold)
        Text("Modelos e perfis ficam no armazenamento privado da Garcia. Nenhum aplicativo complementar é necessário.", style = MaterialTheme.typography.bodySmall)
        Text("Áudio de referência: importe WAV, MP3, M4A ou AAC. A Garcia converte automaticamente para WAV PCM 16-bit, mono, 24 kHz (3 a 30 segundos).", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(4.dp))
        Text("Modelos", fontWeight = FontWeight.SemiBold)
        Text("Importe o pacote ZIP completo. A Garcia valida manifesto, arquivos obrigatórios, caminhos e limites antes de instalá-lo.", style = MaterialTheme.typography.bodySmall)
        Button(onClick = { packPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "*/*")) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text("Importar pacote de modelos ZIP")
        }
        if (packs.isEmpty()) Text("Nenhum pacote instalado.", style = MaterialTheme.typography.bodySmall)
        packs.forEach { pack ->
            Column(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                Text(pack.name, fontWeight = FontWeight.SemiBold)
                Text("${pack.languageTag} · ${pack.precision.uppercase()} · ${pack.directory.walkTopDown().filter { it.isFile }.sumOf { it.length() } / (1024 * 1024)} MB", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (selectedPackId == pack.id) Text("Selecionado", color = MaterialTheme.colorScheme.primary)
                    else TextButton(onClick = {
                        selectedPackId = pack.id
                        preferences.edit().putString("selected_pack", pack.id).apply()
                    }) { Text("Usar modelo") }
                    TextButton(onClick = { showDeletePack = pack.id }, enabled = !busy) { Text("Excluir") }
                }
            }
        }
        Spacer(Modifier.height(4.dp))
        Text("Perfis de voz", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value = profileName, onValueChange = { profileName = it.take(64) },
            label = { Text("Nome do perfil") }, singleLine = true,
            modifier = Modifier.fillMaxWidth(), enabled = !busy
        )
        OutlinedButton(onClick = { profilePicker.launch(arrayOf("audio/wav", "audio/x-wav", "audio/*", "*/*")) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text("Importar áudio para clonagem")
        }
        if (profiles.isEmpty()) Text("Nenhum perfil vocal importado.", style = MaterialTheme.typography.bodySmall)
        profiles.forEach { profile ->
            Column(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                Text(profile.displayName, fontWeight = FontWeight.SemiBold)
                Text("WAV · ${"%.1f".format(profile.durationSeconds)} s · armazenado localmente", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (selectedProfileId == profile.id) Text("Selecionado", color = MaterialTheme.colorScheme.primary)
                    else TextButton(onClick = {
                        selectedProfileId = profile.id
                        preferences.edit().putString("selected_profile", profile.id).apply()
                    }) { Text("Usar voz") }
                    TextButton(onClick = { showDeleteProfile = profile.id }, enabled = !busy) { Text("Excluir") }
                }
            }
        }
        val selectedPack = packs.firstOrNull { it.id == selectedPackId }
        val hasReference = selectedProfileId.isNotBlank() ||
            selectedPack?.voicesDirectory?.walkTopDown()?.any { it.isFile && it.extension.equals("wav", true) } == true
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    status = "Inicializando Pocket TTS e sintetizando amostra…"
                    val success = PocketTtsPlayback.speak(context, "Olá! Esta é uma amostra da voz selecionada na Garcia.")
                    status = if (success) "Amostra reproduzida com sucesso." else "Não foi possível sintetizar. Confira o modelo, a ABI e o perfil vocal."
                    busy = false
                }
            },
            enabled = !busy && selectedPack != null && hasReference,
            modifier = Modifier.fillMaxWidth()
        ) { Text("Testar voz selecionada") }
        if (busy) CircularProgressIndicator()
        Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
        Text("A disponibilidade da clonagem depende de um pacote compatível instalado e da validação do runtime nativo neste aparelho.", style = MaterialTheme.typography.bodySmall)
    }

    showDeletePack?.let { id ->
        AlertDialog(
            onDismissRequest = { showDeletePack = null },
            title = { Text("Excluir modelo?") },
            text = { Text("O pacote e todos os seus arquivos serão removidos do armazenamento privado da Garcia.") },
            confirmButton = {
                TextButton(onClick = {
                    showDeletePack = null
                    scope.launch {
                        busy = true
                        status = try {
                            withContext(Dispatchers.IO) { check(modelManager.deletePack(id)) }
                            if (selectedPackId == id) {
                                selectedPackId = ""
                                preferences.edit().remove("selected_pack").apply()
                            }
                            refresh()
                            "Pacote removido."
                        } catch (error: Exception) { error.message ?: "Não foi possível excluir o pacote." }
                        busy = false
                    }
                }) { Text("Excluir") }
            },
            dismissButton = { TextButton(onClick = { showDeletePack = null }) { Text("Cancelar") } }
        )
    }

    showDeleteProfile?.let { id ->
        AlertDialog(
            onDismissRequest = { showDeleteProfile = null },
            title = { Text("Excluir perfil vocal?") },
            text = { Text("O áudio WAV e os metadados deste perfil serão removidos.") },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteProfile = null
                    scope.launch {
                        busy = true
                        status = try {
                            withContext(Dispatchers.IO) { check(profileManager.deleteProfile(id)) }
                            if (selectedProfileId == id) {
                                selectedProfileId = ""
                                preferences.edit().remove("selected_profile").apply()
                            }
                            refresh()
                            "Perfil removido."
                        } catch (error: Exception) { error.message ?: "Não foi possível excluir o perfil." }
                        busy = false
                    }
                }) { Text("Excluir") }
            },
            dismissButton = { TextButton(onClick = { showDeleteProfile = null }) { Text("Cancelar") } }
        )
    }
}
