package com.ciba.garcia

import android.content.ContentValues
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

internal object LocalImageNative {
    init { System.loadLibrary("garcia_image") }
    external fun nativeLoadModel(modelPath: String): Boolean
    external fun nativeGenerate(prompt: String, negativePrompt: String, width: Int, height: Int, steps: Int, seed: Long): IntArray
    external fun nativeReleaseModel()
}

class LocalImageGenerationActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                val scope = rememberCoroutineScope()
                var modelFile by remember { mutableStateOf<File?>(null) }
                var modelLabel by remember { mutableStateOf("Nenhum modelo carregado") }
                var prompt by remember { mutableStateOf("") }
                var negative by remember { mutableStateOf("low quality, blurry, distorted") }
                var busy by remember { mutableStateOf(false) }
                var status by remember { mutableStateOf("A geração acontece localmente, sem API.") }
                var result by remember { mutableStateOf<Bitmap?>(null) }

                val modelPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
                    if (uri != null) scope.launch {
                        busy = true
                        status = "Copiando o modelo para o armazenamento privado da Garcia…"
                        try {
                            val file = withContext(Dispatchers.IO) {
                                val name = contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                                    if (it.moveToFirst()) it.getString(0) else "modelo.safetensors"
                                } ?: "modelo.safetensors"
                                val ext = name.substringAfterLast('.', "").lowercase()
                                require(ext in setOf("safetensors", "ckpt", "gguf", "bin")) {
                                    "Formato não reconhecido. Selecione um modelo .safetensors, .ckpt ou .gguf."
                                }
                                val target = File(filesDir, "image-models").apply { mkdirs() }
                                    .resolve("selected-model.$ext")
                                contentResolver.openInputStream(uri)?.use { input ->
                                    target.outputStream().use { output -> input.copyTo(output, 1024 * 1024) }
                                } ?: error("Não foi possível ler o arquivo selecionado.")
                                target
                            }
                            status = "Carregando o modelo na memória. Isso pode levar alguns minutos…"
                            val loaded = withContext(Dispatchers.IO) { LocalImageNative.nativeLoadModel(file.absolutePath) }
                            check(loaded) { "O motor não conseguiu carregar esse modelo." }
                            modelFile = file
                            modelLabel = file.name
                            status = "Modelo carregado. Pronta para criar imagens offline."
                        } catch (error: Exception) {
                            status = error.message ?: "Não foi possível carregar o modelo."
                        } finally { busy = false }
                    }
                }

                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
                    Text("Garcia • Criar imagem", style = MaterialTheme.typography.headlineSmall)
                    Spacer(Modifier.height(8.dp))
                    Text("Motor Stable Diffusion local. Depois de carregar o modelo, a geração não usa internet, API ou servidor.", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(18.dp))
                    OutlinedButton(onClick = { modelPicker.launch(arrayOf("*/*")) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Text("Selecionar modelo no aparelho")
                    }
                    Text(modelLabel, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(prompt, { prompt = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Descreva a imagem") }, minLines = 3)
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(negative, { negative = it }, modifier = Modifier.fillMaxWidth(), label = { Text("O que evitar (opcional)") }, minLines = 2)
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = {
                            scope.launch {
                                busy = true
                                status = "Gerando no próprio aparelho…"
                                try {
                                    val values = withContext(Dispatchers.IO) {
                                        LocalImageNative.nativeGenerate(prompt.trim(), negative.trim(), 512, 512, 20, -1L)
                                    }
                                    require(values.size >= 3) { "A geração não retornou uma imagem válida." }
                                    val width = values[0]
                                    val height = values[1]
                                    result = Bitmap.createBitmap(values.copyOfRange(2, values.size), width, height, Bitmap.Config.ARGB_8888)
                                    status = "Imagem criada localmente."
                                } catch (error: Exception) {
                                    status = error.message ?: "Falha na geração."
                                } finally { busy = false }
                            }
                        },
                        enabled = !busy && modelFile != null && prompt.isNotBlank(),
                        modifier = Modifier.fillMaxWidth()
                    ) { Text(if (busy) "Processando…" else "Gerar imagem") }
                    Spacer(Modifier.height(12.dp))
                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text(status, style = MaterialTheme.typography.bodySmall)
                    result?.let { bitmap ->
                        Spacer(Modifier.height(18.dp))
                        Image(bitmap.asImageBitmap(), contentDescription = "Imagem gerada pela Garcia", modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { saveImage(bitmap); status = "Imagem salva na galeria." }, modifier = Modifier.fillMaxWidth()) {
                            Text("Salvar na galeria")
                        }
                    }
                }
            }
        }
    }

    private fun saveImage(bitmap: Bitmap) {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "Garcia-" + System.currentTimeMillis() + ".png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Garcia")
        }
        val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: error("Não foi possível criar o arquivo na galeria.")
        contentResolver.openOutputStream(uri)?.use { output ->
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) { "Falha ao gravar a imagem." }
        } ?: error("Não foi possível gravar a imagem.")
    }

    override fun onDestroy() {
        super.onDestroy()
        Thread { LocalImageNative.nativeReleaseModel() }.start()
    }
}
