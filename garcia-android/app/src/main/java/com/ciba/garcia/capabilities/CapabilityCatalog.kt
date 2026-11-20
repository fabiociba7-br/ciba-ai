package com.ciba.garcia.capabilities

import org.json.JSONArray
import org.json.JSONObject

enum class CapabilityCategory { AI, EXECUTION, STORAGE, DEVELOPMENT, CUSTOM }
enum class CapabilitySupport { CONFIGURABLE, ADAPTER_REQUIRED, ASSISTED_ONLY, NOT_SUPPORTED }
enum class ConnectionStatus { CONFIGURED, DISABLED, NEEDS_ADAPTER }

data class CapabilityDefinition(val id: String, val name: String, val category: CapabilityCategory, val support: CapabilitySupport, val adapterId: String?, val description: String)
data class CapabilityConnection(val id: String, val name: String, val providerId: String, val endpoint: String, val enabled: Boolean = true, val status: ConnectionStatus = ConnectionStatus.CONFIGURED, val createdAtEpochMs: Long)

object CapabilityCatalog {
    val definitions = listOf(
        CapabilityDefinition("kaggle", "Kaggle", CapabilityCategory.EXECUTION, CapabilitySupport.ADAPTER_REQUIRED, "kaggle-api", "Notebooks e artefatos; integração operacional depende do adaptador."),
        CapabilityDefinition("colab", "Google Colab", CapabilityCategory.EXECUTION, CapabilitySupport.ASSISTED_ONLY, null, "Fluxo assistido; não há API pública estável para controlar todas as sessões."),
        CapabilityDefinition("http-api", "API HTTPS personalizada", CapabilityCategory.CUSTOM, CapabilitySupport.ADAPTER_REQUIRED, "http-json-v1", "Cadastro de endpoint; chamadas só serão habilitadas após adaptador e políticas."),
        CapabilityDefinition("s3", "Armazenamento compatível com S3", CapabilityCategory.STORAGE, CapabilitySupport.ADAPTER_REQUIRED, "s3-v1", "Destino de objetos; requer adaptador auditado."),
        CapabilityDefinition("webdav", "WebDAV", CapabilityCategory.STORAGE, CapabilitySupport.ADAPTER_REQUIRED, "webdav-v1", "Armazenamento remoto; requer adaptador auditado."),
        CapabilityDefinition("sftp", "SFTP / SSH", CapabilityCategory.STORAGE, CapabilitySupport.ADAPTER_REQUIRED, "sftp-v1", "Acesso remoto; requer biblioteca auditada e validação de fingerprint."),
        CapabilityDefinition("github", "GitHub", CapabilityCategory.DEVELOPMENT, CapabilitySupport.ADAPTER_REQUIRED, "github-api-v1", "Integração por API e OAuth; credenciais administrativas permanecem no servidor."),
        CapabilityDefinition("composio", "Composio", CapabilityCategory.DEVELOPMENT, CapabilitySupport.ADAPTER_REQUIRED, "composio-v1", "Integração mediada pelo backend; segredos não ficam no aparelho."),
        CapabilityDefinition("custom", "Outro serviço", CapabilityCategory.CUSTOM, CapabilitySupport.ADAPTER_REQUIRED, null, "Só pode usar capacidades e protocolos já aprovados.")
    )
    fun find(id: String): CapabilityDefinition? = definitions.firstOrNull { it.id == id }
}

object CapabilityConnectionValidator {
    private val idPattern = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")
    fun validate(connection: CapabilityConnection): String? {
        if (!idPattern.matches(connection.id)) return "Identificador de conexão inválido."
        if (connection.name.isBlank() || connection.name.length > 80) return "Informe um nome de até 80 caracteres."
        if (CapabilityCatalog.find(connection.providerId) == null) return "Provedor desconhecido."
        if (connection.endpoint.isNotBlank()) {
            val uri = runCatching { java.net.URI(connection.endpoint) }.getOrNull() ?: return "Endpoint inválido."
            if (uri.scheme != "https" || uri.host.isNullOrBlank()) return "O endpoint remoto deve usar HTTPS."
            if (uri.userInfo != null || uri.query != null || uri.fragment != null) return "Não inclua credenciais, parâmetros ou fragmentos na URL."
        }
        return null
    }
}

/** Versioned encrypted metadata storage. Secret values are deliberately excluded. */
class CapabilityConnectionRepository(private val secureStore: com.ciba.garcia.SecureStore) {
    companion object { private const val STORAGE_KEY = "capability_connections_v1" }
    fun list(): List<CapabilityConnection> {
        val json = runCatching { JSONArray(secureStore.get(STORAGE_KEY) ?: "[]") }.getOrDefault(JSONArray())
        return buildList {
            for (index in 0 until json.length()) {
                val item = json.optJSONObject(index) ?: continue
                runCatching {
                    add(CapabilityConnection(item.getString("id"), item.getString("name"), item.getString("providerId"), item.optString("endpoint"), item.optBoolean("enabled", true), ConnectionStatus.valueOf(item.optString("status", ConnectionStatus.CONFIGURED.name)), item.optLong("createdAtEpochMs")))
                }
            }
        }
    }
    fun save(connection: CapabilityConnection) {
        val issue = CapabilityConnectionValidator.validate(connection)
        require(issue == null) { issue ?: "Configuração inválida." }
        val current = list().filterNot { it.id == connection.id } + connection
        val json = JSONArray()
        current.forEach { item -> json.put(JSONObject().put("id", item.id).put("name", item.name).put("providerId", item.providerId).put("endpoint", item.endpoint).put("enabled", item.enabled).put("status", item.status.name).put("createdAtEpochMs", item.createdAtEpochMs)) }
        secureStore.put(STORAGE_KEY, json.toString())
    }
    fun setEnabled(id: String, enabled: Boolean) {
        val current = list().firstOrNull { it.id == id } ?: return
        save(current.copy(enabled = enabled, status = if (enabled) ConnectionStatus.NEEDS_ADAPTER else ConnectionStatus.DISABLED))
    }
    fun remove(id: String) {
        val json = JSONArray()
        list().filterNot { it.id == id }.forEach { item -> json.put(JSONObject().put("id", item.id).put("name", item.name).put("providerId", item.providerId).put("endpoint", item.endpoint).put("enabled", item.enabled).put("status", item.status.name).put("createdAtEpochMs", item.createdAtEpochMs)) }
        secureStore.put(STORAGE_KEY, json.toString())
    }
}
