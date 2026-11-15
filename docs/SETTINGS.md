# Configuração administrativa do Ciba AI

O Ciba AI separa configurações operacionais de segredos. As configurações editáveis ficam na tabela D1 `runtime_settings` e poderão ser controladas por uma futura tela **Configurações** nos aplicativos ou num painel administrativo.

## Visão geral administrativa da IA

- `GET /v1/admin/ai/overview`: visão protegida para uma futura tela administrativa. Retorna o modelo efetivo, estado da IA, perfis especialistas, limites e quais extensões estão apenas preparadas. Exige `Authorization: Bearer ADMIN_TOKEN`. Não retorna credenciais, tokens nem conteúdo de conversas.

Esse endpoint distingue explicitamente o modo `single-pass` das extensões ainda desativadas: ensemble multi-modelo, memória persistente e execução de ferramentas.

## Cadastro de aplicativos pela API

- `GET /v1/admin/apps`: lista os aplicativos registrados.
- `GET /v1/admin/devices`: lista dispositivos, sem expor hashes ou tokens. Aceita `app_id` e `limit` como filtros.
- `GET /v1/admin/invitations`: lista metadados de convites, sem expor códigos. Aceita `app_id` e `limit` como filtros.
- `POST /v1/admin/apps`: cadastra ou atualiza um aplicativo permitido.

Exemplo de cadastro:

```json
{
  "app_id": "com.exemplo.aplicativo",
  "display_name": "Aplicativo Ciba",
  "enabled": true
}
```

O `app_id` deve ser o applicationId real do Android. Aplicativos desativados deixam de poder registrar novos dispositivos e gerar convites. O valor também não substitui atestação de integridade do APK; isso será uma camada adicional antes de produção.

## Configurações editáveis pela API

Autenticação administrativa: `Authorization: Bearer ADMIN_TOKEN`.

- `GET /v1/admin/settings`: lista configurações salvas e chaves permitidas.
- `POST /v1/admin/settings`: salva um objeto `settings`.
- `GET /v1/config`: retorna somente a configuração pública necessária aos clientes.

Exemplo:

```http
POST /v1/admin/settings
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

```json
{
  "settings": {
    "ai_enabled": true,
    "ai_model": "@cf/google/gemma-4-26b-a4b-it",
    "daily_global_limit": 50,
    "daily_app_limit": 25,
    "daily_device_limit": 10,
    "max_output_tokens": 512,
    "maintenance_mode": false
  }
}
```

## Chaves disponíveis

| Chave | Tipo | Finalidade |
|---|---|---|
| `ai_enabled` | boolean | Liga/desliga novas chamadas de IA |
| `ai_model` | string | Modelo Workers AI selecionado |
| `daily_global_limit` | número | Limite diário global de requisições |
| `daily_app_limit` | número | Limite diário por aplicativo |
| `daily_device_limit` | número | Limite diário por dispositivo |
| `max_output_tokens` | número | Limite de tokens de saída (máximo 512) |
| `maintenance_mode` | boolean | Bloqueia temporariamente chamadas de chat |

Os valores salvos no D1 prevalecem sobre os valores padrão em `wrangler.toml`. A API valida os tipos e os limites antes de gravar. Para preservar a meta de custo zero, a seleção de modelo fica restrita à lista de modelos explicitamente liberados no código; atualmente, somente `@cf/google/gemma-4-26b-a4b-it` é aceito. Não cadastrar modelos com cobrança por fora dessa lista. O endpoint público `/v1/config` não revela tokens administrativos, credenciais ou segredos.

## O que continuará sendo segredo ou provisionamento de infraestrutura

Não deve ser colocado na tela de configurações comum nem enviado ao aplicativo cliente:

- `ADMIN_TOKEN`: segredo Cloudflare Worker.
- ID e binding do banco D1.
- Credenciais e tokens da conta Cloudflare.
- Qualquer chave privada ou credencial de provedor.

A lista de IDs Android permitidos (`ALLOWED_APP_IDS`) ainda é provisionada no ambiente até a próxima etapa de cadastro/gestão de aplicativos. Não aceitar um ID enviado livremente pelo cliente como prova de que o APK é oficial.

## Aplicação da migration

Antes de usar os endpoints administrativos, aplicar também a migration `0002_runtime_settings.sql` no D1. A migration ainda não foi aplicada remotamente porque o banco Cloudflare ainda não foi provisionado.


## Retenção e limpeza automática

Um Cron diário às 03:17 UTC remove registros de uso diário com mais de 35 dias e convites expirados e não utilizados com mais de 30 dias. O histórico de dispositivos é preservado para auditoria; tokens nunca são armazenados em texto puro.


## Proteção contra excesso de chamadas

O endpoint de chat aceita até 12 chamadas por dispositivo em cada minuto UTC. O controle é persistido no D1 e aplicado atomicamente por trigger SQL; a resposta para excesso é HTTP 429 com `rate_limit_exceeded`. As migrations `0004_minute_rate_limit.sql` e `0005_configurable_rate_limit.sql` criam o contador e vinculam o limite armazenado à constante usada pelo Worker. Registros antigos são removidos pelo cron diário.

## Validação efetiva do modelo

A allowlist de modelos é verificada novamente no momento da inferência. Atualmente, somente `@cf/google/gemma-4-26b-a4b-it` é aceito. Se a variável de ambiente ou a configuração persistida apontar para outro modelo, a inferência é bloqueada em vez de executar um modelo potencialmente pago.


## Tetos de segurança que não podem ser aumentados pela tela

A administração pode reduzir os limites, mas não ultrapassar os tetos definidos no código:

| Controle | Teto |
|---|---:|
| Requisições globais por dia | 50 |
| Requisições por app por dia | 25 |
| Requisições por dispositivo por dia | 10 |
| Tokens máximos de saída por resposta | 512 |
| Caracteres por mensagem | 1.500 |
| Caracteres somados por requisição | 3.000 |

Esses tetos reduzem o risco de consumo acidental, mas **não garantem** um valor máximo de Neurons nem substituem o painel de consumo e os limites da Cloudflare. A quantidade de Neurons depende do modelo e do conteúdo efetivamente processado.


## Memória privada e comunicação entre aplicativos

O Ciba AI é uma inteligência privada do proprietário e dos aplicativos autorizados por ele; não é uma plataforma de cadastro público. A arquitetura de memória distingue:

- **Memória do proprietário:** contexto central que poderá ser compartilhado com aplicativos somente por concessão explícita.
- **Memória do aplicativo:** dados isolados por `ownerId` e `appId`; outro aplicativo não pode ler ou alterar esses dados por padrão.
- **Comunicação entre aplicativos:** deve passar pelo Ciba AI como intermediário, com identidade do aplicativo de origem e destino, escopo, permissão, validade e registro de auditoria.

Os contratos e a política de autorização já estão definidos em `src/core/memory.ts`. A política exige correspondência do proprietário, concede acesso local ao escopo do próprio aplicativo e exige uma concessão explícita para memória central ou memória de outro aplicativo. Concessões podem limitar leitura/escrita e expirar.

**Estado real:** as APIs de memória e comunicação estão implementadas, mas dependem das migrations 0007–0011 e do deploy para operar em produção. O controle de capacidades por proprietário está disponível pela API autenticada; ainda não existe uma tela visual integrada nos aplicativos.


## Controles de capacidades por proprietário

Cada proprietário pode controlar as capacidades privadas por `GET /v1/owner/settings` e `POST /v1/owner/settings`, usando um dispositivo autenticado e pareado. Exemplo:

```json
{
  "settings": {
    "memory_enabled": true,
    "app_messaging_enabled": false
  }
}
```

Ambas as opções começam em `false`. Com memória desligada, as rotas de memória e a criação de concessões de memória retornam HTTP 403. Com comunicação desligada, envio, caixa de entrada, confirmação de mensagens e criação de concessões de comunicação retornam HTTP 403. Desligar não apaga dados nem revoga concessões; apenas bloqueia a capacidade até que seja reativada. A administração não aceita chaves arbitrárias nem segredos nesse endpoint. A migration `0011_owner_feature_settings.sql` precisa ser aplicada antes do uso.


## Painel privado Garcia — API de visão geral

O endpoint `GET /v1/owner/dashboard` reúne os dados necessários para a tela inicial do painel Garcia. Exige um dispositivo autenticado e pareado com um proprietário ativo; não aceita `owner_id` enviado pelo cliente.

A resposta inclui:
- estado real da inteligência, provedor/modelo atualmente configurado e modo de execução;
- indicação explícita de que a execução multi-modelo e ferramentas externas continuam desativadas;
- controles privados de memória e comunicação;
- aplicativos que possuem dispositivos vinculados ao proprietário, quantidade de dispositivos ativos e último acesso;
- inventário limitado de dispositivos e concessões de acesso.

O inventário nunca retorna tokens, hashes de tokens, credenciais ou conteúdo de conversas. Os dispositivos são limitados a 100 e as concessões a 200 registros mais recentes. O endpoint é somente leitura; alterações continuam usando as rotas específicas de configurações, concessões e revogação.

**Escopo desta etapa:** API de dados do painel e método correspondente no SDK. A interface visual ainda não foi criada nem publicada. Nenhuma migration foi aplicada e nenhum deploy foi realizado.


## Interface web privada Garcia

A interface inicial do painel está disponível na rota `GET /dashboard` do próprio Worker. Ela não depende de framework, CDN, serviço de hospedagem adicional ou armazenamento de navegador.

O painel oferece:
- visão geral do estado real da IA, modelo, limites e capacidades ainda desativadas;
- ativação e desativação das opções de memória e comunicação;
- inventário de aplicativos conectados e dispositivos pareados;
- consulta, criação e revogação de concessões de acesso.

O usuário informa o token de um dispositivo já pareado. O token fica somente em memória JavaScript durante a sessão e é descartado ao sair ou fechar a página; não é escrito em `localStorage` nem `sessionStorage`. A página chama somente endpoints do mesmo domínio e não envia credenciais a serviços externos. A resposta HTML usa política CSP restritiva, bloqueio de cache e cabeçalhos de segurança.

A rota da interface é pública no sentido de que entrega apenas o HTML estático; os dados e todas as alterações continuam protegidos pelas APIs autenticadas do proprietário. Para usar o painel, o Worker e as migrations necessárias precisam estar configurados. Esta implementação no repositório não significa que já esteja publicado.

## Gerenciamento e revogação de dispositivos

A interface do painel lista os dispositivos pareados e identifica a sessão atual. Para outros dispositivos ativos, oferece a ação de revogação imediata.

O endpoint `POST /v1/owner/devices/revoke` deriva o proprietário do token autenticado e executa a atualização condicionada simultaneamente ao identificador do dispositivo e ao `owner_id`. Assim, não aceita revogar dispositivos de outro proprietário. A própria sessão autenticada é protegida contra revogação acidental (`current_device_cannot_revoke`). Um dispositivo revogado perde imediatamente a autenticação em novas requisições.

A revogação não apaga histórico, memórias ou dados do aplicativo; apenas invalida o token do dispositivo. A operação é irreversível pelo painel: para voltar, será necessário registrar e parear um novo dispositivo.
## Conectar aplicativos pelo painel Garcia

Na seção **Conectar novo aplicativo**, o proprietário autenticado escolhe um app já cadastrado e habilitado. O Worker cria atomicamente dois convites de uso único, ambos com validade de 24 horas:

- **Código de registro:** usado pelo app em `POST /v1/auth/register` para registrar um dispositivo e obter seu token.
- **Código de pareamento:** usado pelo dispositivo recém-registrado em `POST /v1/owner/pair` para vinculá-lo ao proprietário autenticado.

O endpoint `GET /v1/owner/available-apps` lista somente apps habilitados. `POST /v1/owner/apps/connect` deriva o proprietário do dispositivo autenticado, confirma o app habilitado e cria os dois convites numa transação D1. Os códigos em texto puro são retornados somente na criação; apenas hashes são persistidos. Reutilização é impedida pelos fluxos de consumo existentes.

O painel mostra os códigos uma única vez, com ações para copiar e a data de expiração. Eles devem ser entregues apenas ao responsável pelo aplicativo por canal seguro. O processo ainda exige que o app implemente o registro, armazene seu token em armazenamento seguro e faça o pareamento; o painel não instala nem configura automaticamente o app.

Esta funcionalidade não permite ao proprietário cadastrar novos aplicativos nem alterar o registro global. Um app precisa ser previamente cadastrado e habilitado pela administração. Nenhuma credencial administrativa é colocada no navegador.

## Cadastro de identidade dos aplicativos

O cadastro administrativo `POST /v1/admin/apps` aceita metadados de identidade: descrição (até 280 caracteres), tipo, capacidades declarativas conhecidas e versão semântica do contrato. A listagem administrativa retorna esses campos. O painel do proprietário mostra tipo, descrição e capacidades dos apps conectados. A consulta autenticada `GET /v1/apps/identity` é destinada aos próprios aplicativos e lista apenas outros apps habilitados com dispositivos ativos ligados ao mesmo proprietário.

As capacidades não são permissões nem ferramentas executáveis. Concessões existentes e controles do proprietário continuam sendo a única base para acesso cruzado; nenhum comando é executado a partir desses metadados.
