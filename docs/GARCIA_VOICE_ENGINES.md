# Garcia — catálogo e integração dos motores de voz

## Separação de responsabilidades

- ASR (reconhecimento de fala) transforma áudio em texto. Continua separado dos motores TTS.
- TTS (síntese de fala) transforma texto em áudio.
- Clonagem usa referência de voz autorizada e é uma capacidade adicional de determinados motores TTS.

## Motores previstos

| Motor | Destino | Situação inicial | Observações |
|---|---|---|---|
| Pocket TTS | Android local, runtime nativo dentro da Garcia | Experimental / integração nativa em andamento | Portar JNI/C++ e gerenciamento de modelos do projeto de referência v0.5.5. Pacotes de modelo separados do APK; pesos CC BY 4.0. Validar pt-BR, ARM64 e desempenho no aparelho real. |
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

## Execução em nuvem e provedores configuráveis

VoxCPM2 e XTTS-v2 serão preparados para laboratório remoto, começando por Kaggle e Google Colab. A seleção do ambiente não deve ficar fixa no código do motor: cada execução solicita ao gerenciador central uma conexão configurada e compatível, permitindo escolher entre contas/instâncias disponíveis e, futuramente, outros provedores de GPU ou servidores.

A saída de áudio, checkpoints e artefatos devem poder ser encaminhados para qualquer destino de armazenamento configurado no gerenciador central. Assim, ambiente de computação e armazenamento são recursos independentes e selecionáveis pela interface da Garcia.

Detalhes de autenticação, cadastro de novos provedores, limites de quota, operações suportadas e segurança estão em [GARCIA_CREDENTIALS_ARCHITECTURE.md](GARCIA_CREDENTIALS_ARCHITECTURE.md). Kaggle e Colab devem ser integrados por APIs/interfaces documentadas; recursos não suportados oficialmente devem permanecer assistidos/manual, sem automação frágil de interface ou contorno de limites.


## Primeira integração Android — Pocket TTS

A interface fica em Configurações → Voz e clonagem. A Garcia administra diretamente a instalação dos modelos, a gravação/importação de referências WAV, os perfis e a seleção da voz. O motor Pocket TTS é uma biblioteca nativa embarcada no próprio APK da Garcia; não há aplicativo complementar.

A Garcia chama seu adaptador `VoiceEngine` diretamente por Kotlin/JNI/C++, recebendo PCM para o subsistema de áudio interno. Modelos e gravações ficam no armazenamento privado da Garcia, fora do APK, e são gerenciados pela própria interface.

A integração está marcada como experimental. A referência lista pacote português e clonagem WAV, mas isso não comprova qualidade pt-BR. É obrigatório validar síntese, clonagem, funcionamento sem rede, consumo de memória e estabilidade no aparelho real. A primeira versão nativa terá ABI arm64-v8a; x86_64 não será declarado até validação.

Ver arquitetura nativa, licenças, limites e gates em [POCKET_TTS_ANDROID_AUDIT.md](POCKET_TTS_ANDROID_AUDIT.md).
