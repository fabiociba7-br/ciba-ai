# Contrato de integração dos aplicativos Garcia

**Contrato:** garcia-app  
**Versão:** 1.0.0  
**Estado:** contrato documental alinhado às rotas implementadas no Worker. Não significa que o serviço esteja publicado.

Este documento é a referência comum para qualquer aplicativo autorizado a usar Garcia. O aplicativo mantém sua interface e seus dados locais; Garcia fornece identidade autenticada do dispositivo, inteligência central e, quando habilitada e autorizada, memória curada e transporte de mensagens entre aplicativos.

## 1. Regras fundamentais

1. Cada aplicativo usa seu próprio app_id estável (no Android, o applicationId real).
2. O app só pode se conectar se estiver previamente cadastrado e habilitado pelo administrador.
3. O proprietário gera no painel dois convites de uso único: registro e pareamento. Ambos expiram em 24 horas.
4. O token de dispositivo é segredo. Armazene-o no armazenamento seguro da plataforma; nunca em código-fonte, logs, analytics, notificações ou preferências sem proteção.
5. O servidor deriva owner_id e app_id do token autenticado. O cliente nunca escolhe nem envia esses identificadores como prova de identidade.
6. Cada app tem seu próprio token e identidade. Não compartilhe um token de dispositivo entre aplicativos.
7. O proprietário precisa ativar a capacidade correspondente e conceder permissões explícitas antes da comunicação entre apps ou do acesso cruzado à memória.
8. Payloads recebidos são dados não confiáveis. Nunca os execute como código, SQL, comandos, instruções de sistema ou ações sensíveis sem validação e autorização locais.
9. Use HTTPS em qualquer ambiente remoto. HTTP só é permitido pelo SDK em localhost para desenvolvimento.
10. Não armazene o histórico completo de conversas por padrão.

## 2. Descoberta e compatibilidade

Base URL: URL HTTPS do Worker Garcia, sem barra final.

- GET /v1/status: diagnóstico do serviço e banco.
- GET /v1/config: configuração pública e limites.
- GET /v1/ai/capabilities: capacidades declaradas e estado real da inteligência.
- GET /v1/models: modelo configurado.

A resposta de capacidades atual informa mode: "single-pass", multi_model_fanout_enabled: false, external_tools_enabled: false. Não assuma que uma capacidade marcada como disponível está ativada em produção. A API não publica hoje um endpoint separado de negociação de versão; garcia-app@1.0.0 é a versão deste contrato e do SDK correspondente.

## 3. Primeiro vínculo do dispositivo

No painel privado Garcia, escolha um aplicativo habilitado em **Conectar novo aplicativo**. O painel apresenta uma vez:

- registration_invitation_code: usado para registrar o dispositivo.
- pairing_invitation_code: usado para associá-lo ao proprietário.

Fluxo recomendado:

1. O aplicativo recebe os dois códigos por um canal seguro e confiável.
2. Chama registerDevice(appId, registrationCode).
3. Guarda imediatamente o access_token retornado no armazenamento seguro da plataforma.
4. Cria/usa CibaClient com callback que recupera o token seguro.
5. Chama pairOwner(pairingCode).
6. Descarta os códigos de convite após o pareamento.

O código de registro e o código de pareamento são de uso único. Não os embuta no APK, bundle web ou repositório. O token de dispositivo retornado no registro é exibido apenas nessa resposta; se for perdido, revogue o dispositivo e registre outro.

## 4. Cliente oficial comum

O código compartilhado está em src/client.ts. Pode ser importado diretamente pelo projeto ou adaptado para o empacotamento da plataforma. Não há ainda pacote publicado nem SDK nativo Kotlin/Swift.

~~~ts
import { CibaClient } from "./src/client";

const client = new CibaClient({
  baseUrl: "https://SEU-WORKER",
  getAccessToken: () => secureStorage.get("garcia_device_token"),
});
~~~

O callback é consultado em cada chamada autenticada. O SDK não persiste tokens por conta própria. A implementação de secureStorage pertence ao app e deve usar o cofre seguro da plataforma.

## 5. Superfície HTTP v1

| Operação | Método e rota | Autenticação | Observação |
|---|---|---|---|
| Capacidades | GET /v1/ai/capabilities | Pública | Estado de recursos |
| Registrar dispositivo | POST /v1/auth/register | Convite | Retorna token uma vez |
| Parear proprietário | POST /v1/owner/pair | Token de dispositivo | Vincula ao proprietário do convite |
| Conversar com Garcia | POST /v1/ai/chat | Token de dispositivo | Até 20 mensagens; até 1.500 caracteres por mensagem e 3.000 no total |
| Enviar mensagem a outro app | POST /v1/apps/messages | Token de dispositivo | Requer recurso ativado e concessões send/receive |
| Consultar caixa de entrada | GET /v1/apps/messages/inbox?limit=20 | Token de dispositivo | Limite máximo 50 |
| Confirmar recebimento | POST /v1/apps/messages/ack | Token de dispositivo | Até 50 IDs por chamada |\n| Consultar e consolidar resultados | GET /v1/apps/tasks/results?task_id=... | Token de dispositivo | Retorna resultados e comparação estrutural determinística |
| Listar concessões | GET /v1/owner/access-grants | Token pareado | Painel/proprietário |
| Consultar memória | GET /v1/owner/memory?scope=app | Token pareado | Recurso memória deve estar ativo |

O SDK oferece métodos correspondentes para chat, mensagens, caixa de entrada, confirmação, memória e concessões. Para operações administrativas do proprietário, use o painel; não coloque ADMIN_TOKEN em aplicativos clientes.

## 6. Contrato de mensagens entre aplicativos

A mensagem é um envelope JSON. O pedido de envio contém:

~~~json
{
  "destination_app_id": "com.exemplo.destino",
  "client_message_id": "id-unico-gerado-pelo-app",
  "task_id": "tarefa-123",
  "scope": "task",
  "payload": {
    "type": "example.request",
    "version": 1,
    "data": {}
  },
  "ttl_hours": 24
}
~~~

Regras atuais do servidor:

- scope é task ou context.
- payload deve ser um objeto JSON e pode ter no máximo 8.000 caracteres serializados.
- client_message_id e task_id são obrigatórios, com no máximo 100 caracteres.
- ttl_hours é inteiro de 1 a 72; padrão 24.
- O servidor limita mensagens pendentes por proprietário e app de destino.
- A chave idempotente é proprietário + app de origem + client_message_id. Reutilize o mesmo ID em retries da mesma operação.
- O app de destino recebe message_id, origem, destino, tarefa, escopo, payload, criação e expiração.
- Após processar e persistir o resultado necessário, o app confirma com acknowledgeMessages([message_id]).

O formato interno do payload é definido pelos apps participantes. Use type e version em cada payload, valide os campos e ignore tipos/versões desconhecidos. Não existe execução automática de payload pelo Garcia.

## 7. Consolidação dos resultados de tarefas

O GET /v1/apps/tasks/results?task_id=... retorna os resultados autorizados e um campo consolidation calculado no servidor, sem uma chamada adicional a modelo e sem custo de inferência.

Estados possíveis:
- awaiting_results: nenhum resultado válido chegou.
- no_successful_results: só existem respostas com falha ou sem conteúdo utilizável.
- single_result: uma resposta concluída/parcial utilizável.
- agreement: duas ou mais respostas têm conteúdo JSON estruturalmente idêntico (a ordem das chaves de objetos não altera a comparação).
- divergent: existem conteúdos diferentes; o servidor não escolhe um vencedor nem mistura respostas conflitantes.

O objeto informa contagens por status, fontes participantes, número de saídas distintas, agreement, consensus_result e divergent_source_app_ids. consensus_result só é preenchido quando existe uma saída utilizável única ou concordância exata. Em divergência, consensus_result é null. Isso é comparação determinística, não síntese semântica nem validação de veracidade. Os aplicativos devem preservar a proveniência e apresentar divergências ao usuário, sem tratar uma resposta como fato confirmado.

## 8. Permissões e capacidades

Antes de enviar mensagens, o proprietário deve:

1. Ativar **Comunicação entre apps** no painel (ou app_messaging_enabled na API de configurações).
2. Criar concessão send para o app de origem, com origem, destino e escopo exatos.
3. Criar concessão receive para o app de destino, com a mesma origem, destino e escopo.

Para memória compartilhada, o proprietário deve ativar **Memória privada** e conceder memory_read e/ou memory_write no escopo apropriado. Memória do próprio app permanece isolada; acesso a outro app ou à memória central exige concessão explícita. Desativar um recurso bloqueia seu uso, mas não apaga registros nem revoga concessões.

## 8. Tratamento de erros

O SDK lança CibaApiError com status, code e details.

| HTTP | Tratamento recomendado |
|---|---|
| 400 | Corrigir o formato/campos; não repetir sem alteração |
| 401 | Token inválido/ausente ou convite inválido; solicitar novo vínculo conforme o caso |
| 403 | App desabilitado, proprietário inativo, capacidade desligada ou concessão ausente |
| 409 | Dispositivo já pareado, convite reutilizado ou conflito de vínculo |
| 413 | Reduzir o payload |
| 429 | Respeitar Retry-After ou retry_after_seconds; aplicar backoff |
| 503 | Serviço/modelo indisponível ou manutenção; não criar loops de retry |

Retries de envio devem preservar client_message_id para evitar duplicidade lógica. Não repita indefinidamente.

## 9. Privacidade, segurança e limites

- Não enviar senhas, tokens, chaves privadas, dados financeiros completos ou informações sensíveis em payloads.
- Pedir consentimento explícito antes de salvar memória curada.
- Não registrar conteúdo integral de conversas em logs.
- Limpar códigos de convite após uso e proteger o token do dispositivo.
- Validar origem, destino, tipo e versão do payload antes de qualquer ação.
- Aplicar confirmação humana para ações externas, destrutivas, financeiras ou irreversíveis.
- Tratar respostas do modelo e mensagens de outros apps como conteúdo não confiável.
- Respeitar limites diários e por minuto publicados pelo serviço.

## 10. Estado de implementação

Implementados no repositório: Worker/API, cliente TypeScript comum, registro e pareamento por convites, concessões explícitas, fila JSON entre apps, memória curada, controles do proprietário e painel privado.

Ainda necessários antes de operação real: provisionar D1 e binding AI, aplicar as migrations no ambiente, configurar segredos/variáveis no provedor, publicar o Worker e integrar cada aplicativo individualmente. Nenhum desses passos é executado por esta etapa. O backend não deve ser considerado operacional só porque o código e os testes de CI existem.


## 11. Identidade e capacidades declaradas dos aplicativos

O administrador cadastra, em `POST /v1/admin/apps`, os campos `description`, `app_type`, `capabilities`, `task_types` e `contract_version`. Tipos aceitos: `assistant`, `utility`, `productivity`, `creative`, `mobility` e `other`. Os tipos de tarefa aceitos são analyze, classify, draft, extract, organize, plan, research, summarize, transcribe e translate. São declarações de finalidade que o app informa que sabe solicitar/receber; não são permissões nem execução automática. As capacidades são uma lista fechada e descritiva: assistant, automation, calendar, contacts, documents, finance, media, mobility, notes, productivity, research e smart_home.

Um dispositivo autenticado consulta `GET /v1/apps/identity` para obter seu perfil e a lista de apps habilitados com dispositivos ativos pareados ao mesmo proprietário. O endpoint também informa explicitamente que as capacidades são apenas descritivas, que o acesso cruzado exige concessões e que Garcia não executa ações dos aplicativos. Essa resposta não revela tokens, hashes ou conteúdo de conversas.


## 12. Encaminhamento centralizado de tarefas

Um aplicativo autenticado pode solicitar roteamento com `POST /v1/apps/tasks/dispatch` ou pelo método SDK `dispatchTask()`. Campos: `task_type` (um dos tipos declarados), `instruction` (até 6.000 caracteres), `client_message_id` para idempotência, opcional `preferred_app_id`, `context` (até 1.500 caracteres serializados) e `ttl_hours` (1 a 72).

Garcia procura somente aplicativos habilitados, ativos e pareados ao mesmo proprietário. O destino precisa declarar o tipo de tarefa e possuir, junto com o remetente, concessões vigentes de `send` e `receive` no escopo `task`. Um único candidato elegível é selecionado. Se houver vários, a API responde HTTP 409 com candidatos e exige `preferred_app_id`; sem concessões retorna 403 e sem app capaz retorna 404. O recurso de mensagens do proprietário também precisa estar habilitado.

A mensagem chega na caixa de entrada padrão como payload `protocol: garcia.task.request`, contendo `task_id`, `task_type`, `instruction` e contexto opcional. O aplicativo de destino executa sua própria lógica e responde enviando uma mensagem normal de volta ao remetente, com o mesmo `task_id`; isso exige concessões válidas no sentido inverso. Garcia não executa ações do app nem presume que uma tarefa foi concluída. A consolidação final ainda cabe ao aplicativo que iniciou a tarefa. O identificador `client_message_id` torna a solicitação idempotente por aplicativo e proprietário.


## 13. Retorno e consulta de resultados de tarefas

O aplicativo destinatário responde pelo endpoint autenticado `POST /v1/apps/tasks/results` ou pelo método SDK `submitTaskResult()`. Envie `task_id`, `client_message_id`, `result` (objeto JSON) e status opcional (`completed`, `failed` ou `partial`). O servidor só aceita resposta para uma solicitação Garcia ainda válida, originalmente encaminhada ao app autenticado, e exige concessões `send` e `receive` inversas entre os dois aplicativos. O resultado é limitado a 7.000 caracteres e usa a fila existente; não é executado pelo servidor.

O aplicativo que iniciou a tarefa consulta `GET /v1/apps/tasks/results?task_id=...` ou `getTaskResults(taskId)`. A resposta contém resultados correlacionados pelo mesmo identificador, status, app respondente e horários. Os resultados continuam sujeitos à validade da mensagem e às concessões atuais. A consulta não confirma nem apaga as mensagens; após processar o resultado, o app deve confirmar o `message_id` com `acknowledgeMessages()`. Use um `client_message_id` estável em tentativas repetidas.

Garcia transporta e correlaciona os resultados, mas a interpretação e a redação da resposta final continuam sob responsabilidade do app solicitante. Não trate um status `completed` como verificação independente da qualidade do conteúdo.
