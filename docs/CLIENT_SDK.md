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
