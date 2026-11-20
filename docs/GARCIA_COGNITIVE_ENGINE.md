# Garcia Cognitive Engine

O pacote Python `garcia_research` agora expõe uma camada opcional de orquestração RAG com validação iterativa. O código permanece no pacote existente porque esta branch não contém o caminho antigo `src/ciba/ai/`; `src/` é o backend Cloudflare Worker em TypeScript.

## Fluxo

1. O `Retriever` recupera evidências para a consulta atual.
2. O engine converte o resultado em texto JSON, remove caracteres de controle, neutraliza padrões comuns de instruções maliciosas, escapa delimitadores XML e limita o contexto a `max_context_chars`.
3. A política fica na mensagem `system`; consulta e contexto delimitado ficam na mensagem `user`. O contexto não confiável é escapado e rotulado como evidência, nunca como instrução.
4. A saída JSON é validada: resposta não vazia, confiança mínima 0.70, menos de três lacunas e fontes citadas presentes nos títulos recuperados.
5. Se falhar, o engine refina a consulta com as lacunas e repete até `max_iterations` (padrão 2).
6. Falhas transitórias de LLM usam retry exponencial com jitter. Três falhas consecutivas abrem o circuit breaker por 30 segundos. O cliente DuckDuckGo também faz retry e respeita respostas de bloqueio; CAPTCHA/403/429 não são contornados.

## Contrato de resposta

O método `generate_robust` retorna sempre os cinco campos:

- `raciocinio`: justificativa técnica curta, verificável e voltada ao usuário; não contém cadeia privada de pensamento.
- `resposta`: resposta final.
- `fontes`: títulos que correspondem às fontes recuperadas.
- `confianca`: número entre 0 e 1.
- `lacunas`: fatos ausentes ou questões não resolvidas.

Quando a validação final falha, a confiança é limitada a 0.69 e a justificativa informa que o resultado é inconclusivo. Falhas operacionais retornam o mesmo contrato com confiança 0.

## Uso

```python
from garcia_research import (
    EngineConfig,
    GarciaEngine,
    GarciaResearchService,
    OpenAIAdapter,
    ResearchConfig,
)

retriever = GarciaResearchService(ResearchConfig())
engine = GarciaEngine(
    llm_provider=OpenAIAdapter(),
    retriever=retriever,
    config=EngineConfig(max_iterations=2, max_context_chars=18_000),
)

try:
    result = engine.generate_robust(
        "OAuth2 security architecture",
        depth="deep",
        focus=["PKCE", "redirect URI validation"],
    )
    print(result)
finally:
    retriever.close()
```

Configure `OPENAI_API_KEY` no ambiente antes de instanciar `OpenAIAdapter`. Para outro modelo, implemente `generate(prompt) -> str`. Para manter a separação real de papéis, implemente também `generate_messages(messages) -> str` e, se houver streaming, `generate_stream_messages(messages)`. Providers legados que só aceitam uma string usam um caminho de compatibilidade que concatena os papéis; prefira a interface de mensagens em produção. O `LocalPromptAdapter` retorna explicitamente baixa confiança, pois não simula inferência semântica.

## Streaming

`generate_stream` retorna eventos `StreamEvent`:

- `token`: fragmento provisório emitido pelo provider.
- `reset`: a tentativa foi rejeitada e a interface deve limpar o rascunho antes da próxima iteração.
- `final`: objeto validado no contrato acima.
- `error`: erro de fluxo; um evento `final` estruturado acompanha falhas operacionais.

Tokens são provisórios até o evento `final`. Isso permite correção automática sem apresentar uma tentativa inválida como resposta definitiva.

```python
for event in engine.generate_stream("OAuth2 security"):
    if event.event == "token":
        print(event.data, end="", flush=True)
    elif event.event == "reset":
        print("\\n[refinando consulta]")
    elif event.event == "final":
        final_result = event.data
```

## Segurança: limites reais

A proteção é em camadas, não uma promessa de imunidade absoluta. XML escaping evita que conteúdo recuperado feche os delimitadores; padrões comuns de prompt injection são neutralizados; o prompt classifica todo o contexto como dado não confiável; fontes são verificadas contra a recuperação; e saídas passam por validação de tipos e limites. Ataques semânticos novos ainda podem influenciar modelos. Para ferramentas com efeitos colaterais, mantenha autorização e aprovação fora do LLM, valide argumentos no servidor e nunca trate texto recuperado como permissão para executar ações.

O campo `raciocinio` é deliberadamente uma justificativa resumida baseada em evidências, não uma transcrição de raciocínio interno do modelo.

## Integração com o fluxo da Garcia e limite de runtime

O pacote agora oferece `GarciaResearchAssistant` como fachada única para o fluxo Python local. Ela compõe o serviço de recuperação com o motor cognitivo e expõe `ask()`, `stream()` e encerramento de recursos. Isso integra recuperação, geração, validação e refinamento em uma API simples para ferramentas locais, testes e avaliação.

```python
from garcia_research import GarciaResearchAssistant, OpenAIAdapter

with GarciaResearchAssistant(OpenAIAdapter()) as garcia:
    result = garcia.ask(
        "OAuth2 security architecture",
        depth="deep",
        focus=["PKCE", "redirect URI validation"],
    )
    print(result)
```

**Importante:** esta fachada não é importada pelo Cloudflare Worker. O runtime de produção continua sendo TypeScript/Cloudflare Workers AI, com pesquisa nativa em `src/services/research`. O pacote Python é opcional e local. Não existe chamada RPC ou serviço Python remoto nesta etapa; criar uma ponte desse tipo exigiria um contrato HTTP autenticado, limites de rede/tempo, observabilidade e aprovação arquitetural próprios. Essa separação evita tentar executar dependências Python incompatíveis dentro do Worker e evita duas implementações concorrentes do fluxo de produção.

## Testes adversariais

A suíte `tests/python/test_adversarial.py` verifica fechamento de delimitadores XML, falsificação de papéis, diretivas de ferramentas injetadas em fontes, tentativa de escape pela consulta, orçamento após escaping, caracteres de controle e títulos de fontes inventados. Esses testes são regressões determinísticas com entradas controladas; não comprovam imunidade contra ataques semânticos desconhecidos nem substituem avaliação com modelos reais.
