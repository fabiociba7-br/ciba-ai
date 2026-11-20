# Laboratório VoxCPM2 da Garcia — Kaggle

## Objetivo

Preparar o primeiro teste de clonagem/síntese de voz da Garcia fora do Android, usando VoxCPM2 em um notebook Kaggle com GPU. Esta entrega é um laboratório manual: não conecta automaticamente o Kaggle à Garcia e não publica áudio no backend.

## Estado desta etapa

- Notebook versionado em `notebooks/voxcpm2_kaggle_lab.ipynb`.
- Modelo de referência: `openbmb/VoxCPM2`.
- Instalação: pacote oficial `voxcpm`.
- Entrada: áudio próprio ou com consentimento explícito, adicionado como Dataset privado do Kaggle.
- Pré-processamento: mono, 16 kHz.
- Saída: WAV no diretório `/kaggle/working`, com sample rate retornado pelo modelo.
- Não há tokens, chaves, credenciais ou endpoints secretos no notebook.
- Nenhum áudio de referência é enviado para um serviço de terceiros além do ambiente Kaggle escolhido pelo proprietário.

## Como executar

1. Abra o notebook no Kaggle usando **New Notebook → Import Notebook** e selecione este arquivo.
2. Em **Settings → Accelerator**, selecione GPU, se houver quota disponível.
3. Adicione um Dataset **privado** com o WAV de referência autorizado.
4. Edite `REFERENCE_AUDIO` e `TEXT_TO_SPEAK` na célula de configuração.
5. Execute as células em ordem.
6. Ouça o WAV gerado e baixe-o pela área Output do Kaggle.

Se quiser o modo de clonagem de maior fidelidade, preencha `REFERENCE_TRANSCRIPT` com a transcrição exata da amostra. Caso contrário, deixe vazio para usar clonagem controlável com a referência de áudio.

## Requisitos e limites

- O projeto oficial informa Python 3.10 a 3.12, PyTorch 2.5+ e CUDA 12+ para o caminho GPU. O runtime efetivo do Kaggle pode variar; a célula inicial verifica CUDA e memória disponível.
- VoxCPM2 tem 2B parâmetros. Não se presume que qualquer GPU gratuita do Kaggle tenha VRAM suficiente; falha de memória deve ser registrada como limitação do ambiente, não contornada por mecanismos não oficiais.
- O cartão oficial do modelo declara 30 idiomas, incluindo português, e licença Apache-2.0 para o modelo/código. Qualidade específica em PT-BR precisa ser avaliada com áudio real.
- O modelo proíbe usos de impersonação, fraude ou desinformação. Usar somente voz própria ou com autorização expressa e identificar conteúdo sintético quando compartilhado.
- A saída é experimental e ainda não é um motor TTS integrado à Garcia.

## Próxima etapa técnica

Depois de validar o notebook e a qualidade em PT-BR, implementar um adaptador de laboratório remoto por API autenticada. A integração deverá receber apenas referências de arquivos e texto, manter segredos no backend, validar consentimento, controlar quotas e custos, produzir artefatos com hash e permitir encaminhamento para armazenamento configurado. Não automatizar interface do Colab nem contornar limites do Kaggle.
