# Pocket TTS Android — auditoria e primeira integração

Data da avaliação: 20/11/2026.

## Decisão técnica provisória

Usar o projeto comunitário [PocketTTS-Android-Engine](https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine) como runtime complementar Android na primeira prova de conceito. Não copiar nem incorporar seu código nativo ao APK Garcia nesta etapa.

O runtime implementa um serviço Android `TextToSpeechService`, inferência local via JNI/ONNX Runtime, importação de pacotes de modelo e clonagem por gravação WAV. A Garcia já usa a API Android `TextToSpeech`; portanto, quando Pocket TTS estiver instalado e selecionado como mecanismo preferido do Android, a saída falada da Garcia poderá ser roteada pelo serviço do Pocket TTS sem enviar áudio ou texto a um servidor.

A integração inicial da Garcia deve:
- oferecer uma área Configurações → Clonagem de voz;
- detectar se o pacote complementar `org.pockettts.android.engine` está instalado;
- abrir o gerenciador Pocket TTS para instalar/importar modelos e cadastrar gravações;
- abrir as configurações Android de síntese para o usuário selecionar Pocket TTS como mecanismo preferido;
- informar claramente que os perfis e modelos permanecem no armazenamento privado do aplicativo complementar;
- nunca afirmar que um modelo ou perfil está pronto apenas porque o aplicativo complementar está instalado.

## Compatibilidade verificada na documentação

- Android mínimo: API 26 (Android 8.0).
- ABI publicada: somente `arm64-v8a`.
- A Garcia atualmente declara `arm64-v8a` e `x86_64`; em aparelho sem ARM64 o motor complementar não será compatível.
- O projeto lista um pacote de modelo Portuguese FP32 e permite importar referência WAV.
- A documentação sugere gravação limpa de 5–15 segundos, mono, sem música, eco, clipping ou silêncio excessivo.
- A versão estável indicada pelo projeto é 0.5.5. A versão 0.5.6-rc1 é pré-lançamento e não deve ser usada como padrão de produção.
- A documentação de validação do projeto confirma testes em aparelho para inglês e alemão. A presença de pacote Portuguese não equivale a validação de qualidade ou locale pt-BR no aparelho Garcia; isso continua sendo gate obrigatório.

## Licenças e proveniência

- Código do projeto Android: MIT.
- Código upstream Pocket TTS: MIT.
- Pesos originais e derivados ONNX: CC BY 4.0, além das condições de acesso/uso do repositório de modelos upstream.
- ONNX Runtime Android: MIT; SentencePiece: Apache-2.0; demais avisos devem ser mantidos conforme `THIRD_PARTY_NOTICES.md` upstream.
- Não redistribuir pesos, pacotes ou vozes padrão dentro do APK Garcia nesta etapa.
- Exibir atribuições aplicáveis se futuramente houver redistribuição de modelos ou vozes.
- Só importar voz própria ou gravação com consentimento explícito e legítimo.

Fontes técnicas:
- [Pocket TTS Android Engine](https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine)
- [Licença e condições dos modelos](https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine/blob/main/MODEL_LICENSE.md)
- [Avisos de terceiros](https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine/blob/main/THIRD_PARTY_NOTICES.md)
- [Construção e testes Android](https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine/blob/main/docs/BUILDING.md)
- [Pocket TTS upstream](https://github.com/kyutai-labs/pocket-tts)

## Limites da integração complementar

A Garcia não lê diretamente a biblioteca privada de perfis do Pocket TTS. A primeira integração delega a criação/gestão de perfis ao app complementar e a síntese à API Android TTS selecionada pelo usuário. Não usar permissões de acesso amplo a arquivos, não copiar gravações entre aplicativos e não tentar ler diretórios privados de outro pacote.

## Gates antes de declarar concluído

1. Instalar o Pocket TTS Android Engine estável em aparelho ARM64 compatível.
2. Importar o pacote Portuguese FP32 e verificar locale/voz efetivamente anunciado ao Android.
3. Importar uma referência WAV autorizada e criar um perfil clonado.
4. Selecionar Pocket TTS como mecanismo preferido nas configurações Android.
5. Reiniciar a Garcia e confirmar que a voz selecionada pelo serviço Pocket TTS é usada.
6. Testar síntese e clonagem sem rede, medindo tempo, memória, temperatura e estabilidade.
7. Testar retorno ao TTS Android padrão quando o app complementar ou modelo não estiver disponível.
8. Confirmar que desligar a resposta falada interrompe a síntese e que nenhum áudio é enviado à rede.

Até todos os gates passarem, Pocket TTS deve aparecer como experimental/em validação, não como motor pronto.
