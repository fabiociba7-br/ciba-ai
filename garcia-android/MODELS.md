# Garcia Android — modelos locais

## Reconhecimento de voz

### Parakeet TDT 0.6B v3 ajustado para português brasileiro
- Identificador: `joaorura/parakeet-tdt-0.6b-v3-ptBR-sherpa-onnx-int8`
- Runtime: Sherpa-ONNX Android 2.0.1
- Formato: NeMo Transducer (encoder, decoder, joiner e tokens)
- Tamanho publicado: 670.576.792 bytes (aprox. 640 MiB)
- Instalação: download sob demanda, fora do APK; cada arquivo é validado por SHA-256.
- Licença dos pesos: CC-BY-4.0. Manter atribuição à NVIDIA, ao fine-tune de Alexandre A. C. F. e ao conversor/empacotador João Rura, além da referência ao dataset TAGARELA.
- Fonte: https://huggingface.co/joaorura/parakeet-tdt-0.6b-v3-ptBR-sherpa-onnx-int8
- Limitação: reconhecimento offline por turno; não produz transcrição parcial em streaming. O model card informa que ainda não há avaliação formal de WER em fala humana.

### Whisper tiny quantizado
- Modelo: `ggml-tiny-q5_1.bin`
- Tamanho aproximado: 32 MB
- Download sob demanda e verificação SHA-256 pela implementação Whisper existente.
- Fonte: https://huggingface.co/ggerganov/whisper.cpp
- Uso: alternativa local caso o Parakeet não esteja instalado ou não carregue.

## Runtime
- Sherpa-ONNX: Apache-2.0 — https://github.com/k2-fsa/sherpa-onnx
- Os pesos de cada modelo têm licença própria; a licença do runtime não substitui a licença dos pesos.

## Privacidade e recursos
- Os arquivos ficam no armazenamento privado do aplicativo.
- O áudio é capturado por `AudioRecord`, processado localmente e apagado da memória após a transcrição.
- O modelo não é enviado ao Ciba AI Worker.
- O Parakeet requer aproximadamente 640 MiB para os arquivos, além de espaço temporário e memória RAM adicional durante a inferência. O desempenho e o consumo precisam ser medidos em aparelho físico antes de considerá-lo o padrão recomendado.
