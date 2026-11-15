# Gerenciamento privado de permissões entre aplicativos

O gerenciamento é feito por um dispositivo já pareado ao proprietário. O gateway deriva o proprietário do token de dispositivo autenticado; não aceita `owner_id` enviado no corpo. Dispositivos não pareados, revogados ou vinculados a proprietário revogado não conseguem gerenciar concessões.

Todas as rotas abaixo usam `Authorization: Bearer <device_access_token>`.

## Listar concessões

`GET /v1/owner/access-grants`

Retorna até 200 concessões do proprietário autenticado, incluindo registros revogados e expirados para auditoria.

## Criar uma concessão

`POST /v1/owner/access-grants`

Exemplo de permissão de envio de tarefa de um app para outro:

```json
{
  "grantee_app_id": "com.ciba.origem",
  "source_app_id": "com.ciba.origem",
  "destination_app_id": "com.ciba.destino",
  "permission": "send",
  "scope": "task",
  "valid_hours": 720
}
```

Para o destino receber, criar uma concessão separada com `permission: "receive"` e `grantee_app_id` igual ao aplicativo de destino. Para contexto, usar `scope: "context"`.

Para memória de aplicativo, usar `permission: "memory_read"` ou `"memory_write"`, `scope: "app_memory"`, `source_app_id` com o aplicativo cuja memória será compartilhada e omitir `destination_app_id`. O `grantee_app_id` identifica o aplicativo autorizado.

Para memória central do proprietário, usar `scope: "owner_memory"` e omitir origem e destino.

A validade é obrigatória no servidor: se omitida, assume 720 horas; o intervalo permitido é de 1 a 8.760 horas. O servidor verifica que todos os aplicativos envolvidos estão habilitados no registro de apps.

## Revogar uma concessão

`POST /v1/owner/access-grants/revoke`

```json
{ "grant_id": "id-da-concessao" }
```

A revogação só afeta uma concessão pertencente ao proprietário autenticado. Repetir a revogação não altera o registro e retorna não encontrado/já revogado.

## Limites atuais

- As rotas e o armazenamento entram em vigor somente depois de aplicar as migrations 0007 e 0008 e publicar o Worker; isso ainda não foi feito.
- Não há interface visual de gerenciamento nesta etapa; os endpoints são a API para uma futura tela de configurações.
- O relay privado está implementado no código e exige concessões ativas de envio e recebimento. A migration 0009 ainda precisa ser aplicada e o Worker publicado antes de qualquer troca de mensagens em produção. A memória persistente continua desativada.
- O proprietário pode administrar as permissões a partir de qualquer dispositivo ativo que esteja pareado à sua identidade privada.


## Relay de mensagens

A API de relay foi adicionada em `docs/APP_MESSAGE_RELAY.md`. O envio exige as concessões `send` e `receive` para o mesmo par de apps e escopo. A leitura revalida as permissões, e a confirmação só afeta mensagens destinadas ao app autenticado. A migration 0009 e o deploy ainda estão pendentes.
