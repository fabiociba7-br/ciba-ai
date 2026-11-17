# Transcrição e resposta por voz na Garcia

## Transcrição local (Whisper.cpp)

A Garcia integra `whisper.cpp` no Android por JNI/NDK. A captura e inferência são locais; não há fallback para reconhecimento remoto.

### Implementado nesta etapa
- Origem upstream fixada no commit `d1be6fde11ac6e0407606b4e42fe72d34add8037` (v1.9.5).
- Ponte JNI para carregar modelo, transcrever PCM mono 16 kHz, devolver segmentos com timestamps, cancelar e liberar o contexto.
- Importação manual de arquivo de modelo para diretório privado do app; sem download automático.
- Validação de tamanho e cabeçalho GGML, cálculo SHA-256 e nova verificação do hash ao reabrir.
- Captura pelo microfone somente após ação do usuário e permissão `RECORD_AUDIO`.
- Limite de gravação de 120 segundos. O áudio permanece em memória e é apagado após uso.
- Transcrição preenchendo o campo de mensagem; o usuário pode revisar e editar antes de enviar.

### Ainda depende de teste no aparelho
- Escolher e importar um modelo multilíngue compatível com whisper.cpp, com origem/licença conferidas.
- Medir consumo de memória, tempo de carregamento, latência e precisão em português brasileiro.
- Confirmar comportamento em gravações longas, silêncio, ruído, permissão negada e cancelamento.

O aplicativo não inclui pesos no Git nem baixa modelos automaticamente. A validação SHA-256 detecta alteração do arquivo depois da importação; a impressão digital é exibida para auditoria. A procedência/licença do modelo escolhido ainda precisa ser confirmada separadamente.

## Resposta falada local

- `LocalSpeechOutput.kt` usa o mecanismo TextToSpeech do Android.
- Só seleciona vozes em português instaladas no aparelho e explicitamente marcadas como sem necessidade de rede.
- Se não houver voz offline pt-BR/português, a função informa que é preciso instalar dados de voz offline; não usa voz em nuvem.
- A preferência para ler respostas automaticamente fica nas Configurações e pode ser desligada.
- A fala é interrompida quando o usuário desativa a opção ou encerra a tela.

Esta implementação usa TTS local do Android, não Chatterbox. Chatterbox permanece fora do runtime Android até existir uma distribuição móvel comprovada, licenciada e compatível.

## Privacidade e limites
1. A gravação só começa após toque explícito e permissão do microfone.
2. Nenhum áudio é enviado ao servidor pela função de transcrição.
3. A transcrição só vai para a Garcia depois que o usuário revisa e toca em Enviar.
4. O arquivo de modelo é importado manualmente, guardado no armazenamento privado e validado por SHA-256.
5. Sem biblioteca/modelo/voz offline, a função fica indisponível; não há fallback remoto ou pago.
6. O limite de captura é 120 segundos por gravação.

## Referências
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- versão fixada: https://github.com/ggml-org/whisper.cpp/tree/v1.9.5
- exemplo Android upstream: https://github.com/ggml-org/whisper.cpp/tree/master/examples/whisper.android
