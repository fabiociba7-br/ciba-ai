package com.ciba.garcia

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun FacebookManagerDialog(client: CibaAiClient, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var profile by remember { mutableStateOf(JSONObject()) }
    var permissions by remember { mutableStateOf(JSONArray()) }
    var posts by remember { mutableStateOf(JSONArray()) }
    var photos by remember { mutableStateOf(JSONArray()) }
    var videos by remember { mutableStateOf(JSONArray()) }
    var videoNote by remember { mutableStateOf("") }
    var commentsNote by remember { mutableStateOf("A Meta pode limitar a leitura de comentários feitos por outras pessoas em publicações de perfil pessoal.") }
    var selectedPostId by remember { mutableStateOf("") }
    var postComments by remember { mutableStateOf(JSONArray()) }
    var commentsBusy by remember { mutableStateOf(false) }

    fun refresh() {
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    val p = client.facebookProfile().optJSONObject("profile") ?: JSONObject()
                    val perms = client.facebookPermissions().optJSONArray("data") ?: JSONArray()
                    val postResult = client.facebookPosts(30)
                    val photoResult = client.facebookPhotos(30)
                    val videoResult = client.facebookVideos(30)
                    JSONObject()
                        .put("profile", p)
                        .put("permissions", perms)
                        .put("posts", postResult.optJSONObject("posts")?.optJSONArray("data") ?: JSONArray())
                        .put("photos", photoResult.optJSONObject("photos")?.optJSONArray("data") ?: JSONArray())
                        .put("videos", videoResult.optJSONObject("videos")?.optJSONArray("data") ?: JSONArray())
                        .put("video_availability", videoResult.optString("availability", "available"))
                        .put("video_note", videoResult.optString("note"))
                }
                profile = result.optJSONObject("profile") ?: JSONObject()
                permissions = result.optJSONArray("permissions") ?: JSONArray()
                posts = result.optJSONArray("posts") ?: JSONArray()
                photos = result.optJSONArray("photos") ?: JSONArray()
                videos = result.optJSONArray("videos") ?: JSONArray()
                if (videos.length() == 0) {
                    val extracted = JSONArray()
                    val postItems = result.optJSONArray("posts") ?: JSONArray()
                    for (postIndex in 0 until postItems.length()) {
                        val post = postItems.optJSONObject(postIndex) ?: continue
                        val attachments = post.optJSONObject("attachments")?.optJSONArray("data") ?: continue
                        for (attachmentIndex in 0 until attachments.length()) {
                            val attachment = attachments.optJSONObject(attachmentIndex) ?: continue
                            val mediaType = attachment.optString("media_type").lowercase()
                            val type = attachment.optString("type").lowercase()
                            if (mediaType.contains("video") || type.contains("video")) {
                                extracted.put(JSONObject()
                                    .put("description", attachment.optString("title").ifBlank { post.optString("message") })
                                    .put("created_time", post.optString("created_time"))
                                    .put("permalink_url", post.optString("permalink_url")))
                            }
                        }
                    }
                    videos = extracted
                }
                videoNote = result.optString("video_note").ifBlank {
                    if (result.optString("video_availability") == "available") "" else "A leitura direta de vídeos não está disponível nesta versão da API."
                }
            } catch (e: Exception) {
                error = e.message ?: "Não foi possível consultar os dados pessoais do Facebook."
            } finally {
                busy = false
            }
        }
    }

    fun loadComments(postId: String) {
        if (postId.isBlank() || commentsBusy) return
        selectedPostId = postId
        commentsBusy = true
        postComments = JSONArray()
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { client.facebookComments(postId, 30) }
                postComments = result.optJSONObject("comments")?.optJSONArray("data") ?: JSONArray()
                commentsNote = if (postComments.length() == 0) {
                    "A Meta não disponibilizou os comentários de outras pessoas para esta publicação usando o token pessoal. A consulta foi realizada, mas não retornou comentários."
                } else {
                    "A Meta retornou ${postComments.length()} comentário(s) visíveis para este aplicativo."
                }
            } catch (e: Exception) {
                commentsNote = e.message ?: "A leitura de comentários não foi autorizada pela Meta."
            } finally {
                commentsBusy = false
            }
        }
    }

    LaunchedEffect(Unit) { refresh() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Meu Facebook · Garcia", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(7.dp)
            ) {
                if (busy) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator()
                        Text("Lendo sua conta do Facebook…")
                    }
                }
                if (error.isNotBlank()) {
                    Text(error, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }

                Text(profile.optString("name").ifBlank { "Seu perfil Facebook" }, fontWeight = FontWeight.Bold)
                val picture = profile.optJSONObject("picture")?.optJSONObject("data")?.optString("url").orEmpty()
                if (picture.isNotBlank()) Text("Foto de perfil disponível")
                profile.optString("email").takeIf { it.isNotBlank() }?.let { Text("E-mail: $it", fontSize = 12.sp) }
                profile.optString("link").takeIf { it.isNotBlank() }?.let { Text("Perfil: $it", fontSize = 11.sp) }

                Divider()
                Text("Permissões efetivamente concedidas", fontWeight = FontWeight.Bold)
                if (permissions.length() == 0) {
                    Text("A Meta não retornou a lista de permissões.", fontSize = 12.sp)
                } else {
                    for (index in 0 until permissions.length()) {
                        val item = permissions.optJSONObject(index) ?: continue
                        Text("• ${item.optString("permission")} — ${item.optString("status")}", fontSize = 12.sp)
                    }
                }

                Divider()
                Text("Suas publicações (${posts.length()})", fontWeight = FontWeight.Bold)
                if (posts.length() == 0) {
                    Text("Nenhuma publicação retornada. Confirme se user_posts foi concedida e liberada para o app.", fontSize = 12.sp)
                } else {
                    for (index in 0 until minOf(posts.length(), 30)) {
                        val post = posts.optJSONObject(index) ?: continue
                        Text(post.optString("message").ifBlank { post.optString("story").ifBlank { "Publicação sem texto" } }, fontSize = 12.sp)
                        val date = post.optString("created_time")
                        if (date.isNotBlank()) Text(date, fontSize = 10.sp)
                        val likes = post.optJSONObject("likes")?.optJSONObject("summary")?.optInt("total_count", -1) ?: -1
                        val commentCount = post.optJSONObject("comments")?.optJSONObject("summary")?.optInt("total_count", -1) ?: -1
                        val metrics = buildList {
                            if (likes >= 0) add("$likes reações")
                            if (commentCount >= 0) add("$commentCount comentários indicados")
                        }.joinToString(" · ")
                        if (metrics.isNotBlank()) Text(metrics, fontSize = 10.sp)
                        post.optString("permalink_url").takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 10.sp) }
                        TextButton(onClick = { loadComments(post.optString("id")) }, enabled = !commentsBusy && post.optString("id").isNotBlank()) {
                            Text(if (selectedPostId == post.optString("id") && commentsBusy) "Consultando comentários…" else "Tentar ler comentários")
                        }
                        if (selectedPostId == post.optString("id")) {
                            if (postComments.length() == 0 && !commentsBusy) {
                                Text(commentsNote, fontSize = 11.sp)
                            } else {
                                for (commentIndex in 0 until minOf(postComments.length(), 10)) {
                                    val comment = postComments.optJSONObject(commentIndex) ?: continue
                                    Text(comment.optString("message"), fontSize = 11.sp)
                                }
                            }
                        }
                        Divider()
                    }
                }
                Text(commentsNote, fontSize = 11.sp)

                Divider()
                Text("Suas fotos enviadas (${photos.length()})", fontWeight = FontWeight.Bold)
                if (photos.length() == 0) Text("Nenhuma foto retornada ou permissão indisponível.", fontSize = 12.sp)
                for (index in 0 until minOf(photos.length(), 20)) {
                    val photo = photos.optJSONObject(index) ?: continue
                    Text(photo.optString("name").ifBlank { "Foto sem descrição" }, fontSize = 12.sp)
                    Text(photo.optString("created_time"), fontSize = 10.sp)
                    photo.optString("link").takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 10.sp) }
                }

                Divider()
                Text("Seus vídeos (${videos.length()})", fontWeight = FontWeight.Bold)
                if (videos.length() == 0) Text(videoNote.ifBlank { "A API não retornou vídeos por leitura direta." }, fontSize = 12.sp)
                for (index in 0 until minOf(videos.length(), 20)) {
                    val video = videos.optJSONObject(index) ?: continue
                    Text(video.optString("description").ifBlank { "Vídeo" }, fontSize = 12.sp)
                    Text(video.optString("created_time"), fontSize = 10.sp)
                }

                Divider()
                Text("Mensagens pessoais do Messenger", fontWeight = FontWeight.Bold)
                Text("A API oficial disponível para este aplicativo não permite ler a caixa de entrada pessoal. Esse recurso fica identificado como indisponível, sem tentar acessar conversas de Páginas.", fontSize = 12.sp)
            }
        },
        confirmButton = {
            TextButton(onClick = { refresh() }, enabled = !busy) { Text("Atualizar") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Fechar") }
        }
    )
}
