# Garcia — arquitetura de armazenamento escalável

Status: plano técnico aprovado para implementação na branch `feature/garcia-autonomous-intelligence`.
Escopo: armazenamento de conhecimento técnico e pesquisas da Garcia. Não inclui memória pessoal privada, voz, GEIVIA, APK ou deploy.

## Decisão

Não criar três cópias ativas do mesmo banco. Distribuir por função, com identificadores globais, escrita idempotente, trilha de sincronização e recuperação testada.

1. **Cloudflare D1 — banco operacional primário**
   - Manter autenticação, identidade, configurações, índices e conhecimento recente.
   - Quota Free consultada em 18/11/2026: até 500 MB por banco, 5 GB de armazenamento agregado na conta, até 10 bancos, 50 subrequests de leitura por invocação e Time Travel de 7 dias.
   - É o banco existente; não criar outro D1 agora.

2. **Turso — primeiro banco SQL externo / expansão**
   - SQLite/libSQL, próximo do modelo atual do D1 e acessível por HTTP.
   - Free consultado em 18/11/2026: até 100 bancos, 5 GB de armazenamento, 500 milhões de linhas lidas/mês, 10 milhões escritas/mês e 3 GB de sync/mês.
   - Destino inicial para pesquisas antigas, fontes e registros de aprendizagem arquivados quando os limites operacionais do D1 se aproximarem.
   - Não ativar overages automáticos; alertar e interromper a expansão antes de qualquer cobrança.

3. **Neon — terceiro banco, reserva de expansão analítica**
   - PostgreSQL gerenciado, útil quando a Garcia precisar de consultas relacionais mais complexas, análises e isolamento de grandes conjuntos.
   - Free consultado em 18/11/2026: até 100 projetos, 1 GB por projeto (até 20 GB no total da conta), 100 CU-horas por projeto/mês, 5 GB de transferência pública por projeto/mês e escala a zero após inatividade.
   - Não será dependência obrigatória no primeiro corte. Preparar adaptador PostgreSQL e ativar somente se Turso também se aproximar dos limites ou se houver necessidade real de PostgreSQL.

4. **Cloudflare R2 — cópia de segurança de objetos, não banco SQL**
   - Guardar snapshots compactados, exportações versionadas e pacotes de recuperação.
   - Free consultado em 18/11/2026: 10 GB-mês, 1 milhão de operações Classe A e 10 milhões Classe B por mês; sem cobrança de egress.
   - Como está no mesmo provedor Cloudflare, não substitui uma cópia externa independente. Snapshots críticos também devem poder ser exportados para armazenamento fora da Cloudflare.

## Regras de arquitetura

- D1 continua sendo a fonte de verdade para identidade, permissões, roteamento e metadados de localização.
- Cada registro recebe ID global estável, versão, data de criação/alteração, hash de conteúdo e estado de sincronização.
- Particionamento por função e idade: dados operacionais recentes em D1; arquivo de pesquisa e evidências históricas em Turso; conjuntos analíticos ou especializados em Neon quando ativado.
- Não fazer escrita dupla síncrona em vários provedores na mesma requisição. Usar outbox durável em D1, consumidor idempotente, tentativas limitadas e reconciliação.
- O sistema deve continuar funcionando se um provedor secundário estiver indisponível; nesse caso, manter fila local em D1 e alertar sobre o atraso.
- Não mover dados pessoais/privados do proprietário para a base técnica compartilhável da Garcia. Respeitar owner/app scope.
- Nunca armazenar tokens, chaves, credenciais, respostas brutas desnecessárias ou dados pessoais nas pesquisas arquivadas.
- Sem cobrança automática: verificar limites e configurações de overage antes de habilitar cada provedor.

## Gatilhos de expansão

- Aviso preventivo a 70% da quota gratuita mensal ou de armazenamento.
- Preparar expansão/migração a 80%.
- Parar novas gravações não essenciais no provedor saturado a 90%, preservando autenticação, segurança, outbox e dados críticos.
- Medir armazenamento, leituras, gravações, transferência, compute, falhas, atraso da fila e último backup.
- Não iniciar migração automática apenas por quota projetada: exigir validação de destino, espaço disponível, integridade e plano de rollback.

## Etapas de implementação

### Etapa 1 — fundação no repositório
- Criar interfaces independentes do fornecedor para conhecimento, eventos de pesquisa, arquivo e snapshots.
- Criar tabela de outbox e estado de sincronização no D1.
- Implementar métricas de quota e alertas em nível de aplicação.
- Testar isolamento de owner/app, idempotência, reprocessamento e indisponibilidade do destino.

### Etapa 2 — Turso
- Criar conta/banco gratuito e guardar URL e token somente como secrets do Worker.
- Criar schema compatível e adaptador libSQL/HTTP.
- Fazer migração de teste com dados sintéticos, comparar contagens e hashes, validar leituras e escrita.
- Habilitar arquivo de pesquisas por lote, inicialmente em modo sombra; depois ativar leitura com fallback.
- Testar indisponibilidade, retomada da fila, duplicatas e rollback.

### Etapa 3 — R2
- Criar bucket privado, sem acesso público.
- Gerar snapshots compactados e versionados, com manifesto, hash e metadados.
- Testar restauração em banco isolado e verificar integridade antes de marcar backup como válido.
- Manter retenção limitada e alertas de quota.

### Etapa 4 — Neon
- Criar projeto gratuito somente quando houver necessidade mensurável.
- Guardar connection string como secret; usar driver compatível com Workers/HTTP ou conexão serverless adequada.
- Criar schema PostgreSQL e adaptador isolado.
- Migrar somente dados analíticos/especializados, sem tornar Neon requisito para a operação principal.
- Validar limites de compute, armazenamento e transferência; desligar/arquivar projetos não usados.

### Etapa 5 — operação e governança
- Painel interno de uso e saúde dos provedores.
- Testes periódicos de restauração e reconciliação.
- Relatório de quota antes de qualquer ativação de outro provedor.
- Nunca fazer deploy, migração remota ou habilitar serviço pago sem autorização explícita.

## Fontes oficiais consultadas

- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Turso pricing: https://turso.tech/pricing
- Neon free plan quotas: https://neon.com/docs/introduction/plans
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Supabase foi avaliado, mas não selecionado: 500 MB por projeto e pausa após uma semana de inatividade; é redundante para esta arquitetura neste momento.
- MongoDB Atlas Free foi avaliado, mas não selecionado: modelo documental não oferece vantagem sobre os bancos SQL escolhidos para o schema atual.
