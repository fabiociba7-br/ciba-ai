package com.ciba.garcia

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class CibaAiClient(private val store: SecureStore) {
    companion object {
        const val BASE_URL = "https://ciba-ai.fabiociba7.workers.dev"
        const val APP_ID = "com.ciba.garcia"
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS).build()

    private fun request(path: String, method: String, payload: JSONObject? = null, authenticated: Boolean = false): JSONObject {
        val builder = Request.Builder().url(BASE_URL + path).header("Accept", "application/json")
        if (authenticated) {
            val token = store.get("device_token") ?: error("Garcia ainda não está ativada neste dispositivo.")
            builder.header("Authorization", "Bearer $token")
        }
        when (method) {
            "POST" -> builder.post((payload ?: JSONObject()).toString().toRequestBody(JSON))
            "DELETE" -> builder.delete()
            else -> builder.get()
        }
        http.newCall(builder.build()).execute().use { response ->
            val body = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(body) }.getOrElse { JSONObject().put("error", "Resposta inválida do servidor") }
            if (!response.isSuccessful) {
                val serverError = json.optString("error", "Falha HTTP ${response.code}")
                val diagnosticId = json.optString("diagnostic_id")
                val graphError = json.optJSONObject("facebook_graph_error")
                val graphDetails = graphError?.let {
                    buildList {
                        val status = it.optInt("http_status", 0)
                        val code = it.opt("code")?.takeIf { value -> value !is org.json.JSONObject && value != JSONObject.NULL }
                        val subcode = it.opt("subcode")?.takeIf { value -> value !is org.json.JSONObject && value != JSONObject.NULL }
                        val type = it.optString("type").takeIf(String::isNotBlank)
                        if (status > 0) add("Meta HTTP $status")
                        if (code != null) add("código $code")
                        if (subcode != null) add("subcódigo $subcode")
                        if (type != null) add("tipo $type")
                    }.joinToString(" · ")
                }.orEmpty()
                error(
                    "HTTP ${response.code}: " + serverError +
                        if (graphDetails.isNotBlank()) " · $graphDetails"
                        else if (diagnosticId.isNotBlank()) " · diagnóstico $diagnosticId"
                        else ""
                )
            }
            return json
        }
    }

    fun status() = request("/v1/status", "GET")
    fun activate(registrationCode: String, pairingCode: String): JSONObject {
        val result = request("/v1/auth/register", "POST",
            JSONObject().put("app_id", APP_ID).put("invitation_code", registrationCode))
        val token = result.optString("access_token")
        if (token.isBlank()) error("O servidor não retornou o token do dispositivo.")
        store.put("device_token", token)
        try {
            request("/v1/owner/pair", "POST",
                JSONObject().put("pairing_invitation_code", pairingCode), authenticated = true)
        } catch (error: Exception) {
            store.remove("device_token")
            throw error
        }
        return result
    }

    fun chat(history: JSONArray, images: JSONArray = JSONArray()): JSONObject {
        val selected = mutableListOf<JSONObject>()
        var totalChars = 0
        val start = maxOf(0, history.length() - 12)
        for (i in history.length() - 1 downTo start) {
            val item = history.getJSONObject(i)
            val role = item.getString("role")
            val content = item.getString("content").replace(Regex("\\[\\[foto:[^\\]]*\\]\\]"), "").trim()
            if (content.isEmpty()) continue
            val perMessageLimit = if (role == "user") 1_500 else 3_000
            if (content.length > perMessageLimit || totalChars + content.length > 3_000) break
            selected.add(JSONObject().put("role", role).put("content", content))
            totalChars += content.length
        }
        val messages = JSONArray()
        selected.asReversed().forEach { messages.put(it) }
        if (messages.length() == 0) error("A conversa ultrapassa o limite de contexto permitido. Inicie uma nova conversa ou envie uma mensagem menor.")
        if (images.length() > 0) messages.getJSONObject(messages.length() - 1).put("images", images)
        val response = request("/v1/ai/chat", "POST", JSONObject().put("messages", messages), true)
        val text = response.optString("response").ifBlank { "A Garcia recebeu uma resposta vazia do serviço." }
        val photos = response.optJSONArray("photos")
        if (photos == null || photos.length() == 0) { response.put("response", text); return response }
        val markers = StringBuilder()
        for (i in 0 until photos.length()) {
            val url = photos.optJSONObject(i)?.optString("url").orEmpty()
            if (url.startsWith("https://")) markers.append("\n[[foto:").append(url).append("]]")
        }
        response.put("response", text + markers.toString())
        return response
    }

    fun facebookStatus(): JSONObject = request("/v1/owner/facebook", "GET", authenticated = true)

    fun linkFacebook(accessToken: String): JSONObject = request(
        "/v1/owner/facebook/link", "POST",
        JSONObject().put("access_token", accessToken), authenticated = true
    )

    fun facebookProfile(): JSONObject = request("/v1/owner/facebook/profile", "GET", authenticated = true)

    fun facebookPermissions(): JSONObject = request("/v1/owner/facebook/permissions", "GET", authenticated = true)

    fun facebookPosts(limit: Int = 25): JSONObject =
        request("/v1/owner/facebook/posts?limit=${limit.coerceIn(1, 50)}", "GET", authenticated = true)

    fun facebookPhotos(limit: Int = 25): JSONObject =
        request("/v1/owner/facebook/photos?limit=${limit.coerceIn(1, 50)}", "GET", authenticated = true)

    fun facebookVideos(limit: Int = 25): JSONObject =
        request("/v1/owner/facebook/videos?limit=${limit.coerceIn(1, 50)}", "GET", authenticated = true)

    fun facebookComments(postId: String, limit: Int = 25): JSONObject =
        request("/v1/owner/facebook/comments?post_id=${android.net.Uri.encode(postId)}&limit=${limit.coerceIn(1, 50)}", "GET", authenticated = true)

    fun facebookSummary(): JSONObject =
        request("/v1/owner/facebook/summary", "GET", authenticated = true)

    fun enqueueAgentJob(
        agentRole: String,
        prompt: String,
        idempotencyKey: String = UUID.randomUUID().toString(),
        priority: Int = 0,
    ): JSONObject {
        val allowedRoles = setOf("general", "reasoning", "research", "coding", "creative", "verification")
        require(agentRole in allowedRoles) { "Perfil de agente inválido." }
        require(prompt.isNotBlank() && prompt.length <= 12_000) { "A tarefa deve ter entre 1 e 12.000 caracteres." }
        require(idempotencyKey.isNotBlank() && idempotencyKey.length <= 128) { "Chave de idempotência inválida." }
        return request(
            "/v1/owner/agent-jobs",
            "POST",
            JSONObject()
                .put("agent_role", agentRole)
                .put("idempotency_key", idempotencyKey)
                .put("priority", priority.coerceIn(-10, 10))
                .put("payload", JSONObject().put("prompt", prompt)),
            authenticated = true,
        )
    }

    fun agentJobStatus(taskId: String): JSONObject {
        require(taskId.matches(Regex("[A-Za-z0-9_-]{16,128}"))) { "Identificador de tarefa inválido." }
        return request("/v1/owner/agent-jobs/$taskId", "GET", authenticated = true)
    }

    fun cancelAgentJob(taskId: String): JSONObject {
        require(taskId.matches(Regex("[A-Za-z0-9_-]{16,128}"))) { "Identificador de tarefa inválido." }
        return request("/v1/owner/agent-jobs/$taskId/cancel", "POST", authenticated = true)
    }


    fun composioSession(): JSONObject = request("/v1/owner/composio/session", "GET", authenticated = true)

    fun createComposioSession(toolkits: List<String>): JSONObject {
        val normalized = toolkits.map { it.trim().lowercase() }.filter(String::isNotBlank).distinct()
        require(normalized.isNotEmpty() && normalized.size <= 10) {
            "Informe de 1 a 10 integrações Composio."
        }
        require(normalized.all { it.matches(Regex("[a-z][a-z0-9_-]{0,63}")) }) {
            "Nome de integração inválido."
        }
        return request(
            "/v1/owner/composio/session", "POST",
            JSONObject().put("consent", true).put("toolkits", JSONArray(normalized)),
            authenticated = true,
        )
    }

    fun revokeComposioSession(): JSONObject =
        request("/v1/owner/composio/session", "DELETE", authenticated = true)

    fun composioTools(): JSONObject =
        request("/v1/owner/composio/tools", "GET", authenticated = true)

    fun composioPolicy(): JSONObject =
        request("/v1/owner/composio/policy", "GET", authenticated = true)

    fun saveComposioPolicy(toolNames: List<String>): JSONObject {
        require(toolNames.size <= 32 && toolNames.distinct().size == toolNames.size) {
            "Seleção de ferramentas inválida."
        }
        return request(
            "/v1/owner/composio/policy", "POST",
            JSONObject().put("consent", true).put("tools", JSONArray(toolNames)),
            authenticated = true,
        )
    }

    fun invokeComposio(
        action: String,
        toolName: String,
        conversationId: String,
        invocationId: String,
        input: JSONObject,
        approvalId: String? = null,
        allow: Boolean? = null,
    ): JSONObject {
        require(action in setOf("propose", "approve", "execute")) { "Ação Composio inválida." }
        require(toolName.matches(Regex("[A-Za-z][A-Za-z0-9_-]{0,63}"))) { "Ferramenta inválida." }
        require(conversationId.isNotBlank() && conversationId.length <= 128) { "Conversa inválida." }
        require(invocationId.isNotBlank() && invocationId.length <= 128) { "Invocação inválida." }
        val payload = JSONObject()
            .put("action", action)
            .put("tool_name", toolName)
            .put("conversation_id", conversationId)
            .put("invocation_id", invocationId)
            .put("input", input)
        if (approvalId != null) payload.put("approval_id", approvalId)
        if (allow != null) payload.put("allow", allow)
        return request("/v1/owner/composio/invoke", "POST", payload, authenticated = true)
    }

    fun usage(): JSONObject = request("/v1/usage", "GET", authenticated = true)
}
