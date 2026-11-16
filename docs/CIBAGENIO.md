# CibaGenio — controle central de recursos

O CibaGenio é o mecanismo administrativo da Garcia para registrar o bloqueio ou a liberação de recursos.

## Comando administrativo

O endpoint `/v1/admin/cibagenio` aceita:

- `GET`: lista o catálogo permitido, os controles atuais e as 50 alterações mais recentes.
- `POST`: bloqueia ou libera um recurso.

Todas as chamadas exigem `Authorization: Bearer <ADMIN_TOKEN>`. O token permanece somente no servidor/ambiente administrativo; não deve ser incluído em aplicativos, prompts, documentação pública ou código-fonte.

Exemplo de liberação global:

```json
{
  "resource_id": "chat",
  "enabled": true,
  "reason": "Liberação aprovada"
}
```

Exemplo de bloqueio para um aplicativo:

```json
{
  "resource_id": "chat",
  "enabled": false,
  "scope": "app",
  "app_id": "com.exemplo.app",
  "reason": "Bloqueio temporário"
}
```

O escopo `app` substitui o estado global somente para aquele aplicativo. Sem uma configuração específica do app, vale a configuração global. Recurso sem configuração permanece bloqueado. IDs fora do catálogo são recusados.

## Catálogo inicial

- `chat`
- `persistent_memory`
- `app_messaging`
- `task_dispatch`
- `context_sharing`
- `multi_model_ensemble`
- `external_tools`

## Persistência e auditoria

A migration `0015_cibagenio_resource_controls.sql` cria as tabelas `cibagenio_controls` e `cibagenio_audit_events`. Cada alteração grava recurso, escopo, estado, justificativa, ator administrativo e horário. A API não expõe o token administrativo nem aceita comandos arbitrários.

## Recursos já protegidos pelo verificador

As rotas do servidor agora consultam o controle CibaGenio depois de autenticar o dispositivo e antes de executar a operação:

- `chat`: chat principal.
- `persistent_memory`: leitura, gravação, revisão, histórico, perfil e recuperação de memória.
- `app_messaging`: envio, inbox e confirmação de mensagens entre aplicativos.
- `task_dispatch`: distribuição, consulta e entrega de resultados de tarefas.
- `context_sharing`: compartilhamento de pacotes de contexto.

Quando o recurso está bloqueado ou não tem configuração, a API responde HTTP 403 com `resource_locked_by_cibagenio`. Um controle específico do aplicativo prevalece sobre o controle global. O bloqueio é aplicado no servidor, portanto não depende de o aplicativo obedecer a uma tela ou instrução.

## Limites desta etapa

A implementação protege as rotas centrais listadas acima. O catálogo de colaboração entre modelos e ferramentas externas ainda não representa execução ativa dessas capacidades; elas precisarão ser integradas quando existirem fluxos reais correspondentes. A migration ainda não foi aplicada em banco remoto e não houve deploy.

O objetivo é que o CibaGenio seja a autoridade central de autorização no servidor, nunca uma instrução textual enviada pelo aplicativo ou pelo modelo de IA.
