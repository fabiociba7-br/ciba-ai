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
