# Síntese de voz da Garcia

## Estado atual

- A saída falada do aplicativo Android utiliza o mecanismo `TextToSpeech` do próprio sistema.
- A seleção de voz prioriza português do Brasil e vozes que funcionam offline.
- A limpeza de Markdown acontece antes da síntese, sem alterar a mensagem exibida no chat.
- A clonagem de voz está temporariamente desativada enquanto um novo motor é escolhido e avaliado.
- O reconhecimento de fala permanece independente da síntese e utiliza o fluxo local Whisper/Android já existente.

## Próxima etapa: novo motor de voz

Nenhum motor de clonagem está selecionado ou integrado neste momento. Antes de implementar outro, registrar:

1. Repositório e versão exata do código.
2. Licença do código e dos pesos, avaliadas separadamente.
3. Idiomas efetivamente testados, incluindo português brasileiro.
4. Requisitos de RAM, VRAM, CPU/GPU e armazenamento.
5. Latência de inicialização e geração.
6. Forma de execução e disponibilidade do ambiente.
7. Política de consentimento, armazenamento e exclusão das referências de voz.

A integração deve ser isolada atrás de uma interface de motor, sem acoplar o aplicativo a um fornecedor ou modelo específico. O TTS do Android permanece disponível como saída de contingência explícita, não como indicação de que a clonagem está ativa.

## Privacidade

- Não enviar gravações de referência ou perfis de voz ao Worker sem decisão explícita.
- Exigir autorização do titular da voz antes de criar um perfil.
- Manter credenciais e amostras fora do repositório.
- Validar a exclusão efetiva dos arquivos e caches quando um perfil for removido.
