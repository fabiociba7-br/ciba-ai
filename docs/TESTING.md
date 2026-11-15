# Testes

O projeto usa Vitest com a integração oficial da Cloudflare para executar o Worker em um runtime local compatível com Workers.

## Executar

```bash
npm install
npm run check
```

Ou executar somente os testes:

```bash
npm test
```

## Ambiente isolado

Os testes usam `wrangler.test.toml`, separado da configuração de deploy:

- D1 é executado localmente pelo simulador;
- as migrations de `migrations/` são aplicadas automaticamente antes dos testes;
- `ADMIN_TOKEN` é um valor exclusivo de teste;
- não há binding Workers AI no ambiente de teste;
- nenhuma chamada real de inferência é feita;
- não é necessário token ou conta Cloudflare para rodar a suíte.

O teste de cotas força uma configuração de modelo inválida diretamente no D1 local. Assim, a primeira chamada consome a cota e para antes da inferência; a chamada seguinte comprova que o limite diário bloqueia o dispositivo.

## Cobertura atual

- criação e autorização de aplicativo;
- criação de convite administrativo;
- cadastro de dispositivo com convite;
- rejeição da reutilização do convite;
- revogação do dispositivo e bloqueio do token;
- reserva atômica de cota diária e rejeição de excedente;
- status de prontidão degradado quando o modelo não é permitido;
- ocultação de modelos fora da allowlist em `/v1/models`;
- configuração pública coerente com o estado real da IA.

Os testes não substituem o teste de integração com Workers AI real, que só será feito depois do provisionamento Cloudflare e com autorização explícita para usar a conta.
