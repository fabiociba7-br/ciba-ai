package com.ciba.garcia

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ciba.garcia.capabilities.*
import java.util.UUID

@Composable
fun ConnectionsSettingsScreen(store: SecureStore) {
    val repository = remember(store) { CapabilityConnectionRepository(store) }
    var connections by remember { mutableStateOf(repository.list()) }
    var selectedProvider by remember { mutableStateOf(CapabilityCatalog.definitions.first().id) }
    var connectionName by remember { mutableStateOf("") }
    var endpoint by remember { mutableStateOf("") }
    var validationError by remember { mutableStateOf("") }
    var showProviders by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Central de capacidades", style = MaterialTheme.typography.titleMedium)
        Text("Cadastre contas e endpoints compatíveis. O cadastro não ativa uma integração: cada serviço só executa operações depois que seu adaptador for implementado, validado e habilitado.", style = MaterialTheme.typography.bodySmall)
        Text("Catálogo de provedores", style = MaterialTheme.typography.titleSmall)
        CapabilityCatalog.definitions.forEach { definition ->
            ListItem(headlineContent = { Text(definition.name) }, supportingContent = {
                Text("${supportLabel(definition.support)} · ${definition.description}", style = MaterialTheme.typography.bodySmall)
            })
        }
        HorizontalDivider()
        Text("Adicionar conexão", style = MaterialTheme.typography.titleSmall)
        Box {
            OutlinedButton(onClick = { showProviders = true }, modifier = Modifier.fillMaxWidth()) {
                Text(CapabilityCatalog.find(selectedProvider)?.name ?: "Selecionar provedor")
            }
            DropdownMenu(expanded = showProviders, onDismissRequest = { showProviders = false }) {
                CapabilityCatalog.definitions.forEach { definition ->
                    DropdownMenuItem(text = { Text(definition.name) }, onClick = { selectedProvider = definition.id; showProviders = false })
                }
            }
        }
        OutlinedTextField(value = connectionName, onValueChange = { connectionName = it.take(80) }, modifier = Modifier.fillMaxWidth(), label = { Text("Nome da conexão") }, singleLine = true)
        OutlinedTextField(value = endpoint, onValueChange = { endpoint = it.take(500) }, modifier = Modifier.fillMaxWidth(), label = { Text("Endpoint HTTPS (opcional)") }, singleLine = true)
        Text("Não informe chaves, tokens ou senhas neste formulário. Segredos administrativos devem ser cadastrados no backend autenticado; esta versão guarda somente metadados locais criptografados.", style = MaterialTheme.typography.bodySmall)
        Button(onClick = {
            val definition = CapabilityCatalog.find(selectedProvider)
            val item = CapabilityConnection(
                id = UUID.randomUUID().toString(), name = connectionName.trim(),
                providerId = selectedProvider, endpoint = endpoint.trim(),
                status = if (definition?.support == CapabilitySupport.CONFIGURABLE) ConnectionStatus.CONFIGURED else ConnectionStatus.NEEDS_ADAPTER,
                createdAtEpochMs = System.currentTimeMillis()
            )
            val issue = CapabilityConnectionValidator.validate(item)
            if (issue != null) validationError = issue else {
                repository.save(item); connections = repository.list()
                connectionName = ""; endpoint = ""; validationError = ""
            }
        }, enabled = connectionName.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Salvar conexão") }
        if (validationError.isNotBlank()) Text(validationError, color = MaterialTheme.colorScheme.error)
        HorizontalDivider()
        Text("Conexões cadastradas (${connections.size})", style = MaterialTheme.typography.titleSmall)
        if (connections.isEmpty()) Text("Nenhuma conexão cadastrada.", style = MaterialTheme.typography.bodySmall)
        LazyColumn(Modifier.heightIn(max = 240.dp)) {
            items(connections, key = { it.id }) { connection ->
                val definition = CapabilityCatalog.find(connection.providerId)
                ListItem(
                    headlineContent = { Text(connection.name) },
                    supportingContent = { Text("${definition?.name ?: connection.providerId} · ${if (connection.enabled) "Ativa no catálogo" else "Desativada"} · ${if (connection.status == ConnectionStatus.NEEDS_ADAPTER) "adaptador pendente" else "metadados locais"}", style = MaterialTheme.typography.bodySmall) },
                    trailingContent = {
                        Row {
                            Switch(checked = connection.enabled, onCheckedChange = { repository.setEnabled(connection.id, it); connections = repository.list() })
                            TextButton(onClick = { repository.remove(connection.id); connections = repository.list() }) { Text("Remover") }
                        }
                    }
                )
                HorizontalDivider()
            }
        }
    }
}

private fun supportLabel(support: CapabilitySupport): String = when (support) {
    CapabilitySupport.CONFIGURABLE -> "Configurável"
    CapabilitySupport.ADAPTER_REQUIRED -> "Requer adaptador"
    CapabilitySupport.ASSISTED_ONLY -> "Fluxo assistido"
    CapabilitySupport.NOT_SUPPORTED -> "Não suportado"
}
