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

O backend atual protege a rota de conversa com token de dispositivo e emite esse token por meio de convite de uso único em `POST /v1/auth/register`. Por isso, a primeira instalação apresenta uma tela de ativação técnica, não um cadastro de usuário. O convite precisa ser emitido e o package ID `com.ciba.garcia` habilitado no registry do Ciba AI antes do primeiro uso. O token recebido fica apenas no Android Keystore protegido; não é exibido nem registrado em logs.

O segredo administrativo do Worker nunca deve ser incluído no APK. A ativação é uma etapa de provisionamento do dispositivo e pode ser substituída por pareamento proprietário dedicado em uma evolução do backend.

## Abrir no Android Studio

Abra a pasta `garcia-android`. Use JDK 17 e Android SDK Platform 36. O projeto não contém wrapper Gradle binário. O build e os testes ficam para a rodada final solicitada pelo proprietário; nenhuma APK é gerada automaticamente pelo CI.

## Arquitetura

`MainActivity` contém a interface e estado de conversa; `CibaAiClient` concentra as chamadas HTTP; `SecureStore` protege credenciais e histórico local. O backend não recebe histórico persistido: o cliente envia apenas as últimas mensagens necessárias a cada chamada.
