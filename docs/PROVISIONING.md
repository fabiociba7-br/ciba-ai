# Preparação de provisionamento — Ciba AI

Este roteiro registra o estado real da ativação e as etapas ainda pendentes. A conta deve permanecer no Workers Free para respeitar a prioridade de custo zero.

## 1. Verificações antes de provisionar

- [ ] Confirmar que a conta Cloudflare está no plano Workers Free.
- [ ] Não habilitar Workers Paid, créditos pré-pagos do AI Gateway ou qualquer fallback pago.
- [ ] Confirmar os application IDs reais de Zupi, GEIVIA e outros clientes Ciba nos respectivos projetos Android.
- [ ] Definir se haverá um painel web. Se não houver, manter `ALLOWED_ORIGINS` vazio; apps nativos não precisam de CORS.
- [ ] Confirmar que o administrador guardará o `ADMIN_TOKEN` fora do GitHub e dos APKs.

## 2. Limites gratuitos relevantes (conferir antes da ativação)

Segundo a documentação Cloudflare consultada em 15/11/2026:

| Serviço | Franquia Workers Free |
|---|---:|
| Workers AI | 10.000 Neurons por dia |
| Worker requests | 100.000 por dia |
| D1 — linhas lidas | 5 milhões por dia |
| D1 — linhas escritas | 100.000 por dia |
| D1 — armazenamento | 5 GB total |

Workers AI falha ao atingir a franquia no plano Free. No Workers Paid, o excedente de Workers AI é cobrado; não mudar para esse plano sem autorização expressa. O modelo Gemma 4 está listado a 9.091 Neurons por milhão de tokens de entrada e 27.273 por milhão de tokens de saída. Os limites internos do Ciba AI são conservadores, mas não garantem consumo máximo exato: acompanhar métricas reais após o teste controlado.

Fontes oficiais:
- [Workers AI — preços e franquia de Neurons](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers e D1 — limites e preços](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 — perguntas frequentes](https://developers.cloudflare.com/d1/reference/faq/)

## 3. Preparar os secrets de deploy

O workflow `.github/workflows/deploy.yml` faz deploy manual, depois de validar o projeto e aplicar as migrations pendentes. Ele não publica em todo push.

No repositório GitHub, abra **Settings → Secrets and variables → Actions → New repository secret** e cadastre:

- `CLOUDFLARE_API_TOKEN`: token da Cloudflare com permissão de edição do Worker existente (Workers Editor / Workers Scripts Edit) e permissão **D1 Edit** na conta que contém `ciba-ai-db`. Se o Worker ainda não existir, a primeira criação exige permissão Workers Admin; depois o token pode ser reduzido para Editor.
- `CLOUDFLARE_ACCOUNT_ID`: ID da conta Cloudflare que contém o Worker e o D1.
- `CIBA_AI_ADMIN_TOKEN`: token aleatório forte com pelo menos 32 caracteres. Ele será gravado no Worker como secret `ADMIN_TOKEN`. Não reutilize senha pessoal e não coloque esse valor no código, em variáveis públicas ou em mensagens.

O token Cloudflare deve ser limitado à conta e aos recursos necessários. A documentação oficial explica as funções Editor/Admin e as permissões de D1:
- [Cloudflare Workers — funções e permissões](https://developers.cloudflare.com/workers/authorization/)
- [Cloudflare — permissões de API](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

Depois de cadastrar os três secrets, abra **Actions → Ciba AI Deploy → Run workflow**. O fluxo executa, nesta ordem:
1. Instala as dependências e roda typecheck + testes.
2. Aplica somente as migrations D1 ainda não aplicadas.
3. Publica o Worker `ciba-ai`.
4. Configura `ADMIN_TOKEN` como secret do Worker.

O workflow é manual para impedir deploy ou alteração do banco em cada commit. Ele não altera o plano Cloudflare e não configura fallback pago.

## 4. Sequência de ativação após preparar os secrets

1. Confirmar que a conta Cloudflare está no plano Workers Free.
2. Não habilitar Workers Paid, créditos pré-pagos do AI Gateway ou qualquer fallback pago.
3. Confirmar os application IDs reais de Zupi, GEIVIA e outros clientes Ciba nos respectivos projetos Android.
4. Definir se haverá um painel web. Se não houver, manter `ALLOWED_ORIGINS` vazio; apps nativos não precisam de CORS.
5. Confirmar que o administrador guardará o `ADMIN_TOKEN` fora do GitHub e dos APKs.
6. Executar o workflow manual **Ciba AI Deploy**. O D1 remoto `ciba-ai-db` já existe; não o recriar.
7. Substituir `ALLOWED_APP_IDS` pelos application IDs confirmados. Não inventar IDs.
8. Cadastrar os apps em `POST /v1/admin/apps`, emitir convites individuais e testar cadastro de dispositivo e uma chamada de IA.
9. Conferir consumo de Neurons, métricas D1, erros e limites antes de liberar qualquer APK.

## 4. Controles de interrupção

- Para pausar inferência sem novo deploy, configurar `ai_enabled=false` ou `maintenance_mode=true` pela API administrativa.
- Se Workers AI retornar limite excedido, não migrar automaticamente para plano pago nem trocar para outro provedor.
- Se D1 atingir o limite gratuito, interromper novas tentativas automáticas e aguardar a renovação da franquia ou decidir conscientemente uma mudança de plano.
- Se o modelo sair da lista gratuita ou for descontinuado, manter a IA desabilitada até revisão técnica e de custos.

## 5. Estado atual

- Código e migrations estão no repositório.
- D1 remoto `ciba-ai-db` criado; ID real configurado em `wrangler.toml`.
- Migrations remotas ainda precisam ser aplicadas.
- `ADMIN_TOKEN` ainda não foi configurado.
- IDs Android permitidos ainda não foram confirmados.
- Worker ainda não foi publicado.
- O workflow atual do GitHub Actions falha antes de iniciar o runner (job sem runner atribuído); ainda não há resultado válido de typecheck/testes nem deploy automático.
- Nenhuma inferência real foi executada pela conta Cloudflare.

Portanto, o Ciba AI está preparado em código e tem o D1 provisionado, mas ainda não está online nem pronto para receber usuários.
