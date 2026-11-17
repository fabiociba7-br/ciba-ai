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
            if (!response.isSuccessful) error(json.optString("error", "Falha HTTP ${response.code}"))
            return json
        }
    }

    fun status() = request("/v1/status", "GET")
    fun activate(invitation: String): JSONObject {
        val result = request("/v1/auth/register", "POST",
            JSONObject().put("app_id", APP_ID).put("invitation_code", invitation))
        val token = result.optString("access_token")
        if (token.isBlank()) error("O servidor não retornou o token do dispositivo.")
        store.put("device_token", token)
        store.remove("activation_code")
        return result
    }

    fun chat(history: JSONArray): String {
        val messages = JSONArray()
        val start = maxOf(0, history.length() - 12)
        for (i in start until history.length()) {
            val item = history.getJSONObject(i)
            messages.put(JSONObject().put("role", item.getString("role")).put("content", item.getString("content")))
        }
        val response = request("/v1/ai/chat", "POST", JSONObject().put("messages", messages), true)
        return response.optString("response").ifBlank { "A Garcia recebeu uma resposta vazia do serviço." }
    }

    fun usage(): JSONObject = request("/v1/usage", "GET", authenticated = true)
}
