# Seleção e incorporação de projetos open source

## Critérios obrigatórios

1. Licença compatível com uso e distribuição pretendidos.
2. Atividade e manutenção verificáveis.
3. Dependências e superfície de ataque aceitáveis.
4. Execução compatível com Cloudflare Workers ou serviço separado.
5. Benefício concreto frente a uma implementação menor.
6. Custos e requisitos de memória/GPU conhecidos.
7. Possibilidade de desligar ou substituir cada componente.

## Estratégia

Não importar repositórios completos indiscriminadamente. O Ciba AI mantém um núcleo próprio e integra componentes por adapters. Frameworks Python de agentes podem ser úteis em um serviço futuro, mas não devem ser empacotados no Worker TypeScript.

## Matriz inicial

| Projeto | Uso potencial | Compatibilidade com Worker | Situação |
|---|---|---|---|
| LangGraph | Orquestração com estado e checkpoints | Baixa como runtime direto; conceitos portáveis | Referência arquitetural |
| CrewAI | Times de agentes Python | Baixa como runtime direto | Referência arquitetural |
| Ollama | Servir modelos locais | Não roda dentro do Worker | Adapter compatível preparado; endpoint ainda não configurado |
| LiteLLM | Gateway multi-provider | Serviço separado; adiciona operação | Contrato interno mais leve adotado |
| Hugging Face | Descoberta de modelos, tokenizers e datasets | Catálogo externo; modelos exigem runtime compatível | Fonte de avaliação, não dependência runtime |

## Regras de incorporação

- Não copiar código sem registrar origem, versão, licença e modificações.
- Preferir dependências pequenas e APIs estáveis.
- Fixar versões e revisar avisos de segurança.
- Não incorporar pesos de modelos ao repositório Git.
- Não presumir que open source significa licença permissiva ou uso comercial irrestrito.
- Não executar código de terceiros sem sandbox e revisão.
- Não habilitar provider que possa cobrar sem configuração e autorização explícitas.
