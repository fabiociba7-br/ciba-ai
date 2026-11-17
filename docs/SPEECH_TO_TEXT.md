# Transcrição de áudio local

## Objetivo e limites

A Garcia usa `whisper.cpp` embarcado no Android para reconhecer fala localmente. O fluxo é *fail closed*: a transcrição só poderá ocorrer quando a biblioteca nativa estiver pronta, um modelo local aprovado e validado estiver carregado, o dispositivo atender aos requisitos e a solicitação tiver consentimento explícito. Não existe fallback para serviço remoto.

O aplicativo não baixa modelos automaticamente e não envia gravações ou transcrições para terceiros por conta própria. O modelo deve ser obtido e instalado por uma ação explícita do usuário, depois de sua origem, licença e SHA-256 serem aprovados.

## Implementação existente

- `src/core/speech-to-text.ts`: contratos de solicitação, consentimento, resultado, política, registro de adapters, verificação de compatibilidade e execução protegida.
- `src/core/android-whisper-bridge.ts`: adapter TypeScript que exige estado nativo pronto e confere identidade e SHA-256 do modelo.
- `garcia-android/app/src/main/cpp/CMakeLists.txt`: compila `whisper.cpp` para Android por CMake/NDK, com origem fixada no commit `d1be6fde11ac6e0407606b4e42fe72d34add8037` (tag upstream `v1.9.5`).
- `garcia-android/app/src/main/cpp/whisper_jni.cpp`: ponte JNI para carregar o modelo, transcrever PCM mono 16 kHz em português, devolver segmentos com timestamps, cancelar e liberar o contexto.
- `garcia-android/app/src/main/java/com/ciba/garcia/WhisperNative.kt`: fronteira Kotlin/JNI.
- `.github/workflows/garcia-android-compile-check.yml`: compila a biblioteca nativa no CI, sem gerar APK.

O código upstream do motor whisper.cpp é MIT. Isso não aprova automaticamente qualquer arquivo de pesos: a licença, proveniência e checksum do modelo escolhido precisam ser avaliados separadamente.

## O que ainda falta

| Capacidade | Estado |
|---|---|
| Contratos e validação TypeScript | Implementados |
| Adapter TypeScript Android | Implementado |
| Origem whisper.cpp fixada por commit | Implementada |
| Ponte JNI e wrapper Kotlin | Implementados nesta etapa; aguardando CI |
| Modelo multilíngue pt-BR, licença e SHA-256 | Pendente |
| Importação/instalação local do modelo | Pendente |
| Captura de áudio com permissão explícita | Pendente |
| Ligação do gravador ao motor e ao chat | Pendente |
| Revisar/editar transcrição antes do envio | Pendente |
| Teste real em aparelho Android | Pendente |

## Regras de segurança e limites

1. Consentimento explícito e finalidade `transcription` são obrigatórios.
2. O áudio deve ser capturado apenas após ação do usuário, em mono 16 kHz.
3. Limite de duração nativa inicial: 120 segundos por gravação.
4. Cancelamento deve interromper a inferência e impedir que resultados tardios sejam enviados.
5. O contexto nativo deve ser liberado ao sair do fluxo ou encerrar a sessão.
6. A aplicação deve verificar SHA-256 antes de carregar qualquer modelo.
7. O modelo não pode ser incluído no Git nem baixado silenciosamente.
8. Ausência de modelo, biblioteca ou compatibilidade bloqueia a função; não usar `RecognitionService` remoto como fallback.

## Referências

- Código-fonte: https://github.com/ggml-org/whisper.cpp
- Versão fixada: https://github.com/ggml-org/whisper.cpp/tree/v1.9.5
- Exemplo Android oficial: https://github.com/ggml-org/whisper.cpp/tree/master/examples/whisper.android
