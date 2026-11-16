# Cliente comum do Ciba AI

O módulo `src/client.ts` é um cliente TypeScript independente de framework para os aplicativos que usam a inteligência privada central.

## Uso básico

```ts
import { CibaClient } from "./src/client";

// O app deve buscar o token em armazenamento seguro da plataforma.
// Não grave tokens no código-fonte, em preferências comuns ou em logs.
const client = new CibaClient({
  baseUrl: "https://SEU-WORKER",
  getAccessToken: async () => secureStorage.get("ciba_device_token"),
});

const answer = await client.chat([
  { role: "user", content: "Olá, Garcia" },
]);

const inbox = await client.getInbox();
```

## Recursos disponíveis

- Diagnóstico: `getStatus()`, `getConfig()`, `getCapabilities()`.
- Primeiro vínculo: `registerDevice(appId, invitationCode)`, seguido de armazenamento seguro do token e `pairOwner(pairingInvitationCode)`.
- IA central: `chat(messages)`.
- Comunicação entre apps: `sendMessage()`, `getInbox()`, `acknowledgeMessages()`.
- Autorizações: `listAccessGrants()`, `createAccessGrant()`, `revokeAccessGrant()`.
- Configurações privadas: `getOwnerSettings()` e `updateOwnerSettings()` para ligar/desligar memória e comunicação entre apps.
- Memória curada: `listMemory()`, `saveMemory()` e `deleteMemory()`. Use `scope: "app"` para memória do app ou `scope: "owner"` para memória central; a memória de outro app exige `sourceAppId` e concessão ativa.

## Segurança e integração

- A biblioteca não salva nem mantém tokens em memória entre execuções; solicita o token ao app em cada chamada autenticada.
- Aplicativos Android devem fornecer token via Android Keystore/EncryptedSharedPreferences ou armazenamento seguro equivalente. iOS deve usar Keychain. Web deve usar estratégia de sessão segura apropriada; não embutir tokens em bundles.
- A URL remota deve usar HTTPS. HTTP é aceito somente para localhost em desenvolvimento.
- O cliente não recebe nem envia `owner_id`; o servidor deriva a identidade do dispositivo autenticado.
- O servidor continua responsável por permissões, pareamento, limites, expiração e revogação.
- A biblioteca não executa payloads recebidos; o app consumidor deve validar o schema de cada tarefa antes de agir.
- O cliente é TypeScript e pode ser empacotado pelos projetos Android/web/iOS que já usem TypeScript. Não há ainda SDK nativo Kotlin/Swift, pacote publicado ou integração automática nos aplicativos.

## Erros

Falhas HTTP geram `CibaApiError` com `status`, `code` e `details`. O aplicativo pode tratar, por exemplo, `401` (token ausente/inválido), `403` (permissão negada), `429` (limite) e `503` (serviço indisponível).

O cliente é uma camada reutilizável; a API remota ainda depende das migrations e do deploy pendentes para funcionar em produção.

## Memória curada

`saveMemory({ scope: "app", key: "style", value: "Respostas diretas", consent: "curated" })` grava uma entrada na memória do app autenticado. Para a memória central, use `scope: "owner"`; para outro app, informe `sourceAppId` e obtenha previamente as concessões `memory_read`/`memory_write` apropriadas. A API exige consentimento explícito em cada gravação e não salva histórico de chat.

## Configurações privadas do proprietário

`getOwnerSettings()` consulta as capacidades do proprietário autenticado. `updateOwnerSettings({ memory_enabled: true, app_messaging_enabled: false })` altera somente as opções fornecidas. Ambas começam desligadas. A autorização é verificada pelo Worker em cada operação, não apenas pelo SDK. A migration 0011 precisa estar aplicada no ambiente.


## Garcia owner dashboard

Use `getOwnerDashboard()` to retrieve the authenticated owner's consolidated dashboard data:

```ts
const dashboard = await client.getOwnerDashboard();
```

The endpoint is `GET /v1/owner/dashboard`. It requires a paired device token and returns the current AI mode/model status, owner feature flags, connected apps, safe device metadata, and access grants. It does not return credentials, token hashes, or conversation contents.

## Revogar dispositivo do proprietário

O método `revokeOwnerDevice(deviceId)` chama `POST /v1/owner/devices/revoke`. A operação exige um dispositivo pareado e revoga somente outro dispositivo pertencente ao mesmo proprietário. A sessão autenticada atual não pode revogar a si própria.
## Conectar um novo aplicativo pelo proprietário

O proprietário autenticado pode consultar `listAvailableApps()` e gerar convites com `createAppConnectionInvitation(appId)`. O servidor só permite aplicativos previamente cadastrados e habilitados em `app_registry`; o proprietário não pode cadastrar arbitrariamente um novo `app_id`.

O resultado contém dois códigos de uso único, exibidos uma única vez e válidos por 24 horas:

1. `registration_invitation_code`: o novo app chama `registerDevice(appId, registrationInvitationCode)` e recebe o token do dispositivo.
2. `pairing_invitation_code`: o novo app chama `pairOwner(pairingInvitationCode)` com o token recém-recebido, vinculando o dispositivo ao mesmo proprietário.

Os códigos são armazenados apenas como hashes. O app deve armazenar o token de dispositivo em armazenamento seguro da plataforma. A geração dos convites não instala o app nem executa sua configuração automaticamente.

## Centro de integração dos aplicativos Garcia

O contrato comum está documentado em [APP_INTEGRATION_CONTRACT.md](./APP_INTEGRATION_CONTRACT.md), versão `garcia-app@1.0.0`. O schema JSON do transporte fica em `schemas/app-message-v1.schema.json` e um exemplo TypeScript completo em `examples/garcia-integration.ts`. O SDK exporta `GARCIA_APP_CONTRACT_VERSION` para identificar a versão contratual incorporada.

Consulte o contrato antes de integrar um novo app. Ele descreve o vínculo por convites, armazenamento seguro do token, chat, mensagens, permissões, tratamento de erros e limites. O exemplo também é incluído no typecheck do CI.


## Identidade e reconhecimento do aplicativo

`getAppIdentity()` chama `GET /v1/apps/identity`. O Worker deriva o aplicativo e o dispositivo do token autenticado e retorna o perfil cadastrado, versão do contrato e outros aplicativos habilitados com dispositivos ativos vinculados ao mesmo proprietário. As capacidades listadas são declarativas: não habilitam execução de ações e não substituem concessões de acesso.


A resposta tipada `CibaAppIdentity` inclui o perfil do app autenticado, capacidades declaradas, tipos de tarefa declarados e os apps ativos vinculados ao mesmo proprietário.


## Resultados de tarefas

- `submitTaskResult({ taskId, clientMessageId, result, status? })`: devolve o resultado ao aplicativo que originou a tarefa. Status aceitos: `completed`, `failed`, `partial`.
- `getTaskResults(taskId)`: consulta os resultados correlacionados que ainda estão disponíveis para o app autenticado.
- `acknowledgeMessages([messageId])`: confirma o processamento depois que o aplicativo consumir o resultado.

O destino só pode responder a uma solicitação ativa originalmente encaminhada a ele. A resposta exige concessões direcionais inversas no escopo `task`; a consulta exige autenticação do proprietário pareado. O SDK não persiste resultados nem executa a consolidação semântica por conta própria.


## Execução padronizada no aplicativo destinatário (etapa 38)

O SDK oferece `executeTaskMessage(message, processor)` para conectar a validação do inbox ao processador que pertence ao próprio aplicativo. O método valida o escopo e o envelope, confirma que o `task_id` do payload corresponde ao identificador do registro da fila, chama o callback local e envia um resultado correlacionado por `submitTaskResult()`. Só depois da aceitação do resultado pelo servidor a mensagem é confirmada com `acknowledgeMessages()`.

O callback recebe a estrutura validada e o contexto continua marcado como dado não confiável. O aplicativo decide quais recursos internos usar; o SDK não interpreta texto recebido como comandos, não executa shell, não chama ferramentas arbitrárias e não concede permissões. Erros do callback são devolvidos como resultado `failed` com mensagem limitada a 300 caracteres. Se o envio do resultado falhar, a mensagem não é confirmada, permitindo nova tentativa; o identificador idempotente do resultado é derivado da tarefa e da mensagem.

Exemplo:

```ts
const inbox = await client.getInbox();
for (const message of inbox.messages) {
  if (message.scope !== "task") continue;
  await client.executeTaskMessage(message, async ({ task, context }) => {
    // Implementação específica do app; validar os dados antes de usar.
    return await meuProcessadorLocal(task, context);
  });
}
```

O SDK fornece o ciclo de integração, não um executor universal: cada aplicativo conectado precisa implementar `meuProcessadorLocal` e decidir como tratar cada tipo de tarefa.

### Registro local de processadores (etapa 39)

Para impedir que um aplicativo aceite uma tarefa só porque ela aparece no cadastro central, o SDK também oferece `CibaTaskProcessorRegistry`, `getRegisteredTaskTypes(registry)` e `executeRegisteredTaskMessage(message, registry)`. O registro local contém somente callbacks realmente implementados pelo app. O método recusa tipos sem callback antes de executar, enviar resultado ou confirmar a mensagem; portanto, a tarefa permanece disponível para tratamento explícito ou nova tentativa.

```ts
const processors = {
  summarize: async ({ task, context }) => {
    // Implementação real e específica deste app.
    return resumirDocumentoLocal(task.instruction, context.items);
  },
};

const supported = getRegisteredTaskTypes(processors); // ["summarize"]
for (const message of inbox.messages) {
  if (message.scope === "task") {
    await client.executeRegisteredTaskMessage(message, processors);
  }
}
```

A lista local é a fonte do que o código desta versão consegue executar. O cadastro administrativo `task_types` deve ser mantido alinhado manualmente com essa lista; a declaração central, sozinha, não prova que exista um processador. Esta etapa não integra nem altera repositórios de outros aplicativos e não habilita execução automática no servidor.

## Acompanhamento do ciclo de vida das tarefas (etapa 37)

`getTaskStatus(taskId)` consulta `GET /v1/apps/tasks/status?task_id=...`. O endpoint só retorna tarefas originadas pelo aplicativo autenticado e exige proprietário pareado, mensagens habilitadas e concessões direcionais de tarefa ainda válidas.

Os estados são `awaiting_delivery` (ainda não confirmada no inbox), `processing` (recebida, sem resposta), `completed`, `partial`, `failed` ou `expired`. A confirmação do inbox indica recebimento, não execução. O status de conclusão só muda quando o app destinatário envia um resultado correlacionado por `submitTaskResult()`. A consulta não executa, reenvia ou altera tarefas; utiliza os registros já existentes na fila e não requer nova tabela ou migration.

## Consolidação dos resultados de tarefas

getTaskResults(taskId) continua retornando os resultados individuais e agora inclui consolidation, com status, contagens, fontes, consenso estrutural e indicação de divergência. O campo consensus_result só é preenchido quando existe uma única saída utilizável ou quando todas as saídas utilizáveis são estruturalmente idênticas. Em divergência, é null; o SDK não escolhe nem combina respostas por conta própria.


## Síntese semântica de resultados de tarefas

O método `synthesizeTaskResults(taskId)` chama `POST /v1/apps/tasks/synthesize`. O Worker autentica o dispositivo, exige proprietário ativo, comunicação entre apps habilitada e concessões vigentes para as respostas. Só então envia até 20 resultados concluídos/parciais para uma chamada de inferência no modelo aprovado para custo zero.

A síntese é separada da comparação estrutural já incluída em `getTaskResults()`. Ela identifica convergências, divergências e incertezas, preservando os IDs dos apps que forneceram evidências. Conteúdo recebido é tratado como dado não confiável e nunca como instrução executável. A entrada é limitada a 12.000 caracteres e a saída a 384 tokens. A chamada consome os limites diários e por minuto do dispositivo; não é executada automaticamente.


## Recuperação contextual da memória

Use `retrieveMemory(query, limit?)` para localizar itens curados relevantes sem listar toda a memória. O endpoint `POST /v1/owner/memory/retrieve` faz uma busca lexical determinística, retorna até 20 registros ordenados por correspondência e não chama nenhum modelo (`inference_calls: 0`).

O servidor autentica o dispositivo, exige proprietário ativo e memória habilitada. A memória do próprio app pode ser pesquisada diretamente; memória do proprietário e de outros apps só entra nos resultados com uma concessão vigente de `memory_read` para o escopo correspondente. Itens expirados ou excluídos são ignorados. A busca não cria, altera ou exclui memórias e não armazena a consulta.


## Memória contextual no chat

Quando `memory_enabled` estiver ligado para um proprietário ativo e pareado, `chat(messages)` utiliza automaticamente a última mensagem do usuário para localizar até cinco memórias curadas relevantes. O app autenticado só recebe sua própria memória; itens de outros apps ou do proprietário exigem concessão ativa de leitura. A busca é lexical, não faz inferência adicional e limita os itens a 1.800 caracteres. O conteúdo é tratado como dado não confiável. Sem pareamento, sem habilitação ou sem correspondências, a chamada segue normalmente sem contexto de memória. O chat não salva mensagens nem cria memórias automaticamente.


## Propostas de memória com confirmação

`prepareMemoryCandidate({ sourceText, key, value, scope })` envia um trecho de texto atribuído ao usuário e uma proposta de chave/valor. A resposta é somente uma prévia, com `requires_confirmation: true`, `persisted: false` e `stored: false`. O app deve exibir a proposta e aguardar confirmação explícita. Depois da confirmação, use `saveMemory({ scope, key, value, consent: "curated" })`. Não chame `saveMemory` automaticamente após preparar uma proposta. O endpoint exige que o valor seja um trecho do texto do usuário, não aceita texto atribuído ao assistente e não persiste o texto de origem nem chama IA. Para escopo do proprietário, a permissão `memory_write` precisa estar ativa.


## Gerenciar memórias

- `listMemory(scope, sourceAppId?, { search?, includeExpired? })` lista até 200 registros do escopo autorizado, com filtro textual e opção de incluir expirados.
- `updateMemory({ memoryId, scope, key, value, sourceAppId?, validHours? })` edita chave/conteúdo e, opcionalmente, validade. `validHours: null` remove a expiração; omitir mantém a validade atual; de 1 a 8760 define uma nova validade.
- `deleteMemory(memoryId, scope, sourceAppId?)` realiza exclusão lógica. O registro deixa de ser retornado e de participar da recuperação.

A memória central e a memória de outro app continuam exigindo concessão ativa apropriada. A API autentica o proprietário pelo dispositivo pareado, não por um owner ID enviado pelo cliente.


## Revisão de aprendizado da memória

- `proposeMemoryReview({ sourceText, key, value, scope?, validHours? })` cria uma proposta pendente baseada em evidência literal; não grava memória.
- `listMemoryReviews(scope?)` lista propostas aguardando decisão do proprietário.
- `decideMemoryReview(proposalId, "approve" | "reject", scope?)` aplica a decisão explícita. A aprovação pode criar um registro ou atualizar um valor em conflito; rejeitar não altera a memória.

A classificação `new`, `unchanged` ou `possible_conflict` é determinística e não substitui a avaliação humana. A API não verifica por conta própria se o texto atribuído ao usuário foi realmente escrito por ele.


## Análise de relações entre memórias

`getMemoryInsights()` consulta `GET /v1/owner/memory/insights` e retorna possíveis conflitos, conteúdos lexicalmente relacionados e registros expirados/antigos. A API inclui somente memórias próprias e escopos de outros apps/centrais com concessão ativa de leitura. A análise é determinística, limitada a 200 registros e não modifica dados nem chama IA.


## Histórico de memória

`getMemoryHistory({ scope, sourceAppId, memoryId, limit })` consulta `GET /v1/owner/memory/history`. Retorna metadados de criação, edição, exclusão e decisões de revisão, sem valores armazenados ou conteúdo de conversas. O limite é de 1 a 100 eventos; por padrão, 50. O acesso segue as concessões de leitura da memória.


## Perfil contextual do proprietário

`getOwnerProfile()` consulta `GET /v1/owner/profile` e retorna memórias autorizadas agrupadas por assunto, termos recorrentes entre registros distintos e sugestões de revisão. A análise é determinística, limitada a 200 memórias e não chama IA nem altera dados. Memórias de outros aplicativos e a memória central exigem concessões ativas de leitura. Sugestões não são aplicadas automaticamente; o proprietário decide se deve revisar ou atualizar qualquer registro.


## Perfil contextual aplicado ao chat

O chat normal usa o perfil de comunicação presente nas memórias curadas autorizadas para orientar o estilo da resposta, mesmo quando a pergunta atual é sobre outro assunto. As demais memórias continuam sujeitas à recuperação lexical por relevância. A seleção é limitada a cinco registros e 1.800 caracteres; nenhuma chamada de inferência adicional é feita. O campo `intelligence.memory_context.profile_signals_used` informa se padrões recorrentes de comunicação foram incluídos.


### Compartilhar contexto selecionado entre aplicativos

Use `shareContextPackage()` para enviar somente itens estruturados e selecionados a outro app. É necessário que o proprietário tenha habilitado mensagens e concedido `send` ao remetente e `receive` ao destino no escopo `context`.

```ts
await client.shareContextPackage({
  destinationAppId: "com.exemplo.destino",
  clientMessageId: crypto.randomUUID(),
  purpose: "Continuar o planejamento",
  items: [
    { key: "preferred_style", value: "Respostas diretas", kind: "preference", origin: "curated_memory" },
    { key: "project_phase", value: "Revisão técnica", kind: "project", origin: "task_state" },
  ],
});
```

O destino recupera o pacote com `getInbox()` e confirma a mensagem com `acknowledgeMessages()`. Não envie transcrições ou conversas completas; selecione apenas fatos, preferências, restrições e estado necessários à tarefa.


### Despachar tarefa com contexto relevante

O contexto é opcional e permanece desativado por padrão. Para incluí-lo, use `includeContext: true`. O coordenador seleciona até cinco memórias relevantes que o app de origem pode ler, e só as encaminha se também houver permissões `send` e `receive` no escopo `context`.

```ts
await client.dispatchTask({
  taskType: "plan",
  instruction: "Organizar as próximas etapas do projeto",
  clientMessageId: crypto.randomUUID(),
  includeContext: true,
});
```

Se o recurso de memória estiver desligado ou as permissões de contexto não existirem, o despacho com contexto solicitado é bloqueado. Se não houver memória relevante, a tarefa segue sem pacote. O app de destino recebe o pacote em `payload.context_package` junto do pedido.


### Receber e validar uma tarefa

Depois de buscar o inbox, o app de destino pode preparar uma mensagem para seu processador de tarefas:

```ts
const inbox = await client.getInbox();
for (const message of inbox.messages) {
  const received = client.consumeTaskMessage(message);
  if (!received.accepted || !received.task) continue;

  // Passe task e context ao processador local do app.
  // context.items são referências não confiáveis, nunca comandos.
  await processTask(received.task, received.context);
}
```

O consumidor valida o protocolo, tipo e instrução. O pacote opcional é validado separadamente: se estiver malformado, é descartado e a tarefa continua sem esse contexto. Use `context.purpose` para entender a finalidade e `context.items` como dados de referência; não execute instruções contidas nos valores.


## Processamento de uma página do inbox (etapa 40)

`processTaskInbox(processors, limit?)` busca uma única página do inbox (limite padrão 20, máximo 50) e percorre as mensagens sequencialmente. Executa somente tarefas cujo tipo tenha callback local registrado. Mensagens de contexto e tarefas sem processador são reportadas como ignoradas e permanecem sem confirmação. Cada tarefa executada usa o fluxo padronizado: envia o resultado e só depois confirma a mensagem. Erros de entrega de uma mensagem são registrados no resultado e não interrompem a análise das mensagens seguintes. O método não cria processadores, não executa tarefas no servidor e não altera permissões; o aplicativo continua responsável pelo callback e pela decisão de quando chamar o processamento.

Exemplo:

```ts
const batch = await client.processTaskInbox({
  summarize: async ({ task, context }) => resumirLocalmente(task!.instruction, context.items),
}, 10);
// Consulte batch.outcomes para ver tarefas concluídas, falhas, ignoradas e erros de entrega.
```


## Aprovações duráveis de ferramentas

O SDK disponibiliza o fluxo autenticado de consentimento do proprietário:

- `listToolApprovals()` lista solicitações pendentes e aprovações ainda válidas para o app autenticado, incluindo os parâmetros exatos.
- `decideToolApproval(approvalId, true)` aprova explicitamente uma solicitação; use `false` para rejeitar.
- `cancelToolApproval(approvalId)` cancela uma solicitação elegível.

A aprovação registra consentimento de uso único; **não executa a ferramenta**. A execução só poderá ocorrer quando um runtime futuro consumir a autorização vinculada à identidade, invocação e entrada originais. O SDK não interpreta nem executa os parâmetros recebidos. Exiba os parâmetros sem alterações e peça confirmação explícita ao proprietário antes de chamar `decideToolApproval`. O token continua sendo fornecido sob demanda por `getAccessToken` e deve permanecer no armazenamento seguro da plataforma.
