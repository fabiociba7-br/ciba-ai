# Transcrição de áudio local

## Objetivo e limites

O Ciba AI possui contratos TypeScript para transcrição local usando `whisper.cpp`. O desenho é *fail closed*: a transcrição só acontece quando um adapter local foi explicitamente registrado, o dispositivo atende aos requisitos do modelo e a solicitação contém consentimento explícito. Não existe fallback para um serviço remoto.

A existência desses contratos não significa que o motor nativo esteja instalado ou operacional. O repositório contém a camada TypeScript de integração Android (`src/core/android-whisper-bridge.ts`), mas não contém, neste momento, uma implementação JNI/NDK, bibliotecas nativas compiladas ou arquivos de pesos do Whisper. O aplicativo Android que integrar o núcleo ainda precisa fornecer a implementação concreta de `AndroidWhisperCppBridge` e disponibilizar o modelo local.

## Componentes

- `src/core/speech-to-text.ts`: contratos de solicitação, consentimento, resultado, política, registro de adapters, verificação de compatibilidade do dispositivo e execução protegida.
- `src/core/android-whisper-bridge.ts`: adapter para uma ponte nativa Android fornecida explicitamente pelo aplicativo. Confere o estado da biblioteca e a identidade/hash do modelo antes de transcrever.
- `src/core/device-capabilities.ts`: valida o perfil do dispositivo e os requisitos mínimos de hardware.
- `tests/whisper-execution.test.ts` e `tests/android-whisper-bridge.test.ts`: especificações automatizadas existentes para os contratos. Não foram executadas nesta etapa.

## Regras de segurança e limites atuais

1. O consentimento deve representar uma ação explícita do usuário e ter finalidade `transcription`.
2. Os tipos MIME aceitos são WAV, MPEG, MP4, OGG, WebM e FLAC.
3. O áudio é limitado a 25 MiB no núcleo; o registro também aplica o limite configurado, sem permitir ultrapassar esse teto.
4. A concorrência é controlada pelo registro de execução; o limite padrão da política é definido na criação do registro.
5. O áudio é copiado antes do processamento e a cópia de trabalho é zerada ao final, inclusive em falhas.
6. Cancelamentos são verificados antes da execução e novamente antes de publicar o resultado.
7. Os resultados são copiados para estruturas limitadas e imutáveis; segmentos, idioma, duração e tamanho do texto são validados.
8. A compatibilidade é verificada para o runtime e para os requisitos específicos do modelo.
9. A ponte Android exige que a biblioteca nativa esteja pronta e que o modelo carregado corresponda ao identificador e ao SHA-256 configurados.
10. Nenhum código deste fluxo baixa modelos, instala bibliotecas nativas ou encaminha áudio para provedores remotos.

## Runtimes previstos

- `android_embedded`: modelo e engine embarcados no aplicativo Android, através da ponte nativa.
- `desktop_local`: engine local em ambiente desktop, por adapter próprio.
- `local_service`: serviço local explicitamente configurado, sem equivaler a um provedor remoto.

Os três runtimes são contratos suportados pelo núcleo; isso não indica que existam adapters instalados para todos eles.

## Estado de implementação

| Capacidade | Estado |
|---|---|
| Contratos, validação e controle de execução | Implementados no núcleo |
| Verificação de requisitos de dispositivo | Implementada |
| Adapter TypeScript para a ponte Android | Implementado |
| Implementação JNI/NDK e biblioteca whisper.cpp | Ainda não presente neste repositório |
| Modelo local e verificação de sua distribuição/licença | Não configurados |
| Adapter Android registrado em uma aplicação executável | Não demonstrado |
| Adapters desktop e serviço local | Não configurados |
| Transcrição local ponta a ponta em dispositivo real | Não validada |

## Próxima integração necessária

A próxima etapa de produto é implementar e empacotar a ponte nativa Android no aplicativo hospedeiro, selecionar um modelo com licença e proveniência verificadas, validar seu hash e registrar o adapter somente após a aprovação de licença. A integração deve permanecer desativada quando biblioteca, modelo, compatibilidade ou consentimento estiverem ausentes.

Não habilitar download automático, processamento remoto ou fallback pago como atalho para contornar a ausência do motor local.
