import {companies,agents,projects,tasks,decisions,findCompany,findProject,findAgent,scopeProjects,scopeTasks,counts,scopeQuery} from './model.js';
import {icon,esc} from './icons.js';
const avatar=id=>'<span class="avatar" title="'+esc(findAgent(id)?.name||id)+'">'+esc((findAgent(id)?.name||id)[0])+'</span>';
const avatars=ids=>'<div class="avatars">'+ids.map(avatar).join('')+'</div>';
const mark=c=>'<span class="company-mark">'+esc(c.mark)+'</span>';
const statusLabel={todo:'To do',doing:'In motion',done:'Done'};
const action=(label,attr,value,primary=false)=>'<button class="btn'+(primary?' primary':'')+'" '+attr+'="'+esc(value)+'">'+label+'</button>';
const link=(label,href,cls='text-button')=>'<a class="'+cls+'" href="'+href+'">'+label+'</a>';
const heading=(eyebrow,title,description='',extra='')=>'<div class="page-heading"><div><div class="eyebrow">'+esc(eyebrow)+'</div><h1>'+esc(title)+'</h1>'+(description?'<p>'+esc(description)+'</p>':'')+'</div>'+extra+'</div>';
const crumbs=items=>'<nav class="breadcrumbs" aria-label="Breadcrumb">'+[[ 'Agent OS','#/'],...items].map(([name,href])=>href?'<a href="'+href+'">'+esc(name)+'</a>':'<span>'+esc(name)+'</span>').join(icon('chevron'))+'</nav>';
const empty=(title,body)=>'<div class="empty-state">'+icon('check')+'<h2>'+esc(title)+'</h2><p>'+esc(body)+'</p></div>';
const companyHref=c=>'#/company/'+c.id;
const projectHref=p=>'#/project/'+p.id;
function metrics(items,extra){
  const c=counts(items);
  return '<div class="stats"><div class="stat"><strong>'+c.todo+'</strong><small>Work left to do</small></div><div class="stat"><strong>'+c.doing+'</strong><small>In motion</small></div><div class="stat"><strong>'+c.done+'</strong><small>Completed</small></div>'+(extra?'<div class="stat"><strong>'+extra[0]+'</strong><small>'+extra[1]+'</small></div>':'')+'</div>';
}
export function pending(state,companyId,projectId){return decisions.filter(d=>!state.resolved.has(d.id)&&(!companyId||d.company===companyId)&&(!projectId||d.project===projectId));}
function decisionCard(d){return '<a class="decision-card" href="#/decisions/'+d.id+'"><span class="eyebrow">'+esc(findCompany(d.company).name)+' / '+esc(d.type)+'</span><h3>'+esc(d.title)+'</h3><div class="row between"><small>'+esc(findAgent(d.agent).name)+' recommends a next step</small>'+icon('arrow')+'</div></a>';}
export function home(state){
  const total=counts(tasks),waiting=pending(state);
  return '<div class="home-wrap"><div class="company-strip"><span class="eyebrow">Your world</span>'+companies.map(c=>'<a class="company-chip" href="'+companyHref(c)+'"><i></i>'+esc(c.name)+'</a>').join('')+'</div><div class="home-stage"><div id="home-conversation-slot"></div><div id="home-presence-slot"></div></div><section class="home-intro"><h1>A little clarity. A lot in motion.</h1><p>Your companies are moving forward.<br>'+ (waiting.length?waiting.length+' decisions could use your attention.':'Your decisions are all caught up.') +'</p></section><div class="prompt-chips"><button data-command="Show me what decisions need me">What needs me?</button><button data-command="Show my companies">Show my companies</button><button data-command="Show work in motion">See work in motion</button></div><section class="home-decisions"><div class="section-head"><h2>A few things to move forward</h2>'+link('Review all '+icon('arrow'),'#/decisions')+'</div>'+(waiting.length?'<div class="decision-cards">'+waiting.slice(0,3).map(decisionCard).join('')+'</div>':empty('A little room to breathe.','Your team can keep moving.'))+'</section><div class="home-footer"><span>'+companies.length+' companies · '+agents.length+' shared specialists · '+total.doing+' tasks in motion</span><span>Voice preview · sample responses</span></div></div>';
}
function companyCard(c,state){
  const ps=scopeProjects(c.id),cs=counts(scopeTasks(c.id));
  return '<a class="company-card" href="'+companyHref(c)+'"><div class="row between">'+mark(c)+'<span class="pill">'+esc(c.phase)+'</span></div><h2>'+esc(c.name)+'</h2><p>'+esc(c.description)+'</p><div class="mini-stats"><div><b>'+ps.length+'</b>projects</div><div><b>'+cs.doing+'</b>in motion</div><div><b>'+pending(state,c.id).length+'</b>decisions</div></div><div class="row between">'+avatars(c.agents)+'<span>Open company '+icon('arrow')+'</span></div></a>';
}
export function portfolio(state){
  return '<div class="page-width">'+heading('Your portfolio','Good things are taking shape.','Independent companies, one place to keep perspective.',link(icon('plus')+' New company','#/new-company','btn'))+'<div class="card-grid">'+companies.map(c=>companyCard(c,state)).join('')+'</div><div class="line"></div><div class="section-head"><h2>Across your portfolio</h2>'+link('Explore all projects '+icon('arrow'),'#/projects')+'</div>'+metrics(tasks,[agents.length,'Shared specialists'])+'<div class="row">'+link(icon('orbit')+' Portfolio agent map','#/map','btn')+link(icon('clock')+' Audit trail','#/audit','btn')+'</div></div>';
}
export function projectCard(p){
  const c=counts(p.tasks),progress=p.tasks.length?Math.round(c.done/p.tasks.length*100):0;
  return '<a class="project-card" href="'+projectHref(p)+'"><div class="row between"><span class="eyebrow">'+esc(p.department)+'</span><span class="pill">'+esc(p.kind)+'</span></div><h3>'+esc(p.name)+'</h3><p>'+esc(p.description)+'</p><div class="progress"><i style="width:'+progress+'%"></i></div><div class="row between count-summary"><span><b>'+c.doing+'</b> in motion · <b>'+c.todo+'</b> to do</span><span>'+c.done+'/'+p.tasks.length+' done</span></div><div class="row between">'+avatars(p.agents)+'<span>Open workspace '+icon('arrow')+'</span></div></a>';
}
function activity(p){
  const completed=p.tasks.filter(t=>t.status==='done').slice(0,2);
  return completed.map(t=>'<a href="#/task/'+t.id+'" class="activity-item">'+avatar(t.agent)+'<div><p><strong>'+esc(findAgent(t.agent).name)+'</strong> completed '+esc(t.title.toLowerCase())+'.</p><small>'+esc(t.id)+' · Evidence attached</small></div></a>').join('');
}
function rail(c,p,state){
  const waiting=pending(state,c.id,p?.id),project=p||scopeProjects(c.id)[0];
  return '<aside class="context-rail"><section class="rail-note"><span class="eyebrow">A note from Friday</span><p>'+(waiting.length?'There '+(waiting.length===1?'is one decision':'are '+waiting.length+' decisions')+' that could move this work forward. The team has a recommendation ready.':'The work is moving. No decisions are waiting for you in this scope.')+'</p>'+link(waiting.length?'Review recommendation '+icon('arrow'):'Explore the team '+icon('arrow'),waiting.length?(p?projectHref(p):companyHref(c))+'/decisions?decision='+waiting[0].id:'#/company/'+c.id+'/team')+'</section><section><h2>Small updates. Real progress.</h2>'+(p?activity(p):scopeProjects(c.id).length?scopeProjects(c.id).map(item=>'<div class="activity-project"><span class="eyebrow">'+esc(item.name)+'</span>'+activity(item)+'</div>').join(''):'<p class="inline-note">Work updates will appear here.</p>')+'</section>'+(p&&p.agents.length>1?'<section><div class="handoff"><span class="eyebrow">Sample handoff</span><div class="row">'+avatar(p.agents[0]||'maya')+'<span class="connector"></span>'+avatar(p.agents[1]||'leo')+'</div><p>Context → work → review</p></div>'+link(icon('file')+' Project artefacts',projectHref(p)+'/artefacts','btn')+'</section>':'<section class="rail-note"><span class="eyebrow">Company context</span><p>'+esc(c.purpose)+'</p>'+link('Company profile '+icon('arrow'),companyHref(c)+'/profile')+'</section>')+'</aside>';
}
const companyTabs=[['home','Projects','grid'],['combined','Combined','people'],['decisions','Decisions','check'],['map','Agent Map','orbit'],['routines','Routines','repeat'],['artefacts','Artefacts','file'],['team','Workforce','people']];
function tabs(base,current,items){return '<nav class="view-tabs" aria-label="Workspace view">'+items.map(([id,title,i])=>link(icon(i)+' '+title,base+(id==='home'?'':'/'+id),id===current?'active':'')).join('')+'</nav>';}
export function companyPage(c,tab,state){
  const ps=scopeProjects(c.id),header=crumbs([['Companies','#/companies'],[c.name]])+heading('Company / '+c.description,c.name,c.purpose,link(icon('plus')+' New project','#/new-project/'+c.id,'btn'))+tabs(companyHref(c),tab,companyTabs);
  let content;
  if(tab==='map')content=mapSurface(c.id);
  else if(tab==='routines')content=routineList(c.id);
  else if(tab==='artefacts')content=artefactList(c.id);
  else if(tab==='team')content=workforceTable(c.agents,c.id);
  else if(tab==='decisions')content=decisionPage(state.route?.decision,state,c.id,'',true);
  else if(tab==='combined')content=metrics(scopeTasks(c.id),[ps.length,'Projects'])+'<div class="workspace-columns"><section>'+board({tasks:scopeTasks(c.id),agents:c.agents},state,true)+'</section>'+rail(c,null,state)+'</div>';
  else if(tab==='profile')content='<div class="detail-grid"><div>'+heading('Company profile',c.name,c.purpose)+'<dl class="detail-list"><div><dt>Company CEO</dt><dd>'+esc(c.ceo)+'</dd></div><div><dt>Operating phase</dt><dd>'+esc(c.phase)+'</dd></div><div><dt>Portfolio coordinator</dt><dd>Friday</dd></div></dl></div><div><h2>Applications</h2>'+ps.filter(p=>p.asset).filter((p,i,a)=>a.findIndex(x=>x.asset===p.asset)===i).map(p=>'<div class="rail-note"><strong>'+esc(p.asset)+'</strong><p>Durable application, linked to company projects.</p></div>').join('')+'</div></div>';
  else content=metrics(scopeTasks(c.id),[c.agents.length,'Specialist assignments'])+'<div class="workspace-columns"><section><div class="section-head"><h2>Projects & initiatives</h2><span class="eyebrow">'+ps.length+' projects</span></div>'+(ps.length?'<div class="project-grid">'+ps.map(projectCard).join('')+'</div>':empty('A new chapter.','Create the first project for this company.'))+'</section>'+rail(c,null,state)+'</div>';
  return '<div class="page-width">'+header+content+'</div>';
}
export function allProjects(){
  return '<div class="page-width">'+heading('Across your companies','Every project, in perspective.','Each project opens its own workspace. Applications, campaigns, and research all have a place.')+companies.map(c=>'<section style="margin-bottom:30px"><div class="section-head"><h2>'+link(c.name,companyHref(c))+'</h2><span class="eyebrow">'+esc(c.description)+'</span></div><div class="project-grid">'+scopeProjects(c.id).map(projectCard).join('')+'</div></section>').join('')+'</div>';
}
function taskRow(t){
  return '<a class="task-row" href="#/task/'+t.id+'"><span class="task-status '+t.status+'"></span><div class="task-description"><strong>'+esc(t.title)+'</strong><p>'+esc(t.note)+'</p></div><span class="pill '+(t.status==='doing'?'active':'')+'">'+statusLabel[t.status]+'</span>'+avatar(t.agent)+icon('chevron')+'</a>';
}
function board(p,state,showProject=false){
  const selected=p.tasks.filter(t=>!state.agentFilter||t.agent===state.agentFilter);
  return '<div class="board-toolbar"><span>All work, including completed tasks</span><label>Specialist <select id="agent-filter"><option value="">Everyone</option>'+p.agents.map(a=>'<option value="'+a+'"'+(a===state.agentFilter?' selected':'')+'>'+findAgent(a).name+'</option>').join('')+'</select></label></div><div class="board">'+['todo','doing','done'].map(status=>'<section class="board-column"><div class="column-title">'+statusLabel[status]+'<span>'+selected.filter(t=>t.status===status).length+'</span></div>'+selected.filter(t=>t.status===status).map(t=>'<a class="task-card '+t.status+'" href="#/task/'+t.id+'"><span class="eyebrow">'+t.id+(showProject?' · '+esc(findProject(t.project).name):'')+'</span><h3>'+esc(t.title)+'</h3><p>'+esc(t.note)+'</p><div class="row between"><span>'+avatar(t.agent)+' '+findAgent(t.agent).name+'</span><span>'+statusLabel[t.status]+'</span></div></a>').join('')+(selected.some(t=>t.status===status)?'':'<p class="inline-note">Nothing in this column.</p>')+'</section>').join('')+'</div>';
}
export function projectPage(p,tab,state){
  const c=findCompany(p.company);
  let content;
  if(tab==='map')content=mapSurface(c.id,p.id);
  else if(tab==='artefacts')content=artefactList(c.id,p.id);
  else if(tab==='routines')content=routineList(c.id,p.id);
  else if(tab==='decisions')content=decisionPage(state.route?.decision,state,c.id,p.id,true);
  else if(tab==='combined')content='<div class="workspace-columns"><section>'+board(p,state)+'</section>'+rail(c,p,state)+'</div>';
  else content=metrics(p.tasks,[pending(state,c.id,p.id).length,'Decisions'])+'<div class="workspace-columns"><section><div class="section-head"><h2>Moving the project forward</h2>'+link('Full combined view '+icon('arrow'),projectHref(p)+'/combined')+'</div><div class="task-list">'+p.tasks.filter(t=>t.status!=='done').sort((a,b)=>(a.status==='doing'?-1:1)-(b.status==='doing'?-1:1)).map(taskRow).join('')+'</div>'+(!p.tasks.length?empty('The workspace is ready.','Friday will help shape the work. No tasks have been created yet.'):'')+'<div class="section-head" style="margin-top:32px"><h2>Recently completed</h2><span class="eyebrow">'+p.tasks.filter(t=>t.status==='done').length+' done</span></div><div class="task-list">'+p.tasks.filter(t=>t.status==='done').slice(0,2).map(taskRow).join('')+'</div></section>'+rail(c,p,state)+'</div>';
  return '<div class="page-width">'+crumbs([[c.name,companyHref(c)],[p.name]])+heading(c.name+' / '+p.department,p.name,p.description,avatars(p.agents))+tabs(projectHref(p),tab,[['home','Home','grid'],['combined','Combined','people'],['decisions','Decisions','check'],['map','Agent Map','orbit'],['routines','Routines','repeat'],['artefacts','Artefacts','file']])+content+'</div>';
}

export function decisionPage(id,state,companyId='',projectId='',embedded=false){
  const available=decisions.filter(d=>(!companyId||d.company===companyId)&&(!projectId||d.project===projectId));
  const waiting=available.filter(d=>!state.resolved.has(d.id));
  const selected=available.find(d=>d.id===id)||waiting[0]||available[0];
  const header=embedded?'<div class="scope-caption"><span>'+available.length+' decisions · '+waiting.length+' awaiting your choice</span><span>'+esc(projectId?findProject(projectId)?.name:companyId?findCompany(companyId)?.name:'All companies')+'</span></div>':heading('Across your portfolio','The decisions that need you.','Every decision is mapped to its company, project, owner, and evidence.');
  if(!selected)return '<div class="decision-scope">'+header+empty('No decisions in this scope.','Decisions for this '+(projectId?'project':companyId?'company':'portfolio')+' will appear here when they need your attention.')+'</div>';
  const d=selected;
  const base=projectId?'#/project/'+projectId+'/decisions':companyId?'#/company/'+companyId+'/decisions':'#/decisions';
  const decisionHref=id=>embedded?base+'?decision='+id:'#/decisions/'+id+scopeQuery(companyId,projectId);
  const evidenceScope=scopeQuery(companyId,projectId);
  const detail=state.resolved.has(d.id)?empty('Decision '+state.resolved.get(d.id)+'.','Your choice is recorded in the preview audit trail. No live action was taken.'):'<div class="row between"><span class="eyebrow">'+esc(findCompany(d.company).name)+' / '+esc(d.type)+'</span><span class="pill attention">Needs your decision</span></div><div class="decision-project-link">'+link(esc(findProject(d.project).name)+' '+icon('arrow'),'#/project/'+d.project)+'</div><h1>'+esc(d.title)+'</h1><p class="intro">'+esc(d.summary)+'</p><div class="recommendation"><span class="eyebrow">'+esc(findAgent(d.agent).name)+' recommends</span>'+esc(d.recommendation)+'</div><div class="evidence-grid">'+d.metrics.map(([value,label])=>'<div><strong>'+value+'</strong><small>'+label+'</small></div>').join('')+'</div><div class="eyebrow">The evidence behind it</div>'+d.evidence.map((item,i)=>link(icon('check')+esc(item)+' '+icon('arrow'),'#/evidence/'+d.id+'-'+i+evidenceScope,'evidence-row')).join('')+'<div class="decision-actions">'+action(icon('check')+' '+d.action,'data-approve',d.id,true)+action('Decline','data-decline',d.id)+action('Talk it through','data-command','Explain '+d.title)+'</div><p class="inline-note">Sample decision · approving records your choice in this preview only.</p>';
  const groups=[...new Set(available.map(d=>d.project))].map(project=>{
    const p=findProject(project),items=available.filter(d=>d.project===project);
    return '<section class="decision-group"><div class="decision-group-heading">'+link(esc(p.name),'#/project/'+p.id)+'<span>'+items.length+'</span></div>'+items.map(item=>'<a class="'+(item.id===d.id?'active':'')+'" href="'+decisionHref(item.id)+'"><span class="eyebrow">'+esc(findCompany(item.company).name)+' / '+esc(item.type)+'</span><h3>'+esc(item.title)+'</h3><small>'+esc(state.resolved.get(item.id)||findAgent(item.agent).name+' · Recommendation ready')+'</small></a>').join('')+'</section>';
  }).join('');
  return '<div class="decision-scope">'+header+'<div class="decision-layout"><aside class="decision-list">'+groups+'</aside><article class="decision-document">'+detail+'<div class="line"></div><div class="row">'+link('Open project '+icon('arrow'),'#/project/'+d.project)+link('See project map '+icon('orbit'),'#/project/'+d.project+'/map')+'</div></article></div></div>';
}
export function workforceTable(ids=agents.map(a=>a.id),companyId='',projectId=''){
  const query=scopeQuery(companyId,projectId);
  return '<div class="employee-table-wrap"><table class="employee-table"><caption class="visually-hidden">Employees, assignments, work, skills, and execution profiles</caption><thead><tr><th scope="col">Employee</th><th scope="col">Company assignments</th><th scope="col">Work in motion</th><th scope="col">Skills</th><th scope="col">Harness / model</th><th scope="col">Connection</th><th scope="col"><span class="visually-hidden">Profile</span></th></tr></thead><tbody>'+ids.map(id=>{
    const a=findAgent(id),cs=companies.filter(c=>c.agents.includes(id)),active=tasks.filter(t=>t.agent===id&&t.status==='doing'&&(!companyId||t.company===companyId)&&(!projectId||t.project===projectId));
    const href='#/agent/'+id+query;
    return '<tr data-agent-row="'+id+'" data-agent-href="'+href+'"><td><a class="employee-name" href="'+href+'">'+avatar(id)+'<span><strong>'+a.name+'</strong><small>'+a.role+'</small></span></a></td><td><div class="employee-companies">'+cs.map(c=>link(esc(c.name),companyHref(c))).join('')+'</div></td><td><strong class="work-count">'+active.length+'</strong><small>active tasks in scope</small></td><td><div class="table-skills">'+a.skills.map(s=>'<span>'+s+'</span>').join('')+'</div></td><td>Codex <small>Company-selected model</small></td><td>Subscription seat <small>Example configuration</small></td><td><a class="icon-button" href="'+href+'" aria-label="Open '+a.name+' profile">'+icon('arrow')+'</a></td></tr>';
  }).join('')+'</tbody></table>'+(!ids.length?empty('No employees assigned yet.','Assignments will appear here once a team is selected.'):'')+'</div>';
}
export function workforce(companyId='',projectId=''){
  const p=findProject(projectId),c=findCompany(companyId),ids=p?p.agents:c?c.agents:agents.map(a=>a.id);
  return '<div class="page-width">'+heading(c?c.name+(p?' / '+p.name:''):'Your digital employees','Workforce','Skills, assignments, current work, and execution profiles in one place.',c?link('All employees','#/workforce','btn'):'')+'<div class="scope-caption"><span>'+ids.length+' employees in this view</span><span>Click an employee to inspect their full profile</span></div>'+workforceTable(ids,companyId,projectId)+'</div>';
}

export function employee(a,companyId="",projectId=""){
  const assignments=companies.filter(c=>c.agents.includes(a.id));
  return '<div class="narrow-page">'+crumbs([['Workforce','#/workforce'+scopeQuery(companyId,projectId)],[a.name]])+heading(a.role,a.name,'One employee identity. Company-scoped work and deliberately shared capabilities.',avatar(a.id))+'<div class="detail-grid"><section><div class="eyebrow">Capabilities</div><div class="skill-chips">'+a.skills.map(s=>'<span>'+s+'</span>').join('')+'</div><h2>Company assignments</h2>'+assignments.map(c=>'<a class="task-row" href="'+companyHref(c)+'">'+mark(c)+'<div class="task-description"><strong>'+esc(c.name)+'</strong><p>'+scopeProjects(c.id).filter(p=>p.agents.includes(a.id)).map(p=>esc(p.name)).join(' · ')+'</p></div>'+icon('arrow')+'</a>').join('')+'<div class="line"></div><h2>Current work</h2>'+tasks.filter(t=>t.agent===a.id&&t.status!=='done').map(taskRow).join('')+'</section><aside><h2>Agent profile</h2><dl class="detail-list"><div><dt>Harness</dt><dd>Codex · example</dd></div><div><dt>Model</dt><dd>Company-selected</dd></div><div><dt>Connection</dt><dd>Subscription seat · example</dd></div><div><dt>Capability version</dt><dd>v3 · example</dd></div></dl><p class="inline-note">Skills, instructions, access, capacity, and spending controls remain part of the live agent profile.</p><div class="line"></div>'+action('Ask what '+a.name+' is working on','data-command','What is '+a.name+' working on?')+'</aside></div></div>';
}
export function taskPage(t){
  const p=findProject(t.project),c=findCompany(t.company);
  return '<div class="narrow-page">'+crumbs([[c.name,companyHref(c)],[p.name,projectHref(p)],[t.id]])+heading(t.id+' / '+statusLabel[t.status],t.title,t.note,link(icon('back')+' Workspace',projectHref(p)+'/combined','btn'))+'<div class="detail-grid"><section><div class="recommendation"><span class="eyebrow">What success looks like</span>Complete the scoped work, check it against the acceptance criteria, and leave a reviewable result for the next person.</div><div class="line"></div><h2>Task record</h2><div class="evidence-row">'+icon('check')+' Assigned to '+findAgent(t.agent).name+'</div><div class="evidence-row">'+icon('clock')+' '+esc(t.note)+'</div><div class="evidence-row">'+icon(t.status==='done'?'check':'file')+' '+(t.status==='done'?'Result attached and reviewed':'Work result will be attached when ready')+'</div><div class="line"></div><h2>Evidence & artefacts</h2>'+t.evidence.map((e,i)=>link(icon('file')+e+' '+icon('arrow'),'#/task-evidence/'+t.id+'/'+i,'evidence-row')).join('')+'</section><aside><span class="eyebrow">Accountable specialist</span><div class="task-row">'+avatar(t.agent)+'<strong>'+findAgent(t.agent).name+'</strong></div>'+link('Open employee profile '+icon('arrow'),'#/agent/'+t.agent)+'<dl class="detail-list"><div><dt>Company</dt><dd>'+esc(c.name)+'</dd></div><div><dt>Project</dt><dd>'+esc(p.name)+'</dd></div><div><dt>State</dt><dd>'+statusLabel[t.status]+'</dd></div></dl><p class="inline-note">Sample task record. Production execution events will preserve their source and timestamps.</p></aside></div></div>';
}
export function routineList(companyId,projectId){
  const ps=projects.filter(p=>p.tasks.length&&(!companyId||p.company===companyId)&&(!projectId||p.id===projectId));
  if(!ps.length)return empty('No routines yet.','An owner, scope, and schedule are needed before recurring work begins.');
  return '<div class="record-list">'+ps.map(p=>'<article class="record"><div class="row between"><span class="eyebrow">'+esc(findCompany(p.company).name)+' / '+esc(p.name)+'</span><span class="pill">Sample routine</span></div><h3>'+esc(p.kind==='Application'?'Application health review':'Feedback & iteration review')+'</h3><p>'+esc(p.kind==='Application'?'Review reliability signals, group failures, and escalate changes that need a decision.':'Review new comments and outcomes, record learnings, and propose the next iteration.')+'</p><dl class="detail-list"><div><dt>Owner</dt><dd>'+findAgent(p.lead).name+'</dd></div><div><dt>Schedule</dt><dd>'+ (p.kind==='Application'?'Every 15 minutes':'Every weekday')+'</dd></div></dl>'+link('Open owning workspace '+icon('arrow'),projectHref(p))+'</article>').join('')+'</div>';
}
export function artefactList(companyId,projectId){
  const records=scopeTasks(companyId,projectId).filter(t=>t.status==='done');
  return '<div class="record-list">'+records.map(t=>'<a class="record" href="#/task/'+t.id+'"><span class="eyebrow">'+esc(findCompany(t.company).name)+' / '+esc(findProject(t.project).name)+'</span><h3>'+esc(t.title)+' — result</h3><p>'+esc(t.note)+'.</p><div class="row between" style="margin-top:15px"><small>'+findAgent(t.agent).name+' · '+t.id+'</small>'+icon('arrow')+'</div></a>').join('')+(records.length?'':empty('No results yet.','Artefacts will appear when the team produces them.'))+'</div>';
}
export function evidence(id,taskId,index,companyId="",projectId=""){
  let title,body,href,scope;
  if(taskId){
    const t=tasks.find(t=>t.id===taskId);if(!t)return notFound();
    title=t.evidence[Number(index)]||'Task evidence';href='#/task/'+t.id;scope=t.id+' / '+t.title;
    body=Number(index)===0?'Sample acceptance criteria: fulfil the agreed scope, review the outcome, and attach evidence before marking the task complete.':t.status==='done'?'Sample result: '+t.note+'. The completed work and review are linked to this task.':'This task is not complete. The result is pending; no completed work is claimed.';
  }else{
    const match=/^(.*)-(\d+)$/.exec(id),d=decisions.find(d=>d.id===match?.[1]);if(!d)return notFound();
    title=d.evidence[Number(match[2])];href=projectId?'#/project/'+projectId+'/decisions?decision='+d.id:companyId?'#/company/'+companyId+'/decisions?decision='+d.id:'#/decisions/'+d.id;scope=findCompany(d.company).name+' / '+findProject(d.project).name;
    body='Sample evidence excerpt: '+title+'. This record supports the recommendation to '+d.recommendation.toLowerCase();
  }
  return '<div class="narrow-page">'+crumbs([['Back to the work',href],['Evidence']])+heading(scope,title,'A supporting record, kept with the decision or task it belongs to.')+'<div class="recommendation"><span class="eyebrow">Sample record</span>'+esc(body)+'</div><div class="line"></div>'+link(icon('back')+' Return to context',href,'btn')+'</div>';
}

export function audit(state,companyId='',projectId=''){
  const c=findCompany(companyId),p=findProject(projectId);
  const rows=state.audit.concat([
    {who:'Imani',what:'Attached the accessibility review to the release work.',company:'northstar',project:'customer-portal',scope:'Northstar / Customer portal',time:'Sample event'},
    {who:'Rae',what:'Requested a review of the launch creative.',company:'northstar',project:'launch-campaign',scope:'Northstar / Launch campaign',time:'Sample event'},
    {who:'CEO · Forma',what:'Assigned Rae to the creative pipeline.',company:'forma',project:'creative-pipeline',scope:'Forma / Company assignment',time:'Sample event'},
    {who:'Friday',what:'Linked Arbor to your portfolio.',company:'arbor',scope:'Portfolio / Company created',time:'Sample event'}
  ]).filter(r=>(!companyId||r.company===companyId)&&(!projectId||r.project===projectId));
  return '<div class="narrow-page">'+crumbs([...(c?[[c.name,companyHref(c)]]:[]),...(p?[[p.name,projectHref(p)]]:[]),['Audit Trail']])+heading(c?c.name+(p?' / '+p.name:''):'Across your portfolio','Audit Trail','Assignments, changes, and your choices, with the work and navigation context intact.',c?link('Portfolio audit','#/audit','btn'):'')+'<div class="record-list">'+rows.map(r=>'<article class="record"><div class="row between"><span class="eyebrow">'+esc(r.scope)+'</span><small>'+esc(r.time)+'</small></div><h3>'+esc(r.what)+'</h3><p>'+esc(r.who)+'</p>'+(r.project?link('Open project '+icon('arrow'),'#/project/'+r.project):'')+'</article>').join('')+(rows.length?'':empty('No events in this scope yet.','Recorded actions for this project will appear here.'))+'</div></div>';
}

export function mapSurface(companyId='',projectId=''){
  return '<div class="map-layout"><div class="map-space"><div class="map-record-count" id="map-count"></div><svg class="work-map" id="work-map" viewBox="0 0 900 610" role="group" aria-label="Interactive work graph"><g id="map-transform"></g></svg><div class="map-controls"><button class="icon-button" data-zoom="out" aria-label="Zoom out">'+icon('minus')+'</button><span id="map-zoom">100%</span><button class="icon-button" data-zoom="in" aria-label="Zoom in">'+icon('plus')+'</button><button class="icon-button" data-zoom="fit" aria-label="Fit current scope">'+icon('fit')+'</button></div></div><aside class="map-inspector" id="map-inspector"><span class="eyebrow">The shape of the work</span><h3>Every point means something.</h3><p>Select a record to inspect its owner and context. Drag the canvas to pan; use the controls to zoom.</p><p>Motion marks sample tasks in progress. A company or project opens in this same workspace.</p><div class="legend"><span><i></i>Company / project</span><span><i style="background:#555"></i>Agent assignment</span><span><i style="background:#888"></i>Task</span><span><i style="background:#b8b8b8"></i>Evidence</span></div>'+((companyId||projectId)?'<div class="line"></div>'+link('Portfolio map '+icon('arrow'),'#/map'):'')+'</aside></div>';
}
export function mapPage(){return '<div class="page-width">'+heading('Portfolio / Agent Map','Your world, connected.','Zoom from companies to projects, people, work, and evidence.')+mapSurface()+'</div>';}
export function collection(name,companyId,projectId){return '<div class="narrow-page">'+heading('Across your portfolio',name==='routines'?'Work that keeps moving.':'Results you can inspect.',name==='routines'?'Every routine has an owner, scope, schedule, and escalation condition.':'Work products stay with their company, project, task, and author.')+(name==='routines'?routineList(companyId,projectId):artefactList(companyId,projectId))+'</div>';}
export function search(query=''){
  return '<div class="narrow-page">'+heading('Search your portfolio','Find the thread.','Companies, projects, employees, and tasks, in one place.')+'<input id="search-input" class="search-input" value="'+esc(query)+'" placeholder="Search by name, task, or specialist…" aria-label="Search portfolio"><div id="search-results">'+searchResults(query)+'</div></div>';
}
export function searchResults(query){
  const q=query.toLowerCase().trim();
  const records=[...companies.map(c=>({name:c.name,scope:'Company',href:companyHref(c)})),...projects.map(p=>({name:p.name,scope:findCompany(p.company).name+' / Project',href:projectHref(p)})),...agents.map(a=>({name:a.name,scope:a.role,href:'#/agent/'+a.id})),...tasks.map(t=>({name:t.title,scope:t.id+' / '+findProject(t.project).name,href:'#/task/'+t.id}))];
  const matches=records.filter(r=>(r.name+' '+r.scope).toLowerCase().includes(q));
  return matches.length?matches.slice(0,20).map(r=>'<a class="task-row" href="'+r.href+'"><div class="task-description"><strong>'+esc(r.name)+'</strong><p>'+esc(r.scope)+'</p></div>'+icon('arrow')+'</a>').join(''):empty('No matches yet.','Try another company, person, or task name.');
}
export function createForm(type,companyId){
  const isCompany=type==='company',c=findCompany(companyId);
  return '<div class="narrow-page">'+heading(isCompany?'A new venture':c?.name||'Company',isCompany?'What are we building?':'Give the work a place.',isCompany?'Bring an existing application or start with a new idea.':'A project can develop an application, run a campaign, or own an ongoing initiative.')+'<form id="create-form" data-kind="'+type+'" data-company="'+esc(companyId)+'" class="record-list"><label class="eyebrow" for="record-name">'+(isCompany?'Company':'Project')+' name</label><input required maxlength="80" id="record-name" name="name" class="search-input" placeholder="'+(isCompany?'Your next venture':'A clear project name')+'"><label class="eyebrow" for="record-brief">What should it accomplish?</label><textarea required id="record-brief" name="brief" rows="3" style="width:100%;padding:15px;border:1px solid #ededed;border-radius:10px;font:inherit;margin:8px 0 22px" maxlength="500"></textarea>'+(isCompany?'<label class="eyebrow" for="repository-url">Existing GitHub repository (optional)</label><input id="repository-url" class="search-input" name="repository" type="url" placeholder="https://github.com/you/project">':'')+'<p class="inline-note">This creates a local preview record only. No repository is accessed and no agent starts work.</p><div class="decision-actions"><a class="btn" href="'+(isCompany?'#/companies':'#/company/'+companyId)+'">Cancel</a><button class="btn primary" type="submit">Create '+type+' preview '+icon('arrow')+'</button></div></form></div>';
}
export function notFound(){return '<div class="narrow-page">'+empty('This view is not available.','Return to your portfolio to choose a company or project.')+link('Back to Agent OS','#/','btn')+'</div>';}

export function sidebar(companyId='',projectId='',page=''){
  const c=findCompany(companyId),p=findProject(projectId),base=p?projectHref(p):c?companyHref(c):'';
  return '<div class="sidebar-main"><div class="eyebrow">Your companies</div>'+companies.map(item=>'<a href="'+companyHref(item)+'" class="'+(item.id===c?.id&&!projectId?'current':'')+'">'+mark(item)+esc(item.name)+'</a>').join('')+
    (c?'<div class="nav-divider"></div><div class="eyebrow">'+esc(c.name)+' / Projects</div>'+scopeProjects(c.id).map(item=>'<a href="'+projectHref(item)+'" class="'+(item.id===projectId?'current':'')+'">'+icon('grid')+esc(item.name)+'</a>').join('')+'<div class="nav-divider"></div><div class="eyebrow">'+(p?'This project':'This company')+'</div>'+[['decisions','Decisions','check'],['combined','Combined','grid'],['routines','Routines','repeat'],['artefacts','Artefacts','file']].map(([tab,title,i])=>'<a href="'+base+'/'+tab+'">'+icon(i)+title+'</a>').join('')+'<a href="'+companyHref(c)+'/profile">'+icon('people')+'Company profile</a>':'<div class="nav-divider"></div><a href="#/projects">'+icon('grid')+'All projects</a><a href="#/decisions">'+icon('check')+'Decisions</a><a href="#/map">'+icon('orbit')+'Agent Map</a>')+
    '</div><div class="sidebar-footer"><div class="nav-divider"></div><a href="#/workforce'+scopeQuery(companyId,projectId)+'" class="'+(page==='workforce'?'current':'')+'">'+icon('people')+'Workforce</a><a href="#/audit'+scopeQuery(companyId,projectId)+'" class="'+(page==='audit'?'current':'')+'">'+icon('clock')+'Audit Trail</a></div>';
}
