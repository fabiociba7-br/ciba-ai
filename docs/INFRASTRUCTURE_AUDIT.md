# Auditoria de infraestrutura — 2026-11-19

## Resultado executivo

**Decisão: não criar servidores adicionais nesta etapa.** A infraestrutura atual já usa Cloudflare Workers, que escala automaticamente na rede global. Duplicar Workers ou criar outro backend agora aumentaria a superfície operacional sem remover o principal gargalo potencial: a franquia diária de inferência do Workers AI.

A estratégia recomendada é manter um único gateway Ciba AI, um D1 central e limites internos conservadores. GEIVIA permanece como executor independente, a ser conectado por API quando a etapa de integração chegar.

## Estado confirmado em produção

Evidências verificadas no workflow de deploy concluído em 2026-11-19:

- Worker `ciba-ai` publicado em `https://ciba-ai.fabiociba7.workers.dev`.
- Binding D1 `ciba-ai-db` e binding Workers AI presentes no deploy.
- Health check `/v1/status` retornou sucesso: serviço pronto, banco conectado e IA habilitada.
- Todas as migrations versionadas até o momento estavam aplicadas: Wrangler informou `No migrations to apply`.
- O banco tinha `327680` bytes (aproximadamente 320 KiB) no momento da consulta de deploy.
- As duas consultas de inspeção de registros privados no deploy leram 6 e 4 linhas, respectivamente. Esses números são apenas das consultas do workflow, não representam o consumo diário total.
- Upload do Worker: 368,04 KiB (73,33 KiB gzip); inicialização informada: 2 ms.
- Um Cron Trigger está configurado: `17 3 * * *` (03:17 UTC).
- O backend permanece com um único modelo configurado: `@cf/google/gemma-4-26b-a4b-it`.

## Limites gratuitos relevantes

Valores consultados na documentação oficial da Cloudflare em 2026-11-19. São limites publicados do plano Free, não uma leitura do plano efetivamente contratado na conta:

| Serviço | Franquia Free publicada | Situação no projeto |
|---|---:|---|
| Workers | 100.000 requisições/dia | Limite interno do Ciba AI é muito menor |
| Workers CPU | 10 ms por invocação HTTP | Worker teve inicialização de 2 ms no deploy; isso não mede CPU por requisição |
| Workers AI | 10.000 Neurons/dia | Principal limite potencial para inferência |
| D1 — leituras | 5 milhões de linhas/dia | Banco observado com cerca de 320 KiB |
| D1 — gravações | 100.000 linhas/dia | Consumo diário real ainda não medido |
| D1 — armazenamento | 5 GB no total da conta; 500 MB por banco Free | Banco observado muito abaixo do limite |

Referências oficiais:
- Workers: https://developers.cloudflare.com/workers/platform/limits/
- Workers AI: https://developers.cloudflare.com/workers-ai/platform/pricing/
- D1: https://developers.cloudflare.com/d1/platform/pricing/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/

A documentação de Workers AI confirma que a franquia gratuita é de 10.000 Neurons por dia e que excedê-la no plano Free faz novas inferências falharem; o plano Paid começa em US$ 5/mês e o excedente pode ser cobrado. Portanto, **não ativar Workers Paid, créditos pré-pagos ou fallback com cobrança**.

## Limites internos atuais do Ciba AI

O backend aplica tetos conservadores, independentes das cotas da Cloudflare:

- 50 requisições globais por dia;
- 25 por aplicativo por dia;
- 10 por dispositivo por dia;
- 12 chamadas por minuto por dispositivo;
- 512 tokens de saída;
- 1.500 caracteres por mensagem e 3.000 por requisição.

Esses tetos reduzem risco, mas não equivalem a um medidor de Neurons. A relação entre chamadas e consumo varia conforme tokens de entrada/saída e o modelo. O consumo real deve ser acompanhado no painel Workers AI.

## O que ainda não foi possível confirmar

A integração GitHub usada para esta auditoria não expõe métricas privadas da conta Cloudflare. Assim, não foi possível confirmar:

1. Se a conta Cloudflare está efetivamente no plano Workers Free.
2. O consumo diário/mensal real de Neurons.
3. O total diário de requisições do Worker.
4. As métricas diárias de linhas lidas/escritas do D1.
5. Alertas de uso e eventuais limites de gastos configurados na conta.

O deploy bem-sucedido confirma publicação e saúde naquele instante, mas não substitui essas métricas.

## Arquitetura recomendada para expansão sem custo

1. **Gateway único:** manter Ciba AI como ponto central de autenticação, autorização, cotas e roteamento.
2. **Escala automática:** aproveitar a distribuição global do Workers; não clonar o Worker para tentar aumentar capacidade.
3. **Banco central:** manter D1 enquanto os dados e métricas estiverem confortavelmente dentro das cotas Free.
4. **Inferência protegida:** manter o modelo aprovado e os limites atuais; sem ensemble, múltiplas inferências ou fallback automático em produção.
5. **Executor separado:** GEIVIA continua independente e executa tarefas de terminal, build e deploy mediante API autenticada. Não transferir execução de código arbitrário para o Worker.
6. **Escala orientada por métricas:** só introduzir filas, Durable Objects, bancos adicionais ou runtimes locais quando uma necessidade observada justificar a complexidade e a solução continuar dentro do orçamento zero.

## Próximo trabalho técnico

Antes de expandir capacidade, implementar observabilidade operacional de baixo custo: registrar contadores agregados de requisições, erros, latência, limites internos e consumo de D1 sem armazenar prompts ou respostas. Expor uma visão administrativa protegida e alertas quando os limites internos se aproximarem do teto.

O medidor de Neurons deve continuar sendo obtido da área de Workers AI da Cloudflare; não estimar esse valor a partir do número de chamadas. Não adicionar cron triggers ou workflows redundantes para monitoramento.

## Restrições preservadas

- Nenhum serviço pago foi ativado nesta auditoria.
- Nenhum APK foi gerado.
- A chave e a configuração de assinatura Android não foram alteradas.
- Nenhuma migration ou configuração de produção foi modificada.
- Trabalho e documentação permanecem na branch `main`.
