# Relay privado de mensagens entre aplicativos

O relay usa uma fila D1 privada e exige um dispositivo autenticado e pareado a um proprietário ativo.

## Enviar uma mensagem

`POST /v1/apps/messages`

Headers: `Authorization: Bearer <device_access_token>`

```json
{
  "destination_app_id": "com.ciba.destino",
  "client_message_id": "id-unico-gerado-pelo-app",
  "task_id": "tarefa-123",
  "scope": "task",
  "payload": { "action": "processar", "input": "dados da tarefa" },
  "ttl_hours": 24
}
```

O aplicativo de origem é sempre derivado do token autenticado. O proprietário não pode ser informado pelo cliente. O servidor exige duas concessões ativas e exatas para o mesmo proprietário, par de apps e escopo: `send` para a origem e `receive` para o destino. O destino precisa estar habilitado.

O `client_message_id` funciona como chave de idempotência por proprietário e origem. Repetir o mesmo identificador não cria uma segunda mensagem. O payload deve ser um objeto JSON de até 8.000 caracteres. A validade padrão é 24 horas, com máximo de 72 horas. Cada proprietário pode manter até 100 mensagens pendentes por app de destino.

## Consultar a caixa de entrada

`GET /v1/apps/messages/inbox?limit=20`

O token determina o proprietário e o app de destino. A consulta retorna no máximo 50 mensagens, somente da caixa daquele app e daquele proprietário. O servidor revalida as duas concessões a cada leitura; concessões revogadas ou expiradas bloqueiam a entrega.

A consulta não remove mensagens. O app deve confirmar o recebimento depois de processá-las.

## Confirmar recebimento

`POST /v1/apps/messages/ack`

```json
{ "message_ids": ["id-da-mensagem"] }
```

Aceita até 50 IDs por chamada. Só confirma mensagens pertencentes ao proprietário autenticado e destinadas ao app autenticado. Mensagens expiradas e mensagens confirmadas há mais de sete dias são removidas pela rotina de limpeza.

## Limites e estado de ativação

- A fila não executa payloads, comandos, código ou ferramentas. Ela apenas transporta dados JSON.
- Não existe acesso automático: origem e destino precisam de concessões explícitas, compatíveis e válidas.
- Mensagens não são incluídas no histórico do chat e não armazenam conversas completas por padrão.
- A migration `0009_private_app_message_queue.sql` ainda precisa ser aplicada ao D1 e o Worker ainda precisa ser publicado. Até lá, o relay não está ativo em produção.

## Validação defensiva das concessões

O núcleo TypeScript cria snapshots próprios das solicitações e das concessões antes de decidir o relay. Objetos com protótipos personalizados, getters/setters, propriedades inesperadas ou não enumeráveis são rejeitados. Arrays de permissões, escopos e concessões precisam ser densos, sem índices ausentes ou propriedades extras. Cada concessão é normalizada e validada isoladamente; concessões inválidas nunca autorizam uma operação. Qualquer falha inesperada na avaliação resulta em `false` (negação). Essa validação estrutural não substitui a autenticação do dispositivo nem a consulta das concessões persistidas pelo gateway.
