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
<section class="panel" style="margin-bottom:16px"><h3>Aplicativos conectados</h3><div id="apps-list" class="muted small">Nenhum dado carregado.</div></section>
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
(data.connected_apps||[]).forEach(function(a){var line=el("div","");line.className="rowline";var left=el("div","");left.appendChild(el("strong",a.display_name||a.app_id));left.appendChild(el("small",a.app_id+" · último acesso: "+dateText(a.last_seen_at)));line.appendChild(left);var right=el("span",(a.active_device_count||0)+" ativo(s)");right.className="pill "+(a.enabled?"good":"warn");line.appendChild(right);apps.appendChild(line)});
var devices=byId("devices-list");devices.replaceChildren();
(data.devices||[]).forEach(function(d){var row=el("tr","");addCell(row,d.display_name+" ("+d.app_id+")");addCell(row,d.device_id);addCell(row,d.status==="active"?"Ativo":"Revogado");addCell(row,dateText(d.last_seen_at));var action=el("td","");if(d.status==="active"&&!d.is_current){var revoke=el("button","Revogar");revoke.className="danger";revoke.addEventListener("click",async function(){if(!confirm("Revogar este dispositivo? Ele perderá acesso imediatamente."))return;try{await api("/v1/owner/devices/revoke","POST",{device_id:d.device_id});say("Dispositivo revogado.");await refresh()}catch(e){say(e.message)}});action.appendChild(revoke)}else if(d.is_current){action.appendChild(el("span","Sessão atual"))}else{action.appendChild(el("span","—"))}row.appendChild(action);devices.appendChild(row)});
if(!(data.devices||[]).length){var empty=el("tr","");var cell=el("td","Nenhum dispositivo listado.");cell.colSpan=5;empty.appendChild(cell);devices.appendChild(empty)}
renderGrants(data.access_grants||[]);
};
var renderGrants=function(grants){var body=byId("grants-list");body.replaceChildren();grants.forEach(function(g){var row=el("tr","");addCell(row,g.grantee_app_id);addCell(row,g.permission);addCell(row,g.scope);addCell(row,dateText(g.expires_at));addCell(row,g.revoked_at?"Revogada":(new Date(g.expires_at)<new Date()?"Expirada":"Ativa"));var cell=el("td","");if(!g.revoked_at&&new Date(g.expires_at)>new Date()){var b=el("button","Revogar");b.className="danger";b.addEventListener("click",async function(){if(!confirm("Revogar esta permissão?"))return;try{await api("/v1/owner/access-grants/revoke","POST",{grant_id:g.grant_id});say("Permissão revogada.");await refresh()}catch(e){say(e.message)}});cell.appendChild(b)}row.appendChild(cell);body.appendChild(row)});if(!grants.length){var row=el("tr","");var cell=el("td","Nenhuma permissão cadastrada.");cell.colSpan=6;row.appendChild(cell);body.appendChild(row)}};
var refresh=async function(){var data=await api("/v1/owner/dashboard");render(data)};
byId("connect").addEventListener("click",async function(){var value=byId("token").value.trim();if(value.length<32){loginSay("Informe um token válido.");return}token=value;byId("connect").disabled=true;loginSay("Verificando acesso...");try{await refresh();byId("login").style.display="none";byId("app").style.display="block";byId("logout").style.display="inline-block";byId("token").value="";loginSay("")}catch(e){token=null;loginSay(e.message)}finally{byId("connect").disabled=false}});
byId("refresh").addEventListener("click",async function(){try{await refresh();say("Dados atualizados.")}catch(e){say(e.message)}});
byId("logout").addEventListener("click",function(){token=null;dashboard=null;byId("app").style.display="none";byId("login").style.display="block";byId("logout").style.display="none";byId("token").value="";say("");loginSay("Sessão encerrada.")});
byId("save-settings").addEventListener("click",async function(){try{var result=await api("/v1/owner/settings","POST",{settings:{memory_enabled:byId("memory").checked,app_messaging_enabled:byId("messaging").checked}});say("Controles salvos.");await refresh()}catch(e){say(e.message)}});
byId("create-grant").addEventListener("click",async function(){var permission=byId("permission").value,scope=byId("scope").value;var body={grantee_app_id:byId("grantee").value.trim(),permission:permission,scope:scope,valid_hours:Number(byId("hours").value)};var source=byId("source").value.trim(),destination=byId("destination").value.trim();if(source)body.source_app_id=source;if(destination)body.destination_app_id=destination;try{await api("/v1/owner/access-grants","POST",body);say("Permissão criada.");await refresh()}catch(e){say(e.message)}});
byId("permission").addEventListener("change",function(){var p=byId("permission").value;byId("scope").value=(p==="send"||p==="receive")?"task":(p==="memory_read"||p==="memory_write")?"owner_memory":"task"});
})();
</script>
</body></html>`;
