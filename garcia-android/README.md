# Garcia para Android

Aplicativo Android da assistente de IA **Garcia**. Ciba AI é apenas o nome do repositório e da infraestrutura de servidor Cloudflare. O projeto não depende do GEIVIA nem do Zupi.

## O que está incluído

- Interface nativa em Jetpack Compose, adaptada para celular.
- Identidade visual baseada na logo oficial: rosa, coral, lilás, branco e cinza.
- Ícone Android com o símbolo floral da marca e Splash Screen própria com nome e assinatura Garcia.
- Conversa com a assistente Garcia por meio da API hospedada no Ciba AI Worker.
- Histórico local de conversas criptografado com chave mantida no Android Keystore.
- Token de dispositivo protegido com AES-GCM e Android Keystore.
- Consulta de status e consumo.
- Integração Facebook com login pelo SDK, armazenamento do token criptografado no backend e consulta de perfil, permissões, páginas, publicações e conversas/mensagens das Páginas administradas.
- Sem cadastro de usuário, senha ou conta própria.
- O acesso ao Facebook depende das permissões concedidas pela pessoa e das aprovações exigidas pela Meta. A caixa de entrada disponível é a das Páginas administradas, não mensagens pessoais.

## Identidade visual

A paleta oficial está centralizada em `app/src/main/res/values/colors.xml`. O ícone floral vetorial está em `app/src/main/res/drawable/ic_garcia.xml`; a abertura personalizada é implementada em `SplashActivity` e exibe a assinatura `GARCIA — ASSISTENTE DE IA` em fundo branco.

## Identidade

- Android applicationId: `com.ciba.garcia`
- Assistente: `Garcia`
- Infraestrutura/API: `Ciba AI` — `https://ciba-ai.fabiociba7.workers.dev`

## Ativação de dispositivo único

O backend atual protege a conversa com token de dispositivo e vínculo explícito ao proprietário. Por isso, a primeira instalação apresenta uma ativação técnica única, não um cadastro de usuário. São necessários dois códigos de uso único: um convite de registro (`POST /v1/auth/register`) e um convite de pareamento do proprietário (`POST /v1/owner/pair`). O workflow manual `Provision Garcia Device` cria o proprietário privado e os dois códigos; o convite de registro tem validade de 24 horas. O convite de pareamento também expira em 24 horas. O package ID `com.ciba.garcia` precisa estar permitido no Worker antes da emissão. O token recebido fica protegido no Android Keystore; não é exibido nem registrado em logs.

O segredo administrativo do Worker nunca deve ser incluído no APK. A ativação é uma etapa de provisionamento do dispositivo e pode ser substituída por pareamento proprietário dedicado em uma evolução do backend.

## Assinatura e atualizações

A assinatura de produção usa uma chave privada permanente e quatro GitHub Actions secrets. Consulte [RELEASE_SIGNING.md](RELEASE_SIGNING.md) antes da primeira versão distribuída. O workflow `Garcia Android Release` gera APK assinado sob demanda, preserva o mesmo certificado entre versões e incrementa automaticamente o `versionCode`. Nunca altere o `applicationId` nem substitua a chave.

## Abrir no Android Studio

Abra a pasta `garcia-android`. Use JDK 17 e Android SDK Platform 36. O projeto não contém wrapper Gradle binário. O build e os testes ficam para a rodada final solicitada pelo proprietário; nenhuma APK é gerada automaticamente pelo CI.

## Arquitetura

`MainActivity` contém a interface e estado de conversa; `CibaAiClient` concentra as chamadas HTTP; `SecureStore` protege credenciais e histórico local. O backend não recebe histórico persistido: o cliente envia apenas as últimas mensagens necessárias a cada chamada.


## Conversação por voz em tempo real

No Android 12 ou superior, a conversação contínua prioriza o reconhecedor de fala on-device do sistema, com resultados parciais em português do Brasil enquanto a pessoa fala. O resultado final segue para a Garcia sem enviar áudio ao servidor. Se o serviço offline do aparelho não estiver disponível ou falhar, o app usa o Whisper local instalado; nunca faz fallback para reconhecimento em nuvem. O ditado avulso continua usando Whisper com revisão antes do envio.
