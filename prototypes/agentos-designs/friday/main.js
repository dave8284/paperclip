import {companies,agents,projects,tasks,decisions,findCompany,findProject,findAgent,parseRoute,interpret} from './model.js';
import {esc,icon,hydrateIcons} from './icons.js';
import * as views from './views.js';
import {createOrb} from './orb.js';
import {createVoice} from './voice.js';
import {mountGraph} from './graph.js';

const $=selector=>document.querySelector(selector);
const presence=$('#friday-presence'),canvas=$('#canvas'),historyDialog=$('#history-dialog'),composer=$('#composer-dialog');
const thumbnail=new URLSearchParams(location.search).has('thumbnail');
if(thumbnail)document.body.classList.add('is-thumbnail');
const state={resolved:new Map(),audit:[],history:[],agentFilter:'',route:parseRoute(location.hash),partial:'',transcriptHidden:false};
const orb=createOrb($('#friday-orb'));
let disposeGraph=()=>{},toastTimer,previousProject='';
hydrateIcons();
function toast(message){const target=$('#toast');target.textContent=message;target.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{if(target.isConnected)target.hidden=true;},4200);}
function voiceState(value,message){
  presence.dataset.state=value;orb.setState(value);$('#voice-status').textContent=message;
  const active=['requesting','listening','thinking','speaking'].includes(value);
  $('#talk-button').setAttribute('aria-pressed',String(active));
  $('#talk-label').textContent=active?'Pause voice':'Talk to Friday';
  $('#talk-button').setAttribute('aria-label',active?'Pause Friday voice':'Talk to Friday');
}
const voice=createVoice({
  onState:voiceState,
  onInterim:partial=>{state.partial=partial;if(partial)state.transcriptHidden=false;renderTranscript();},
  onUtterance:(text,spoken)=>request(text,spoken)
});
voiceState('ready','Here when you need me');
function navigate(href){if(location.hash===href)render();else location.hash=href;}
function log(role,text){
  const route=state.route;
  const scope=route.page==='project'?findProject(route.id)?.name:route.page==='company'?findCompany(route.id)?.name:'Portfolio';
  state.history.push({role,text,scope:scope||'Portfolio',time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});
  state.transcriptHidden=false;renderTranscript();renderHistory();
}
function renderTranscript(){
  $('#transcript').hidden=state.transcriptHidden||(!state.partial&&!state.history.length);
  const recent=state.history.slice(-2);
  $('#transcript-content').innerHTML=recent.map(turn=>'<p><strong>'+ (turn.role==='user'?'You':'Friday')+'</strong>'+esc(turn.text.length>225?turn.text.slice(0,225)+'…':turn.text)+'</p>').join('')+(state.partial?'<p><strong>You · listening</strong>'+esc(state.partial)+'</p>':'');
}
function renderHistory(){
  $('#conversation-log').innerHTML=state.history.length?state.history.map(turn=>'<article class="conversation-turn '+turn.role+'"><div class="row between"><strong>'+(turn.role==='user'?'You':'Friday')+'</strong><span>'+esc(turn.scope)+' · '+turn.time+'</span></div><p>'+esc(turn.text)+'</p></article>').join(''):'<div class="empty-state"><h2>A continuous conversation.</h2><p>Speak to Friday or type below. Your conversation stays with you as you move through the preview.</p></div>';
  $('#conversation-log').scrollTop=$('#conversation-log').scrollHeight;
}
function request(text,spoken=false){
  const trimmed=text.trim();if(!trimmed)return;
  if(!spoken)voice.stop('One moment…');
  voiceState('thinking','One moment…');log('user',trimmed);
  let result=interpret(trimmed,state.route);
  const person=agents.find(a=>new RegExp('\\b'+a.name+'\\b','i').test(trimmed));
  const decision=decisions.find(d=>trimmed.toLowerCase().includes(d.title.toLowerCase()));
  if(person){
    const active=tasks.filter(t=>t.agent===person.id&&t.status==='doing'),cs=companies.filter(c=>c.agents.includes(person.id));
    result={route:'#/agent/'+person.id,reply:person.name+' works with '+cs.map(c=>c.name).join(' and ')+'. '+(active.length?'Current work includes '+active.slice(0,3).map(t=>t.title.toLowerCase()).join(', ')+'.':'There are no sample tasks in motion for this person.')};
  }else if(decision&&/explain|talk|why|recommend/i.test(trimmed)){
    result={route:'#/decisions/'+decision.id,reply:findAgent(decision.agent).name+' recommends: '+decision.recommendation+' The evidence is here for you to review.'};
  }
  if(composer.open)composer.close();
  if(result.route){if(historyDialog.open)historyDialog.close();navigate(result.route);}
  log('friday',result.reply);voice.respond(result.reply,{spoken});
}
function currentScope(route){
  if(route.page==='company')return {company:route.id,project:''};
  if(route.page==='project')return {company:findProject(route.id)?.company,project:route.id};
  if(route.page==='task'||route.page==='task-evidence'){
    const task=tasks.find(t=>t.id===route.id);return {company:task?.company,project:task?.project};
  }
  return {};
}
function render({preserveScroll=false}={}){
  disposeGraph();
  state.route=parseRoute(location.hash);
  const route=state.route,isHome=route.page==='home',scope=currentScope(route);
  if(previousProject!==scope.project){state.agentFilter='';previousProject=scope.project;}
  // Keep the same orb and voice session alive while changing the canvas.
  const oldRect=presence.getBoundingClientRect();
  document.body.append(presence);
  let content;
  switch(route.page){
    case 'home':content=views.home(state);break;
    case 'companies':content=views.portfolio(state);break;
    case 'projects':content=views.allProjects();break;
    case 'company':content=findCompany(route.id)?views.companyPage(findCompany(route.id),route.tab,state):views.notFound();break;
    case 'project':content=findProject(route.id)?views.projectPage(findProject(route.id),route.tab,state):views.notFound();break;
    case 'decisions':content=views.decisionPage(route.id,state,route.company);break;
    case 'workforce':content=views.workforce();break;
    case 'agent':content=findAgent(route.id)?views.employee(findAgent(route.id)):views.notFound();break;
    case 'task':content=tasks.find(t=>t.id===route.id)?views.taskPage(tasks.find(t=>t.id===route.id)):views.notFound();break;
    case 'task-evidence':content=views.evidence(null,route.id,route.tab);break;
    case 'evidence':content=views.evidence(route.id);break;
    case 'routines':case 'artefacts':content=views.collection(route.page);break;
    case 'audit':content=views.audit(state);break;
    case 'map':content=views.mapPage();break;
    case 'search':content=views.search();break;
    case 'new-company':content=views.createForm('company','');break;
    case 'new-project':content=findCompany(route.id)?views.createForm('project',route.id):views.notFound();break;
    default:content=views.notFound();
  }
  canvas.innerHTML=content;
  document.body.classList.toggle('home-view',isHome);
  presence.classList.toggle('is-home',isHome);
  if(isHome)$('#home-presence-slot').append(presence);
  const companyNav=$('#company-nav');
  companyNav.hidden=!scope.company;
  companyNav.innerHTML=scope.company?views.sidebar(scope.company,scope.project):'';
  document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('current',el.dataset.nav===route.page||(el.dataset.nav==='companies'&&!!scope.company)||(el.dataset.nav==='workforce'&&route.page==='agent')));
  $('#decision-count').textContent=views.pending(state).length;
  document.title=(isHome?'Friday':scope.project?findProject(scope.project)?.name:scope.company?findCompany(scope.company)?.name:route.page.charAt(0).toUpperCase()+route.page.slice(1))+' · Agent OS preview';
  if($('#work-map'))disposeGraph=mountGraph(scope.company||'',scope.project||'');
  if(!preserveScroll&&!thumbnail){window.scrollTo({top:0,behavior:'instant'});if(!isHome)canvas.focus({preventScroll:true});}
  if(!thumbnail&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    const rect=presence.getBoundingClientRect();
    const dx=oldRect.left-rect.left,dy=oldRect.top-rect.top;
    if(Math.abs(dx)+Math.abs(dy)>60&&oldRect.width)presence.animate([{transform:'translate('+dx+'px,'+dy+'px)',opacity:.5},{transform:'translate(0,0)',opacity:1}],{duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});
  }
}
function decide(id,disposition){
  const d=decisions.find(d=>d.id===id);if(!d||state.resolved.has(id))return;
  state.resolved.set(id,disposition);
  state.audit.unshift({who:'You',what:d.title+' — '+disposition,scope:findCompany(d.company).name+' / '+findProject(d.project).name,time:'This preview session'});
  log('friday','You '+disposition+' “'+d.title+'”. I’ve recorded your choice in the preview audit trail. No live action was taken.');
  render({preserveScroll:true});toast('Decision '+disposition+' in the preview.');
}
document.addEventListener('click',event=>{
  const el=event.target.closest('button');if(!el)return;
  if(el.dataset.command){request(el.dataset.command);return;}
  if(el.dataset.approve){decide(el.dataset.approve,'approved');return;}
  if(el.dataset.decline){decide(el.dataset.decline,'declined');return;}
  switch(el.dataset.action){
    case 'talk':if(historyDialog.open)historyDialog.close();if(composer.open)composer.close();voice.toggle();break;
    case 'history':renderHistory();if(composer.open)composer.close();historyDialog.showModal();break;
    case 'type':if(historyDialog.open)historyDialog.close();composer.showModal();composer.querySelector('input[name="message"]').focus();break;
    case 'close-history':historyDialog.close();break;
    case 'close-type':composer.close();break;
    case 'hide-transcript':state.transcriptHidden=true;renderTranscript();break;
    case 'search':navigate('#/search');requestAnimationFrame(()=>$('#search-input')?.focus());break;
  }
});
document.addEventListener('submit',event=>{
  if(event.target.id==='history-form'||event.target.id==='composer-form'){
    event.preventDefault();const input=event.target.elements.message;request(input.value);input.value='';return;
  }
  if(event.target.id==='create-form'){
    event.preventDefault();
    const form=event.target,values=new FormData(form),name=String(values.get('name')||'').trim(),brief=String(values.get('brief')||'').trim();
    if(!name||!brief)return;
    const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+Date.now().toString(36);
    if(form.dataset.kind==='company'){
      const repository=String(values.get('repository')||'').trim();
      if(repository&&!/^https:\/\/github\.com\/[^/]+\/[^/?#]+\/?$/.test(repository)){toast('Use a GitHub repository URL, such as https://github.com/owner/project.');return;}
      companies.push({id,name,mark:name[0],description:repository?'Existing application':'New venture',purpose:brief,ceo:'Not assigned',phase:'Draft',agents:[],repository});
      state.audit.unshift({who:'You',what:'Created a draft company: '+name,scope:'Portfolio / Preview record',time:'This preview session'});
      navigate('#/company/'+id);
    }else{
      projects.push({id,company:form.dataset.company,name,description:brief,department:'Planning',lead:null,kind:'Project',agents:[],asset:null,tasks:[]});
      state.audit.unshift({who:'You',what:'Created a draft project: '+name,scope:findCompany(form.dataset.company).name+' / Preview record',time:'This preview session'});
      navigate('#/project/'+id);
    }
    toast('Created in this preview only. No agent work has started.');
  }
});
document.addEventListener('change',event=>{
  if(event.target.id==='agent-filter'){state.agentFilter=event.target.value;render({preserveScroll:true});$('#agent-filter')?.focus();}
  if(event.target.id==='speak-replies')voice.setSpeakReplies(event.target.checked);
});
document.addEventListener('input',event=>{
  if(event.target.id==='search-input')$('#search-results').innerHTML=views.searchResults(event.target.value);
});
window.addEventListener('hashchange',()=>render());
window.addEventListener('pagehide',()=>{clearTimeout(toastTimer);disposeGraph();});
render();
