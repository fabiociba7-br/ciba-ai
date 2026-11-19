# Garcia MCP

A Garcia expõe um endpoint MCP (Model Context Protocol) HTTP sem estado:

`POST https://ciba-ai.fabiociba7.workers.dev/v1/mcp`

## Autenticação e autorização

- Envie o token do dispositivo Garcia no cabeçalho `Authorization: Bearer <token>`.
- O endpoint aceita somente o aplicativo privado `com.ciba.garcia`, com proprietário ativo.
- O controle CibaGênio `external_tools` precisa estar habilitado para a Garcia.
- O transporte não cria sessão persistente nem armazena prompts ou resultados.
- A lista MCP contém apenas ferramentas classificadas como leitura e sem aprovação obrigatória.
- Cada chamada passa novamente pelo registro de ferramentas e pelo autorizador do servidor.
- Ferramentas de escrita ou externas não são listadas nem executadas por este endpoint. O endpoint não concede permissões nem substitui aprovações.

## Métodos disponíveis

- `initialize`: negocia a versão do protocolo e anuncia a capacidade `tools`.
- `notifications/initialized`: confirmação sem resposta (HTTP 202).
- `ping`: verificação de disponibilidade.
- `tools/list`: lista ferramentas de leitura autorizadas.
- `tools/call`: valida o schema e executa uma ferramenta de leitura autorizada.

O transporte aceita JSON-RPC 2.0 por POST com `Content-Type: application/json`. Corpos acima de 32 KB são rejeitados. GET/SSE, resources, prompts, amostragem e notificações de alteração da lista não estão implementados nesta primeira versão.

## Exemplo de inicialização

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "mcp-client", "version": "1.0.0" }
  }
}
```

## Escopo inicial

A primeira versão expõe metadados do catálogo de capacidades nativas da Garcia e o estado do vínculo do Facebook. Consultar uma capacidade não instala modelos, baixa pesos, inicia serviços nem altera configurações. Integrações adicionais devem entrar pelo registro de ferramentas, com schemas estritos, allowlist, classificação de risco, autorização do proprietário e aprovação de uso único quando necessária.
