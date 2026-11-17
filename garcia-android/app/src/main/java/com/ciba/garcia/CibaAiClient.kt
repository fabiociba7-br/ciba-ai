package com.ciba.garcia

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
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

    fun chat(history: JSONArray, images: JSONArray = JSONArray()): String {
        val selected = mutableListOf<JSONObject>()
        var totalChars = 0
        val start = maxOf(0, history.length() - 12)
        for (i in history.length() - 1 downTo start) {
            val item = history.getJSONObject(i)
            val role = item.getString("role")
            val content = item.getString("content")
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
        return response.optString("response").ifBlank { "A Garcia recebeu uma resposta vazia do serviço." }
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

    fun usage(): JSONObject = request("/v1/usage", "GET", authenticated = true)
}
