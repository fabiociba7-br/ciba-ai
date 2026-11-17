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
    var pages by remember { mutableStateOf(JSONArray()) }
    var posts by remember { mutableStateOf(JSONArray()) }
    var conversations by remember { mutableStateOf(JSONArray()) }
    var messages by remember { mutableStateOf(JSONArray()) }
    var selectedPageId by remember { mutableStateOf("") }
    var selectedPageName by remember { mutableStateOf("") }
    var selectedConversationId by remember { mutableStateOf("") }

    fun loadPage(page: JSONObject) {
        val pageId = page.optString("id")
        if (pageId.isBlank()) return
        selectedPageId = pageId
        selectedPageName = page.optString("name", "Página")
        selectedConversationId = ""
        messages = JSONArray()
        busy = true
        error = ""
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    JSONObject()
                        .put("posts_result", client.facebookPosts(pageId))
                        .put("conversations_result", client.facebookConversations(pageId))
                }
                posts = result.optJSONObject("posts_result")
                    ?.optJSONObject("posts")?.optJSONArray("data") ?: JSONArray()
                conversations = result.optJSONObject("conversations_result")
                    ?.optJSONObject("conversations")?.optJSONArray("data") ?: JSONArray()
            } catch (e: Exception) {
                error = e.message ?: "Não foi possível carregar os dados desta página."
            } finally {
                busy = false
            }
        }
    }

    fun refresh() {
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    val currentProfile = client.facebookProfile().optJSONObject("profile") ?: JSONObject()
                    val currentPermissions = client.facebookPermissions().optJSONArray("data") ?: JSONArray()
                    val currentPages = client.facebookPages().optJSONArray("pages") ?: JSONArray()
                    JSONObject()
                        .put("profile", currentProfile)
                        .put("permissions", currentPermissions)
                        .put("pages", currentPages)
                }
                profile = result.optJSONObject("profile") ?: JSONObject()
                permissions = result.optJSONArray("permissions") ?: JSONArray()
                pages = result.optJSONArray("pages") ?: JSONArray()
                posts = JSONArray()
                conversations = JSONArray()
                messages = JSONArray()
                selectedPageId = ""
                selectedConversationId = ""
                if (pages.length() > 0) {
                    loadPage(pages.getJSONObject(0))
                }
            } catch (e: Exception) {
                error = e.message ?: "Não foi possível consultar os dados do Facebook."
            } finally {
                busy = false
            }
        }
    }

    fun loadMessages(conversationId: String) {
        if (selectedPageId.isBlank() || conversationId.isBlank()) return
        selectedConversationId = conversationId
        busy = true
        error = ""
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    client.facebookMessages(selectedPageId, conversationId)
                }
                messages = result.optJSONObject("messages")?.optJSONArray("data") ?: JSONArray()
            } catch (e: Exception) {
                error = e.message ?: "Não foi possível carregar as mensagens desta conversa."
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) { refresh() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Facebook · Garcia", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(7.dp)
            ) {
                if (busy) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator()
                        Text("Consultando o Facebook…")
                    }
                }
                if (error.isNotBlank()) {
                    Text(error, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }

                Text(profile.optString("name").ifBlank { "Conta Facebook vinculada" }, fontWeight = FontWeight.Bold)
                Text("ID: ${profile.optString("id", "indisponível")}", fontSize = 11.sp)

                Divider()
                Text("Permissões concedidas", fontWeight = FontWeight.Bold)
                if (permissions.length() == 0) {
                    Text("Nenhuma permissão foi retornada pela Meta.", fontSize = 12.sp)
                } else {
                    for (index in 0 until permissions.length()) {
                        val item = permissions.optJSONObject(index) ?: continue
                        val permission = item.optString("permission")
                        val status = item.optString("status")
                        Text("• $permission — $status", fontSize = 12.sp)
                    }
                }

                Divider()
                Text("Páginas que você administra", fontWeight = FontWeight.Bold)
                if (pages.length() == 0) {
                    Text(
                        "Nenhuma página disponível. Verifique se a conta administra uma Página e se a Meta concedeu pages_show_list.",
                        fontSize = 12.sp
                    )
                } else {
                    for (index in 0 until pages.length()) {
                        val page = pages.optJSONObject(index) ?: continue
                        val pageId = page.optString("id")
                        val pageName = page.optString("name", "Página sem nome")
                        TextButton(
                            onClick = { loadPage(page) },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                (if (pageId == selectedPageId) "✓ " else "") + pageName,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }

                if (selectedPageId.isNotBlank()) {
                    Divider()
                    Text("Publicações de $selectedPageName", fontWeight = FontWeight.Bold)
                    if (posts.length() == 0) {
                        Text("Nenhuma publicação retornada ou permissão de leitura indisponível.", fontSize = 12.sp)
                    } else {
                        for (index in 0 until minOf(posts.length(), 10)) {
                            val post = posts.optJSONObject(index) ?: continue
                            val body = post.optString("message").ifBlank { "Publicação sem texto" }
                            Text(body, fontSize = 12.sp)
                            val date = post.optString("created_time")
                            if (date.isNotBlank()) Text(date, fontSize = 10.sp)
                            val link = post.optString("permalink_url")
                            if (link.isNotBlank()) Text(link, fontSize = 10.sp)
                            Divider()
                        }
                    }

                    Text("Conversas do Messenger", fontWeight = FontWeight.Bold)
                    if (conversations.length() == 0) {
                        Text("Nenhuma conversa retornada ou permissão pages_messaging indisponível.", fontSize = 12.sp)
                    } else {
                        for (index in 0 until minOf(conversations.length(), 25)) {
                            val conversation = conversations.optJSONObject(index) ?: continue
                            val id = conversation.optString("id")
                            val participants = conversation.optJSONObject("participants")?.optJSONArray("data")
                            val names = mutableListOf<String>()
                            if (participants != null) {
                                for (participantIndex in 0 until participants.length()) {
                                    val name = participants.optJSONObject(participantIndex)?.optString("name").orEmpty()
                                    if (name.isNotBlank()) names.add(name)
                                }
                            }
                            val label = names.joinToString(", ").ifBlank { "Conversa" }
                            TextButton(
                                onClick = { loadMessages(id) },
                                enabled = !busy && id.isNotBlank(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    (if (id == selectedConversationId) "✓ " else "") + label,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }
                    }
                }

                if (selectedConversationId.isNotBlank()) {
                    Divider()
                    Text("Mensagens", fontWeight = FontWeight.Bold)
                    if (messages.length() == 0) {
                        Text("Nenhuma mensagem retornada.", fontSize = 12.sp)
                    } else {
                        for (index in 0 until minOf(messages.length(), 30)) {
                            val message = messages.optJSONObject(index) ?: continue
                            val sender = message.optJSONObject("from")?.optString("name").orEmpty()
                                .ifBlank { "Participante" }
                            val body = message.optString("message").ifBlank { "(mensagem sem texto)" }
                            Text(sender, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                            Text(body, fontSize = 12.sp)
                            Text(message.optString("created_time"), fontSize = 10.sp)
                            Spacer(Modifier.height(3.dp))
                        }
                    }
                }
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
