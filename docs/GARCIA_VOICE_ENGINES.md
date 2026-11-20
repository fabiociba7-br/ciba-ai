# Garcia — catálogo e integração dos motores de voz

## Separação de responsabilidades

- ASR (reconhecimento de fala) transforma áudio em texto. Continua separado dos motores TTS.
- TTS (síntese de fala) transforma texto em áudio.
- Clonagem usa referência de voz autorizada e é uma capacidade adicional de determinados motores TTS.

## Motores previstos

| Motor | Destino | Situação inicial | Observações |
|---|---|---|---|
| Pocket TTS | Android local | Experimental | Runtime Android comunitário precisa de auditoria; português consta entre idiomas suportados pelo projeto original. |
| NeuTTS | Android local | Experimental / idioma limitado | Protótipo Android comunitário; os modelos avaliados não incluem PT-BR atualmente. |
| VoxCPM2 | Laboratório remoto | Somente laboratório | Plano A em Kaggle/Colab com GPU; não prometer execução local Android. |
| XTTS-v2 | Laboratório remoto | Somente laboratório | Plano B; revisar licença Coqui Public Model License e qualidade PT-BR. |

## Regras de integração

- Usar contrato comum VoiceEngine, SpeechRequest e SpeechResult.
- Manter adaptadores de runtime isolados; nenhuma dependência nativa entra no app antes da auditoria de ABI, tamanho, manutenção, licença e segurança.
- Catálogo e disponibilidade do motor são estados distintos: planejado, experimental, somente laboratório, idioma limitado, instalado, pronto, erro e atualização disponível.
- Pesos e runtimes pesados são baixados sob demanda para armazenamento privado do app; nunca empacotar pesos no APK.
- Antes de download, verificar espaço livre, arquitetura suportada, versão do Android, checksum e licença.
- Permitir seleção de motor principal e reserva; fallback só quando o motor alternativo estiver instalado e compatível.
- Teste de voz deve permitir ouvir uma amostra antes de definir o motor.
- Não prometer PT-BR no NeuTTS até existir checkpoint e avaliação apropriados.
- Gravação de referência para clonagem deve ser do próprio usuário ou acompanhada de consentimento explícito; permitir apagar gravações e perfis.
- Exibir licenças e atribuições aplicáveis dentro da tela Sobre/Modelos.

## Interface planejada

Configurações → Voz e clonagem:

1. Motor principal e motor reserva.
2. Cartões por motor com finalidade, idioma, maturidade, licença, tamanho do download quando conhecido e compatibilidade do aparelho.
3. Instalar, atualizar, reparar e remover runtime/modelos individualmente.
4. Testar voz e importar/gravar referência autorizada.
5. Estado real do runtime e modelo, sem confundir cadastro no catálogo com instalação concluída.

## Primeira entrega no repositório

A primeira fatia adiciona o contrato comum e catálogo tipado. Ainda não inclui runtimes Pocket TTS/NeuTTS, inferência, download de pesos ou interface final; esses passos dependem da auditoria e dos testes em aparelho.