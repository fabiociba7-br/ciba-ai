export const GARCIA_DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#101827">
<title>Garcia · Painel privado</title>
<style>
:root{color-scheme:dark;--bg:#0b1220;--panel:#121d2e;--panel2:#18263a;--line:#293950;--muted:#9aabc0;--text:#edf4ff;--accent:#79aaff;--good:#5bd6a0;--warn:#f3c66d;--bad:#ff8181}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 10% 0%,#1b3150 0,transparent 42%),var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{padding:24px max(20px,calc((100% - 1180px)/2));border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:12px}.mark{width:42px;height:42px;border-radius:14px;background:linear-gradient(145deg,#8bb7ff,#456ed0);display:grid;place-items:center;color:#071323;font-weight:900;font-size:22px}.brand h1{font-size:20px;margin:0}.brand p{margin:0;color:var(--muted);font-size:12px}
main{max-width:1180px;margin:28px auto;padding:0 20px 48px}.top{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:22px}.top h2{margin:0;font-size:26px}.muted{color:var(--muted)}.small{font-size:12px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.panel{background:linear-gradient(160deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;padding:18px;min-width:0}.metric{font-size:24px;font-weight:750;margin-top:7px;overflow-wrap:anywhere}.metric-label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}.panel h3{margin:0 0 14px;font-size:16px}.rowline{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}.rowline:first-of-type{border-top:0}.rowline strong{display:block}.rowline small{color:var(--muted);display:block;overflow-wrap:anywhere}
.pill{display:inline-flex;padding:4px 9px;border-radius:999px;background:#26364b;color:#d8e7ff;font-size:11px}.pill.good{background:#123d34;color:#8df0c2}.pill.warn{background:#4b391a;color:#ffdb8e}.pill.bad{background:#4a252b;color:#ffaaaa}
button,input,select{font:inherit;border-radius:10px;border:1px solid var(--line);padding:10px 12px;background:#0c1727;color:var(--text);max-width:100%}button{cursor:pointer;background:#315c9c;border-color:#4778bd;font-weight:650}button.secondary{background:#1a2a40;border-color:var(--line)}button.danger{background:#542b35;border-color:#81404d}button:disabled{opacity:.5;cursor:not-allowed}
input,select{width:100%}label{display:block;color:var(--muted);font-size:12px;margin:10px 0 5px}.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.switchrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}.switchrow input{width:20px;height:20px;accent-color:#75a8ff}
#login{max-width:460px;margin:70px auto}.notice{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#17263a;color:var(--muted);margin:12px 0}#message{min-height:24px;color:var(--warn);margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px 8px;border-top:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}.tablewrap{overflow:auto}
#app{display:none}.footer{color:var(--muted);text-align:center;font-size:12px;padding:24px}
@media(max-width:850px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr}}
@media(max-width:520px){header{padding:16px 18px}.top{align-items:start;flex-direction:column}.grid{gap:9px}.panel{padding:14px}.formgrid{grid-template-columns:1fr}.metric{font-size:20px}main{padding-left:14px;padding-right:14px}}
</style>
</head>
<body>
<header><div class="brand"><div class="mark">G</div><div><h1>Garcia</h1><p>Inteligência privada · Painel de controle</p></div></div><button id="logout" class="secondary" style="display:none">Sair</button></header>
<main>
<section id="login" class="panel">
<h2 style="margin:0 0 6px">Acesso privado</h2><p class="muted">Entre com o token de um dispositivo já pareado ao seu proprietário.</p>
<label for="token">Token do dispositivo</label><input id="token" type="password" autocomplete="off" placeholder="Cole seu token de acesso">
<div class="actions"><button id="connect">Conectar ao Garcia</button></div><div id="message" role="status"></div>
<p class="small muted">O token permanece somente na memória desta página e é descartado ao sair ou fechar a aba. Use HTTPS.</p>
</section>
<section id="app">
<div class="top"><div><h2>Visão geral</h2><div class="muted small" id="updated">Conecte para carregar o estado atual.</div></div><button id="refresh" class="secondary">Atualizar dados</button></div>
<div class="grid">
<div class="panel"><div class="metric-label">Inteligência</div><div class="metric" id="ai-state">—</div><div class="small muted" id="ai-mode">—</div></div>
<div class="panel"><div class="metric-label">Modelo ativo</div><div class="metric" style="font-size:15px" id="model">—</div><div class="small muted" id="provider">—</div></div>
<div class="panel"><div class="metric-label">Aplicativos conectados</div><div class="metric" id="apps-count">—</div><div class="small muted">Com dispositivos vinculados</div></div>
<div class="panel"><div class="metric-label">Dispositivos ativos</div><div class="metric" id="devices-count">—</div><div class="small muted">No proprietário atual</div></div>
</div>
<div class="columns">
<section class="panel"><h3>Capacidades privadas</h3>
<div class="switchrow"><div><strong>Memória privada</strong><div class="small muted">Armazenamento curado e controlado</div></div><input id="memory" type="checkbox" aria-label="Ativar memória privada"></div>
<div class="switchrow"><div><strong>Comunicação entre apps</strong><div class="small muted">Mensagens entre aplicativos autorizados</div></div><input id="messaging" type="checkbox" aria-label="Ativar comunicação entre aplicativos"></div>
<div class="actions"><button id="save-settings">Salvar controles</button></div>
<div class="notice small">Os controles começam desligados. Desativar bloqueia o uso, mas não apaga dados nem revoga permissões existentes.</div>
</section>
<section class="panel"><h3>Estado técnico</h3>
<div class="rowline"><span>Execução multi-modelo</span><span class="pill warn">Desativada</span></div>
<div class="rowline"><span>Ferramentas externas</span><span class="pill warn">Desativadas</span></div>
<div class="rowline"><span>Agentes especialistas</span><strong id="agents-count">—</strong></div>
<div class="rowline"><span>Modo de manutenção</span><strong id="maintenance">—</strong></div>
<div class="rowline"><span>Limites de uso</span><strong id="limits">—</strong></div>
</section>
</div>
<section class="panel" style="margin-bottom:16px">
<h3>Gerenciar memórias</h3>
<p class="small muted">Pesquise, revise, corrija ou exclua memórias curadas. A memória central exige permissão específica para este dispositivo/app.</p>
<div class="formgrid">
<div><label for="memory-scope">Escopo</label><select id="memory-scope"><option value="app">Memória deste app</option><option value="owner">Memória central do proprietário</option></select></div>
<div><label for="memory-search">Pesquisar por chave ou conteúdo</label><input id="memory-search" type="search" maxlength="100" placeholder="Ex.: preferências, música"></div>
</div>
<div class="switchrow"><div><strong>Incluir memórias expiradas</strong><div class="small muted">Permite revisar e renovar a validade.</div></div><input id="memory-expired" type="checkbox" aria-label="Incluir memórias expiradas"></div>
<div class="actions"><button id="memory-search-button" class="secondary">Pesquisar memórias</button></div>
<div id="memory-list" class="muted small">Ative a memória para gerenciar os registros.</div>
<h3 style="margin-top:22px">Aprendizado aguardando revisão</h3><p class="small muted">Novas informações e possíveis conflitos só entram na memória após sua aprovação.</p><div id="memory-reviews" class="muted small">Nenhuma proposta carregada.</div>
</section>
<section class="panel" style="margin-bottom:16px"><h3>Relações entre memórias</h3><p class="small muted">Identifica possíveis conflitos, assuntos relacionados e registros antigos ou expirados. São alertas determinísticos: nada é corrigido ou excluído automaticamente.</p><div class="actions"><button id="memory-insights-refresh" class="secondary">Analisar memórias autorizadas</button></div><div id="memory-insights" class="muted small">Ative a memória privada para analisar registros.</div></section>
<section class="panel" style="margin-bottom:16px"><h3>Aplicativos conectados</h3><div id="apps-list" class="muted small">Nenhum dado carregado.</div></section>
<section class="panel" style="margin-bottom:16px"><h3>Conectar novo aplicativo</h3>
<p class="small muted">Escolha um aplicativo já cadastrado e habilitado pelo administrador. Garcia criará dois convites de uso único, válidos por 24 horas.</p>
<div class="formgrid"><div><label for="available-apps">Aplicativo autorizado</label><select id="available-apps"><option value="">Carregando aplicativos...</option></select></div><div class="actions" style="align-items:end"><button id="connect-app">Gerar convites de conexão</button></div></div>
<div id="connection-result" class="notice small" style="display:none">
<strong>Convites gerados — copie e entregue somente ao responsável pelo aplicativo.</strong>
<p>1. Código de registro: o aplicativo usa este código para registrar o dispositivo e receber seu token.</p><input id="registration-code" type="text" readonly aria-label="Código de registro">
<div class="actions"><button id="copy-registration" class="secondary">Copiar código de registro</button></div>
<p>2. Código de pareamento: depois do registro, o aplicativo usa este código para vincular o dispositivo ao seu Garcia.</p><input id="pairing-code" type="text" readonly aria-label="Código de pareamento">
<div class="actions"><button id="copy-pairing" class="secondary">Copiar código de pareamento</button></div>
<p id="connection-expiry" class="muted"></p>
</div>
<div class="small muted">Os códigos são exibidos somente nesta resposta e não podem ser recuperados depois. Não os publique nem os envie juntos em canais inseguros. A criação do convite não instala nem configura o aplicativo automaticamente.</div>
</section>
<section class="panel" style="margin-bottom:16px"><h3>Dispositivos pareados</h3><div class="tablewrap"><table><thead><tr><th>Aplicativo</th><th>Dispositivo</th><th>Estado</th><th>Último acesso</th><th>Ação</th></tr></thead><tbody id="devices-list"></tbody></table></div></section>
<section class="panel" style="margin-bottom:16px"><h3>Permissões entre aplicativos</h3><div class="tablewrap"><table><thead><tr><th>App autorizado</th><th>Permissão</th><th>Escopo</th><th>Validade</th><th>Estado</th><th></th></tr></thead><tbody id="grants-list"></tbody></table></div>
<h3 style="margin-top:24px">Criar permissão</h3>
<div class="formgrid">
<div><label for="grantee">Aplicativo autorizado (ID)</label><input id="grantee" placeholder="com.exemplo.app"></div>
<div><label for="permission">Permissão</label><select id="permission"><option value="send">Enviar mensagens</option><option value="receive">Receber mensagens</option><option value="memory_read">Ler memória</option><option value="memory_write">Gravar memória</option></select></div>
<div><label for="scope">Escopo</label><select id="scope"><option value="task">Tarefa</option><option value="context">Contexto</option><option value="app_memory">Memória do app</option><option value="owner_memory">Memória do proprietário</option></select></div>
<div><label for="hours">Validade (horas, máx. 8760)</label><input id="hours" type="number" min="1" max="8760" value="720"></div>
<div><label for="source">App de origem (quando exigido)</label><input id="source" placeholder="com.exemplo.origem"></div>
<div><label for="destination">App de destino (quando exigido)</label><input id="destination" placeholder="com.exemplo.destino"></div>
</div><div class="actions"><button id="create-grant">Criar permissão</button></div>
<div class="small muted">Para mensagens, informe origem e destino. Para memória de app, informe a origem. Memória do proprietário não exige origem ou destino.</div>
</section>
<div id="app-message" role="status" class="small muted"></div>
</section>
</main>
<div class="footer">Garcia · painel privado · As informações exibidas dependem das migrations e da configuração do servidor.</div>
<script>
(function(){
var token=null, dashboard=null;
var byId=function(id){return document.getElementById(id)};
var say=function(text){byId("app-message").textContent=text||""};
var loginSay=function(text){byId("message").textContent=text||""};
var el=function(tag,text){var node=document.createElement(tag);node.textContent=text==null?"—":String(text);return node};
var dateText=function(value){if(!value)return "Nunca";var d=new Date(value);return isNaN(d.getTime())?String(value):d.toLocaleString("pt-BR")};
var api=async function(path,method,body){var response=await fetch(path,{method:method||"GET",headers:{"authorization":"Bearer "+token,"accept":"application/json","content-type":"application/json"},body:body?JSON.stringify(body):undefined,cache:"no-store"});var data=await response.json().catch(function(){return {error:"Resposta inválida"};});if(!response.ok)throw new Error(data.error||("HTTP "+response.status));return data};
var addCell=function(row,value){row.appendChild(el("td",value))};
var loadAvailableApps=async function(){var data=await api("/v1/owner/available-apps");var select=byId("available-apps");var previous=select.value;select.replaceChildren();(data.apps||[]).forEach(function(app){var option=el("option",app.display_name+" ("+app.app_id+")");option.value=app.app_id;select.appendChild(option)});if(previous&&Array.from(select.options).some(function(o){return o.value===previous}))select.value=previous;if(!select.options.length)select.appendChild(el("option","Nenhum aplicativo habilitado"))};
var render=function(data){
dashboard=data;
byId("ai-state").textContent=data.intelligence.active?"Operacional":data.intelligence.maintenance_mode?"Manutenção":"Indisponível";
byId("ai-mode").textContent=data.intelligence.mode||"—";
byId("model").textContent=data.intelligence.model||"Não configurado";
byId("provider").textContent=data.intelligence.provider||"Sem provedor";
byId("apps-count").textContent=(data.connected_apps||[]).length;
byId("devices-count").textContent=(data.devices||[]).filter(function(x){return x.status==="active"}).length;
byId("agents-count").textContent=(data.intelligence.agents||[]).length;
byId("maintenance").textContent=data.intelligence.maintenance_mode?"Ativo":"Inativo";
var l=data.intelligence.limits||{};
byId("limits").textContent="Global "+(l.global_daily||"—")+" · app "+(l.app_daily||"—")+" · dispositivo "+(l.device_daily||"—");
byId("memory").checked=!!data.features.memory_enabled;
byId("messaging").checked=!!data.features.app_messaging_enabled;
byId("updated").textContent="Atualizado em "+new Date().toLocaleString("pt-BR");
var apps=byId("apps-list");apps.replaceChildren();
if(!(data.connected_apps||[]).length)apps.appendChild(el("p","Nenhum aplicativo vinculado ainda."));
(data.connected_apps||[]).forEach(function(a){var line=el("div","");line.className="rowline";var left=el("div","");left.appendChild(el("strong",a.display_name||a.app_id));left.appendChild(el("small",a.app_id+" · "+(a.app_type||"other")+" · "+((a.capabilities||[]).join(", ")||"sem capacidades declaradas")+" · tarefas: "+((a.task_types||[]).join(", ")||"não declaradas")));if(a.description)left.appendChild(el("small",a.description));line.appendChild(left);var right=el("span",(a.active_device_count||0)+" ativo(s)");right.className="pill "+(a.enabled?"good":"warn");line.appendChild(right);apps.appendChild(line)});
var devices=byId("devices-list");devices.replaceChildren();
(data.devices||[]).forEach(function(d){var row=el("tr","");addCell(row,d.display_name+" ("+d.app_id+")");addCell(row,d.device_id);addCell(row,d.status==="active"?"Ativo":"Revogado");addCell(row,dateText(d.last_seen_at));var action=el("td","");if(d.status==="active"&&!d.is_current){var revoke=el("button","Revogar");revoke.className="danger";revoke.addEventListener("click",async function(){if(!confirm("Revogar este dispositivo? Ele perderá acesso imediatamente."))return;try{await api("/v1/owner/devices/revoke","POST",{device_id:d.device_id});say("Dispositivo revogado.");await refresh()}catch(e){say(e.message)}});action.appendChild(revoke)}else if(d.is_current){action.appendChild(el("span","Sessão atual"))}else{action.appendChild(el("span","—"))}row.appendChild(action);devices.appendChild(row)});
if(!(data.devices||[]).length){var empty=el("tr","");var cell=el("td","Nenhum dispositivo listado.");cell.colSpan=5;empty.appendChild(cell);devices.appendChild(empty)}
renderGrants(data.access_grants||[]);
};
var renderGrants=function(grants){var body=byId("grants-list");body.replaceChildren();grants.forEach(function(g){var row=el("tr","");addCell(row,g.grantee_app_id);addCell(row,g.permission);addCell(row,g.scope);addCell(row,dateText(g.expires_at));addCell(row,g.revoked_at?"Revogada":(new Date(g.expires_at)<new Date()?"Expirada":"Ativa"));var cell=el("td","");if(!g.revoked_at&&new Date(g.expires_at)>new Date()){var b=el("button","Revogar");b.className="danger";b.addEventListener("click",async function(){if(!confirm("Revogar esta permissão?"))return;try{await api("/v1/owner/access-grants/revoke","POST",{grant_id:g.grant_id});say("Permissão revogada.");await refresh()}catch(e){say(e.message)}});cell.appendChild(b)}row.appendChild(cell);body.appendChild(row)});if(!grants.length){var row=el("tr","");var cell=el("td","Nenhuma permissão cadastrada.");cell.colSpan=6;row.appendChild(cell);body.appendChild(row)}};
var loadMemories=async function(){
var host=byId("memory-list");host.replaceChildren();
if(!byId("memory").checked){host.appendChild(el("p","Ative a memória privada para consultar os registros."));return}
var scope=byId("memory-scope").value,query=byId("memory-search").value.trim(),includeExpired=byId("memory-expired").checked;
var path="/v1/owner/memory?scope="+encodeURIComponent(scope)+(query?"&q="+encodeURIComponent(query):"")+(includeExpired?"&include_expired=true":"");
try{
var data=await api(path);var records=data.memories||[];
if(!records.length){host.appendChild(el("p","Nenhuma memória encontrada."));return}
records.forEach(function(memory){
var card=el("div","");card.className="rowline";card.style.alignItems="flex-start";
var details=el("div","");details.style.minWidth="0";details.style.flex="1";
details.appendChild(el("strong",memory.memory_key));details.appendChild(el("div",memory.value));
var expiry=memory.expires_at?dateText(memory.expires_at):"Sem expiração";
if(memory.expires_at&&new Date(memory.expires_at)<new Date())expiry+=" · expirada";
details.appendChild(el("small","Validade: "+expiry+" · Atualizada: "+dateText(memory.updated_at)));
var actions=el("div","");actions.className="actions";
var edit=el("button","Editar");edit.className="secondary";edit.addEventListener("click",async function(){
var key=prompt("Chave da memória:",memory.memory_key);if(key===null)return;
var value=prompt("Conteúdo da memória:",memory.value);if(value===null)return;
var expiryInput=prompt("Validade em horas (1 a 8760) ou 0 para não expirar:",memory.expires_at?String(Math.max(1,Math.ceil((new Date(memory.expires_at)-Date.now())/3600000))):"0");if(expiryInput===null)return;
var hours=Number(expiryInput);if(!Number.isInteger(hours)||hours<0||hours>8760){say("Informe 0 ou um número inteiro entre 1 e 8760.");return}
try{await api("/v1/owner/memory?scope="+encodeURIComponent(scope),"PATCH",{memory_id:memory.memory_id,key:key,value:value,consent:"curated",valid_hours:hours===0?null:hours});say("Memória atualizada.");await loadMemories()}catch(e){say(e.message)}
});
var remove=el("button","Excluir");remove.className="danger";remove.addEventListener("click",async function(){if(!confirm("Excluir esta memória? Ela deixará de ser usada imediatamente."))return;try{await api("/v1/owner/memory?scope="+encodeURIComponent(scope),"DELETE",{memory_id:memory.memory_id});say("Memória excluída.");await loadMemories()}catch(e){say(e.message)}});
actions.appendChild(edit);actions.appendChild(remove);card.appendChild(details);card.appendChild(actions);host.appendChild(card);
});
}catch(error){host.appendChild(el("p","Não foi possível carregar este escopo: "+error.message))}
};
var loadMemoryReviews=async function(){
var host=byId("memory-reviews");host.replaceChildren();
if(!byId("memory").checked){host.appendChild(el("p","Ative a memória privada para revisar propostas."));return}
var scope=byId("memory-scope").value;
try{
var data=await api("/v1/owner/memory/reviews?scope="+encodeURIComponent(scope));
var proposals=data.proposals||[];
if(!proposals.length){host.appendChild(el("p","Nenhuma proposta aguardando revisão."));return}
proposals.forEach(function(p){
var card=el("div","");card.className="rowline";card.style.alignItems="flex-start";
var details=el("div","");details.style.flex="1";details.style.minWidth="0";
details.appendChild(el("strong",p.memory_key+" · "+(p.classification==="new"?"Nova informação":p.classification==="unchanged"?"Informação já existente":"Possível conflito")));
details.appendChild(el("div","Proposta: "+p.proposed_value));
if(p.existing_value_snapshot)details.appendChild(el("small","Memória atual: "+p.existing_value_snapshot));
details.appendChild(el("small","Evidência apresentada: "+p.evidence_excerpt+" · App: "+p.proposed_by_app_id));
var actions=el("div","");actions.className="actions";
var approve=el("button","Aprovar");approve.addEventListener("click",async function(){if(!confirm("Aprovar esta informação e "+(p.classification==="possible_conflict"?"atualizar a memória existente?":"salvá-la na memória")+"?"))return;try{await api("/v1/owner/memory/reviews?scope="+encodeURIComponent(scope),"PATCH",{proposal_id:p.proposal_id,decision:"approve"});say("Proposta aprovada.");await loadMemories();await loadMemoryReviews()}catch(e){say(e.message)}});
var reject=el("button","Rejeitar");reject.className="danger";reject.addEventListener("click",async function(){if(!confirm("Rejeitar esta proposta? A memória não será alterada."))return;try{await api("/v1/owner/memory/reviews?scope="+encodeURIComponent(scope),"PATCH",{proposal_id:p.proposal_id,decision:"reject"});say("Proposta rejeitada.");await loadMemoryReviews()}catch(e){say(e.message)}});
actions.appendChild(approve);actions.appendChild(reject);card.appendChild(details);card.appendChild(actions);host.appendChild(card);
});
}catch(error){host.appendChild(el("p","Não foi possível carregar as propostas: "+error.message))}
};
var loadMemoryInsights=async function(){
var host=byId("memory-insights");host.replaceChildren();
if(!byId("memory").checked){host.appendChild(el("p","Ative a memória privada para analisar os registros."));return}
try{
var data=await api("/v1/owner/memory/insights");
host.appendChild(el("p","Registros analisados: "+data.analyzed_records+" · Chamadas de IA: "+data.inference_calls+" · Alterações automáticas: não"));
var conflicts=data.possible_conflicts||[];
host.appendChild(el("strong","Possíveis conflitos ("+conflicts.length+")"));
if(!conflicts.length)host.appendChild(el("p","Nenhuma divergência de chave detectada."));
conflicts.forEach(function(pair){var card=el("div","");card.className="rowline";var details=el("div","");details.style.flex="1";details.appendChild(el("strong","Chave: "+pair.first.memory_key));details.appendChild(el("div",pair.first.value+" · "+(pair.first.source_app_id||"memória central")));details.appendChild(el("div",pair.second.value+" · "+(pair.second.source_app_id||"memória central")));details.appendChild(el("small","Possível conflito — compare as fontes antes de editar."));card.appendChild(details);host.appendChild(card)});
var related=data.related||[];host.appendChild(el("strong","Assuntos relacionados ("+related.length+")"));
related.forEach(function(pair){var line=el("div","");line.className="rowline";line.appendChild(el("span",pair.first.memory_key+" ↔ "+pair.second.memory_key+" · termos: "+pair.shared_terms.join(", ")));host.appendChild(line)});
var outdated=data.outdated||[];host.appendChild(el("strong","Registros para revisão ("+outdated.length+")"));
outdated.forEach(function(item){var line=el("div","");line.className="rowline";line.appendChild(el("span",item.memory_key+" · "+(item.reason==="expired"?"Expirada":"Sem revisão há "+item.age_days+" dias")+" · "+(item.source_app_id||"memória central")));host.appendChild(line)});
}catch(error){host.appendChild(el("p","Não foi possível analisar memórias: "+error.message))}
};
var refresh=async function(){var data=await api("/v1/owner/dashboard");render(data);await loadAvailableApps();await loadMemories();await loadMemoryReviews();await loadMemoryInsights()};
byId("connect").addEventListener("click",async function(){var value=byId("token").value.trim();if(value.length<32){loginSay("Informe um token válido.");return}token=value;byId("connect").disabled=true;loginSay("Verificando acesso...");try{await refresh();byId("login").style.display="none";byId("app").style.display="block";byId("logout").style.display="inline-block";byId("token").value="";loginSay("")}catch(e){token=null;loginSay(e.message)}finally{byId("connect").disabled=false}});
byId("refresh").addEventListener("click",async function(){try{await refresh();say("Dados atualizados.")}catch(e){say(e.message)}});
byId("memory-search-button").addEventListener("click",function(){loadMemories();loadMemoryReviews()});
byId("memory-insights-refresh").addEventListener("click",function(){loadMemoryInsights()});
byId("memory-scope").addEventListener("change",function(){loadMemories();loadMemoryReviews()});
byId("memory-expired").addEventListener("change",function(){loadMemories()});
byId("memory").addEventListener("change",function(){loadMemories();loadMemoryReviews();loadMemoryInsights()});

byId("logout").addEventListener("click",function(){token=null;dashboard=null;byId("app").style.display="none";byId("login").style.display="block";byId("logout").style.display="none";byId("token").value="";say("");loginSay("Sessão encerrada.")});
byId("connect-app").addEventListener("click",async function(){var appId=byId("available-apps").value;if(!appId){say("Selecione um aplicativo habilitado.");return}var button=byId("connect-app");button.disabled=true;try{var result=await api("/v1/owner/apps/connect","POST",{app_id:appId});byId("registration-code").value=result.registration_invitation_code;byId("pairing-code").value=result.pairing_invitation_code;byId("connection-expiry").textContent="Validade dos dois códigos: até "+dateText(result.expires_at)+". Cada código só pode ser usado uma vez.";byId("connection-result").style.display="block";say("Convites gerados. Copie e encaminhe os códigos com segurança.")}catch(e){say(e.message)}finally{button.disabled=false}});
byId("copy-registration").addEventListener("click",async function(){try{await navigator.clipboard.writeText(byId("registration-code").value);say("Código de registro copiado.")}catch(e){byId("registration-code").select();say("Selecione e copie o código de registro.")}});
byId("copy-pairing").addEventListener("click",async function(){try{await navigator.clipboard.writeText(byId("pairing-code").value);say("Código de pareamento copiado.")}catch(e){byId("pairing-code").select();say("Selecione e copie o código de pareamento.")}});
byId("save-settings").addEventListener("click",async function(){try{var result=await api("/v1/owner/settings","POST",{settings:{memory_enabled:byId("memory").checked,app_messaging_enabled:byId("messaging").checked}});say("Controles salvos.");await refresh()}catch(e){say(e.message)}});
byId("create-grant").addEventListener("click",async function(){var permission=byId("permission").value,scope=byId("scope").value;var body={grantee_app_id:byId("grantee").value.trim(),permission:permission,scope:scope,valid_hours:Number(byId("hours").value)};var source=byId("source").value.trim(),destination=byId("destination").value.trim();if(source)body.source_app_id=source;if(destination)body.destination_app_id=destination;try{await api("/v1/owner/access-grants","POST",body);say("Permissão criada.");await refresh()}catch(e){say(e.message)}});
byId("permission").addEventListener("change",function(){var p=byId("permission").value;byId("scope").value=(p==="send"||p==="receive")?"task":(p==="memory_read"||p==="memory_write")?"owner_memory":"task"});
})();
</script>
</body></html>`;
