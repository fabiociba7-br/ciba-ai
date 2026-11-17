# Garcia para Android

Aplicativo Android independente da Garcia. O projeto não depende do GEIVIA nem do Zupi.

## O que está incluído

- Interface nativa em Jetpack Compose, adaptada para celular.
- Conversa com o Ciba AI Worker publicado.
- Histórico local de conversas criptografado com chave mantida no Android Keystore.
- Token de dispositivo protegido com AES-GCM e Android Keystore.
- Consulta de status e consumo.
- Sem cadastro de usuário, senha ou conta própria.
- Sem ferramentas externas, ações automáticas ou permissões de outros aplicativos nesta primeira versão.

## Identidade

- Android applicationId: `com.ciba.garcia`
- API: `https://ciba-ai.fabiociba7.workers.dev`

## Ativação de dispositivo único

O backend atual protege a conversa com token de dispositivo e vínculo explícito ao proprietário. Por isso, a primeira instalação apresenta uma ativação técnica única, não um cadastro de usuário. São necessários dois códigos de uso único: um convite de registro (`POST /v1/auth/register`) e um convite de pareamento do proprietário (`POST /v1/auth/pair-owner`). Ambos são emitidos pelo fluxo administrativo do Ciba AI, com validade de 24 horas. O package ID `com.ciba.garcia` precisa estar permitido no Worker antes da emissão. O token recebido fica protegido no Android Keystore; não é exibido nem registrado em logs.

O segredo administrativo do Worker nunca deve ser incluído no APK. A ativação é uma etapa de provisionamento do dispositivo e pode ser substituída por pareamento proprietário dedicado em uma evolução do backend.

## Abrir no Android Studio

Abra a pasta `garcia-android`. Use JDK 17 e Android SDK Platform 36. O projeto não contém wrapper Gradle binário. O build e os testes ficam para a rodada final solicitada pelo proprietário; nenhuma APK é gerada automaticamente pelo CI.

## Arquitetura

`MainActivity` contém a interface e estado de conversa; `CibaAiClient` concentra as chamadas HTTP; `SecureStore` protege credenciais e histórico local. O backend não recebe histórico persistido: o cliente envia apenas as últimas mensagens necessárias a cada chamada.
