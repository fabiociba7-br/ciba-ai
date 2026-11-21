# Pocket TTS — integração nativa na Garcia

Data da decisão: 20/11/2026.

## Decisão arquitetural

Pocket TTS será incorporado diretamente ao aplicativo Garcia. A Garcia não dependerá do pacote Android `org.pockettts.android.engine`, de outro aplicativo instalado, nem da seleção de um mecanismo TTS externo nas configurações do Android.

O projeto comunitário PocketTTS-Android-Engine será usado somente como referência técnica para portar e adaptar o runtime. Não será instalado como companion, não será incluído como APK aninhado e não será executado como processo separado.

## Arquitetura pretendida

- **Camada Android/Kotlin:** gerencia o ciclo de vida do motor, seleção de idioma/voz, importação de pacotes, gravações de referência e estados de instalação.
- **JNI:** ponte privada entre Kotlin e o runtime C++.
- **Inferência:** PocketTTS.cpp com ONNX Runtime, SentencePiece e dependências nativas necessárias.
- **Modelos:** baixados ou importados sob demanda e armazenados no diretório privado da Garcia; não entram no APK.
- **Clonagem:** WAV autorizado importado/grabado dentro da Garcia e mantido no armazenamento privado do próprio app.
- **Áudio:** PCM retornado diretamente ao subsistema de voz da Garcia, sem roteamento pelo serviço TTS de outro pacote.

A implementação deverá expor o motor pelo contrato `VoiceEngine`, mantendo o restante da Garcia independente do runtime concreto.

## Base técnica e versões

- Referência Android: repositório [PocketTTS-Android-Engine](https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine), release estável v0.5.5.
- Ponte nativa: wrapper Kotlin `NativePocketTts` e interface JNI do projeto de referência, adaptados ao namespace e ciclo de vida da Garcia.
- Runtime C++: snapshot PocketTTS.cpp mantido pelo projeto de referência; fixar commit exato no CMake/FetchContent, sem usar branch móvel.
- ONNX Runtime Android: versão 1.20.0 como ponto de partida documentado pelo projeto de referência; baixar no CI com SHA-256 verificado e incluir apenas a biblioteca ARM64 necessária.
- SentencePiece: v0.2.1.
- dr_libs: commit fixo informado nos avisos de terceiros.
- NDK: 27.2.12479018; CMake 3.22.1; Android mínimo API 26.

O runtime publicado e validado pelo projeto de referência é ARM64. A primeira integração nativa deve limitar o build do Pocket TTS a `arm64-v8a`; não declarar suporte x86_64 até existir e passar uma compilação/teste específico dessa ABI.

## Modelos e clonagem

- O pacote Portuguese FP32 existe no catálogo público do projeto de referência, mas isso não comprova qualidade nem locale pt-BR no aparelho Garcia.
- Os pesos ONNX e as vozes oficiais têm licença CC BY 4.0 e exigem atribuição; não presumir que a licença MIT do código cubra os pesos.
- Modelos serão obtidos separadamente do APK, com origem, versão, tamanho, espaço livre, SHA-256 e licença verificados.
- Importação ZIP deve impedir path traversal, symlinks, arquivos excessivos e substituição parcial de modelos válidos.
- WAV de referência deve ser validado (container, duração, canais, taxa, tamanho e áudio não vazio); só aceitar voz própria ou uso com consentimento explícito.
- Perfis, modelos e gravações devem poder ser removidos pela interface da Garcia.

## Integração com a saída de voz

A Garcia deverá chamar o adaptador Pocket TTS diretamente e receber PCM para reprodução/interrupção pelo próprio subsistema de áudio. Não registrar um serviço TTS externo e não depender do mecanismo TTS preferido do sistema Android.

O runtime deve carregar sob demanda, serializar sínteses se o backend nativo não suportar concorrência, cancelar com segurança, liberar recursos e recuperar-se de modelo ausente/corrompido. O fallback deve ser explícito e controlado pela Garcia, sem troca silenciosa para serviço externo.

## Pipeline e distribuição

- Não versionar bibliotecas .so, pesos ONNX, modelos ou gravações no Git.
- Preparar dependências nativas no CI com URLs e versões fixas e validação SHA-256 antes da compilação.
- Compilar, executar testes, assinar, verificar assinatura e publicar o APK no mesmo workflow de release, sem segunda compilação.
- Preservar os avisos MIT, Apache-2.0 e demais notices dos componentes incorporados.
- Não publicar pacote de modelo no APK; disponibilizar instalação/atualização dentro da Garcia.

## Etapas obrigatórias de validação

1. Compilar o runtime C++/JNI para ARM64 no CI.
2. Testar criação e destruição do motor, carregamento do modelo e erros de arquivo ausente.
3. Testar importação ZIP com arquivos válidos, corrompidos, path traversal e limites de tamanho.
4. Testar importação WAV autorizado e remoção de perfis.
5. Gerar áudio em português e avaliar inteligibilidade, pronúncia e prosódia pt-BR no aparelho real.
6. Testar modo avião após baixar o modelo: clonagem e síntese devem funcionar offline.
7. Testar cancelamento durante síntese, alternância de telas, rotação/recriação da Activity, falta de memória e liberação de recursos.
8. Medir RAM, tempo até primeiro áudio, duração de síntese, temperatura e estabilidade.
9. Confirmar que não existe referência ao package externo `org.pockettts.android.engine` nem dependência de TTS Settings no caminho de voz da Garcia.

Até esses gates passarem, Pocket TTS permanece experimental e não deve ser marcado como pronto.
