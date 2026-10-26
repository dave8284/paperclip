/* Standalone design fixtures. No application API, microphone, or model calls. */
(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  if (new URLSearchParams(location.search).has('thumbnail')) document.body.classList.add('is-thumbnail');
  if (document.body.classList.contains('gallery')) {
    const resize = new ResizeObserver(entries => entries.forEach(entry => {
      $('iframe', entry.target).style.transform = 'scale(' + entry.contentRect.width / 1280 + ')';
    }));
    $$('.design-preview').forEach(frame => resize.observe(frame));
    return;
  }

  const data = window.AGENT_OS_DEMO;
  const agent = id => data.agents.find(item => item.id === id);
  const company = id => data.companies.find(item => item.id === id);
  const icon = name => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + data.icons[name] + '</svg>';
  const avatar = person => '<span class="avatar" style="--avatar-color:' + person.color + '">' + person.name[0] + '</span>';
  const companyIcon = c => '<span class="company-icon ' + c.id + '">' + c.symbol + '</span>';
  const orb = () => '<div class="orb" aria-hidden="true"><div class="orb-core"></div><i class="orbit a"></i><i class="orbit b"></i><i class="orbit c"></i><i class="orbit d"></i></div>';
  const button = (title, attribute, value, primary = false) => '<button class="btn' + (primary ? ' primary' : '') + '" ' + attribute + '="' + escape(value) + '">' + title + '</button>';
  const state = { resolved: new Map(), selectedDecision: 'launch', surface: '', toastTimer: null, activity: 0 };
  let restoreFocus = null;
  const titles = { companies:'Your companies', decisions:'Decisions', workforce:'Shared workforce', audit:'Audit trail', routines:'Routines', artefacts:'Artefacts', work:'Work in motion', campaign:'Launch campaign', 'new-company':'Start a company' };
  const activeDecisions = () => data.decisions.filter(d => !state.resolved.has(d.id));

  function toast(message) {
    $('.toast').textContent = message;
    $('.toast').hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { $('.toast').hidden = true; }, 4000);
  }
  function closeSheet() {
    $('.sheet').hidden = true;
    $('.sheet-backdrop').hidden = true;
    document.body.classList.remove('sheet-open');
    if (restoreFocus && restoreFocus.isConnected) restoreFocus.focus();
  }
  function show(title, content, forceSheet = false) {
    const canvas = $('#dynamic-canvas');
    state.surface = title;
    if (canvas && !forceSheet) {
      closeSheet();
      document.body.classList.add('canvas-open');
      canvas.hidden = false;
      canvas.innerHTML = '<div class="section-heading"><h2>' + escape(title) + '</h2><button class="text-link" data-action="home">' + icon('back') + ' Back to Friday</button></div>' + content;
      canvas.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start'});
      $('button', canvas)?.focus({preventScroll:true});
    } else {
      if ($('.sheet').hidden) restoreFocus = document.activeElement;
      $('#sheet-title').textContent = title;
      $('#sheet-content').innerHTML = content;
      $('.sheet').hidden = false;
      $('.sheet-backdrop').hidden = false;
      document.body.classList.add('sheet-open');
      $('.sheet').focus();
    }
  }
  function companySurface(c) {
    return '<article class="surface-company card"><div class="row">' + companyIcon(c) + '<div><h3>' + c.name + '</h3><p>' + c.description + '</p><small>' + c.projects.length + ' projects · ' + c.agents.length + ' specialist assignments</small></div><span class="pill">' + c.status + '</span></div><div class="subtle-rule"></div>' +
      c.projects.map((p,i) => '<div class="row between" style="margin-top:14px"><span>' + p + '</span>' + (c.id === 'northstar' && i === 0 ? '<a class="text-link" href="05-operations-studio.html">Open workspace ' + icon('arrow') + '</a>' : button('View project','data-project',c.id + ':' + i)) + '</div>').join('') +
      '<div class="subtle-rule"></div><div class="row">' + c.agents.map(id => '<button data-agent="' + id + '" aria-label="View ' + agent(id).name + '">' + avatar(agent(id)) + '</button>').join('') + '</div></article>';
  }
  function workforce() {
    return '<p class="surface-intro">Eight shared specialists, twelve company assignments. Open a person to see their skills and the companies they work with.</p>' +
      data.agents.map(a => '<button class="surface-agent" data-agent="' + a.id + '">' + avatar(a) + '<div><strong>' + a.name + '</strong><small>' + a.role + ' · ' + data.companies.filter(c => c.agents.includes(a.id)).map(c => c.name).join(', ') + '</small></div><span class="pill">Profile ' + icon('arrow') + '</span></button>').join('');
  }
  function decisionDocument(d) {
    if (state.resolved.has(d.id)) return '<div class="success-block">' + icon('check') + '<h2>' + (state.resolved.get(d.id) === 'approved' ? 'Decision approved.' : 'Saved for later.') + '</h2><p>This change is only in the preview.<br>In Agent OS, Friday would record your decision and coordinate the next step.</p>' + button('Review remaining decisions','data-surface','decisions') + '</div>';
    const c = company(d.company);
    const a = agent(d.agent);
    return '<div class="document-top row between"><span class="eyebrow">' + c.name + ' / ' + d.tag + '</span><span class="pill amber">Needs your decision</span></div><span class="eyebrow">' + d.context + '</span><h1>' + d.title + '</h1><p class="document-intro">' + d.intro + '</p><div class="recommendation"><strong>' + a.name + ' recommends</strong>' + d.recommendation + '</div><div class="evidence-grid">' +
      d.metrics.map(m => '<div class="evidence-metric"><strong>' + m[0] + '</strong><small>' + m[1] + '</small></div>').join('') + '</div><div class="eyebrow">The evidence behind it</div>' +
      d.evidence.map((e,i) => '<button class="evidence-line" style="width:100%;text-align:left" data-evidence="' + d.id + ':' + i + '">' + icon('check') + '<span>' + e + '<small>View sample evidence ' + icon('arrow') + '</small></span></button>').join('') +
      '<div class="decision-actions">' + button(icon('check') + ' ' + d.action,'data-approve',d.id,true) + button('Later','data-defer',d.id) + button('Discuss with Friday','data-action','voice') + '</div><p class="document-meta">Sample recommendation · Your decision is recorded in this preview only.</p>';
  }
  function decisionsSurface() {
    const active = activeDecisions();
    if (!active.length) return '<div class="success-block">' + icon('check') + '<h2>You are all caught up.</h2><p>All sample decisions have been reviewed. Reload to start again.</p></div>';
    return '<p class="surface-intro">The decisions that need you, across your companies. Select one to see the recommendation and supporting evidence.</p><div class="stack">' + active.map(d => '<button class="decision-card" data-decision="' + d.id + '"><span class="eyebrow">' + company(d.company).name + ' · ' + d.tag + '</span><strong>' + d.short + '</strong><span class="row"><small>' + agent(d.agent).name + ' · Recommendation ready</small>' + icon('arrow') + '</span></button>').join('') + '</div>';
  }
  function routineSurface() {
    return '<p class="surface-intro">Recurring work belongs to a company and has a clear owner, schedule, and stopping condition.</p>' +
      [['Northstar','Post-release health check','Alex','Every 15 minutes','Check error rate and latency. Escalate when thresholds are exceeded.'],
       ['Forma','Creative feedback review','Rae','Every weekday','Review comments and campaign results. Draft the next experiment for approval.'],
       ['Arbor','Customer feedback triage','Eden','Every morning','Group new requests and propose changes to the project backlog.']].map(r =>
        '<article class="surface-company card"><span class="eyebrow">' + r[0] + '</span><h3 style="margin:10px 0">' + r[1] + '</h3><p>' + r[4] + '</p><div class="row between"><small>' + r[2] + ' · ' + r[3] + '</small><span class="pill teal">Sample routine</span></div></article>').join('');
  }
  function artefactSurface() {
    return '<p class="surface-intro">Results are kept with their company, project, task, and author.</p>' +
      [['Release review','Imani','Northstar','Sample release report: critical checks passed; two non-blocking visual issues logged. Rollback steps are documented.'],
       ['Creative experiment brief','Rae','Forma','Sample campaign plan: compare two opening hooks with the same audience, spend cap, and landing page.'],
       ['Feedback synthesis','Eden','Arbor','Sample research finding: customers need clearer appointment windows and confirmation messages.']].map(r =>
        '<article class="surface-company card"><span class="eyebrow">' + r[2] + ' / ' + r[1] + '</span><h3 style="margin:10px 0">' + r[0] + '</h3><p>' + r[3] + '</p><span class="pill">Artefact · v1</span></article>').join('');
  }
  function auditSurface() {
    const approvals = Array.from(state.resolved, ([id,status]) => [agent(data.decisions.find(d=>d.id===id).agent).name, data.decisions.find(d=>d.id===id).short + ' — ' + status, 'Your review · This session']);
    return '<p class="surface-intro">An inspectable record of assignments, decisions, and changes. These are sample events.</p>' +
      approvals.concat([['Maya','Requested approval for the staged rollout.','Northstar · Decision created'],['Imani','Attached release evidence to NS-038.','Northstar · Artefact attached'],['CEO · Forma','Assigned Rae to the creative pipeline.','Forma · Company assignment'],['Friday','Linked the new company to the portfolio.','Arbor · Company created']]).map(row =>
        '<div class="evidence-line">' + icon('clock') + '<div><strong>' + row[0] + '</strong><p>' + row[1] + '</p><small>' + row[2] + '</small></div></div>').join('');
  }
  function openSurface(name) {
    let content;
    switch (name) {
      case 'companies': content = '<p class="surface-intro">Three independent ventures. Friday sees your portfolio; each company has its own projects, people, and work.</p>' + data.companies.map(companySurface).join(''); break;
      case 'workforce': content = workforce(); break;
      case 'decisions': content = decisionsSurface(); break;
      case 'routines': content = routineSurface(); break;
      case 'artefacts': content = artefactSurface(); break;
      case 'audit': content = auditSurface(); break;
      case 'work': content = '<p class="surface-intro">Choose how you want to see the same work.</p><div class="stack"><a class="btn" href="03-constellation.html">' + icon('orbit') + ' Explore the portfolio map</a><a class="btn" href="05-operations-studio.html">' + icon('grid') + ' Open the combined project workspace</a></div>'; break;
      case 'campaign': content = '<span class="eyebrow">Northstar / Marketing</span><h1>Launch campaign</h1><p class="surface-intro">Rae is preparing the announcement, Noah is refining the creative, and Maya will review the message before launch.</p>' + button('Meet Rae','data-agent','rae') + '<div class="subtle-rule"></div>' + artefactSurface(); break;
      case 'new-company': content = '<div class="voice-preview">' + orb() + '<h2>Every venture starts with an idea.</h2><p>Tell Friday what you want to build, or bring an existing GitHub project.</p>' + button('Try the conversation','data-action','type',true) + '<small>This design preview does not create a real company.</small></div>'; break;
      default: content = '<p class="surface-intro">Choose a preview command below.</p>' + decisionsSurface();
    }
    show(titles[name] || 'Friday', content);
  }
  function openAgent(id) {
    const a = agent(id);
    const assignments = data.companies.filter(c=>c.agents.includes(id));
    show(a.name + ' / ' + a.role,
      '<div class="row">' + avatar(a) + '<div><h1>' + a.name + '</h1><span class="pill teal">Shared specialist</span></div></div><p class="surface-intro" style="margin-top:20px">One employee identity, with separate assignments and work context in each company.</p><div class="eyebrow">Capabilities</div><div class="skill-chips">' + a.skills.map(s=>'<span>' + s + '</span>').join('') + '</div><div class="eyebrow">Company assignments</div>' + assignments.map(c=>'<button class="surface-agent" data-company="' + c.id + '">' + companyIcon(c) + '<div><strong>' + c.name + '</strong><small>' + c.projects.join(' · ') + '</small></div>' + icon('arrow') + '</button>').join('') + '<dl class="detail-list"><div><dt>Harness</dt><dd>Codex · sample configuration</dd></div><div><dt>Connection</dt><dd>Subscription seat · sample</dd></div><div><dt>Capability version</dt><dd>v3 · company-selected</dd></div></dl><div class="mock-chat"><span class="eyebrow">Ask ' + a.name + '</span><p>“Which companies are you working with?”</p><p><strong>' + a.name + ':</strong> I am assigned to ' + assignments.map(c=>c.name).join(' and ') + '. My shared capabilities travel with me; company-specific context stays with the assignment.</p><small>Example conversation</small></div>');
  }
  function openTask(id) {
    const task = data.tasks.find(t=>t.id===id);
    show(task.id + ' / Northstar', '<span class="pill teal">' + task.stage + '</span><h1>' + task.title + '</h1><p class="surface-intro">' + task.note + '.</p><button class="surface-agent" data-agent="' + task.agent + '">' + avatar(agent(task.agent)) + '<div><strong>' + agent(task.agent).name + '</strong><small>Responsible specialist · ' + task.kind + '</small></div>' + icon('arrow') + '</button><div class="subtle-rule"></div><div class="eyebrow">Execution trail · sample</div>' + ['Task context loaded and acceptance criteria reviewed','Work performed against the agreed scope','Evidence attached for the next review'].map((e,i)=>'<div class="evidence-line">' + icon(i===2?'file':'check') + '<div>' + e + '<small>' + (i===2 && task.stage!=='Done'?'Next step':'Recorded example') + '</small></div></div>').join('') + '<div class="decision-actions">' + button('View artefacts','data-surface','artefacts') + button('Ask Friday','data-action','type') + '</div>');
  }
  function updateDecisionCounts() {
    $$('[data-decision-count]').forEach(el=> { el.textContent = activeDecisions().length; });
    $$('[data-brief]').forEach(el=>{
      const resolved = state.resolved.has(el.dataset.brief);
      el.style.opacity = resolved ? '.5' : '';
      el.classList.toggle('active',el.dataset.brief===state.selectedDecision);
    });
  }
  function resolveDecision(id, action) {
    state.resolved.set(id,action);
    updateDecisionCounts();
    const d = data.decisions.find(d=>d.id===id);
    if ($('#brief-document')) $('#brief-document').innerHTML = decisionDocument(d);
    if (!$('.sheet').hidden) show('Decision recorded',decisionDocument(d),true);
    if ($('#dynamic-canvas') && !$('#dynamic-canvas').hidden) show('Decisions',decisionsSurface());
    toast(action === 'approved' ? 'Approved in this preview. No live action was taken.' : 'Saved for later in this preview.');
  }
  function command(value) {
    const query = value.trim().toLowerCase();
    if (!query) return;
    $('.composer-popover').hidden = true;
    if (/decision|attention|block|need/.test(query)) openSurface('decisions');
    else if (/compan|portfolio/.test(query)) openSurface('companies');
    else if (/agent|workforce|team|people/.test(query)) openSurface('workforce');
    else if (/routine|recurr/.test(query)) openSurface('routines');
    else if (/artefact|artifact|result/.test(query)) openSurface('artefacts');
    else if (/trail|audit|history/.test(query)) openSurface('audit');
    else if (/work|map|graph|project/.test(query)) openSurface('work');
    else show('Friday', '<p class="surface-intro">You asked: “' + escape(value) + '”</p><h2>A preview of your conversation space.</h2><p class="surface-intro" style="margin-top:15px">In the full application, Friday would use your request to bring up the right content. Try one of these sample views.</p><div class="suggested-prompts">' + button('Decisions','data-surface','decisions') + button('Companies','data-surface','companies') + button('Workforce','data-surface','workforce') + '</div>');
  }
  document.addEventListener('click', event => {
    const el = event.target.closest('button, a[data-action], [data-action="close"]');
    if (!el) return;
    const d = el.dataset;
    if (d.surface) openSurface(d.surface);
    else if (d.company) show(company(d.company).name,companySurface(company(d.company)));
    else if (d.project) {
      const [id,index] = d.project.split(':'); const c = company(id);
      show(c.projects[Number(index)],'<span class="eyebrow">' + c.name + ' / Project</span><h1>' + c.projects[Number(index)] + '</h1><p class="surface-intro">A company-scoped project with its own tasks, team, routines, and results.</p>' + c.agents.map(id=>'<button class="surface-agent" data-agent="' + id + '">' + avatar(agent(id)) + '<div><strong>' + agent(id).name + '</strong><small>' + agent(id).role + '</small></div>' + icon('arrow') + '</button>').join(''));
    }
    else if (d.agent) openAgent(d.agent);
    else if (d.task) openTask(d.task);
    else if (d.decision) show('Your decision', '<article class="decision-document">' + decisionDocument(data.decisions.find(x=>x.id===d.decision)) + '</article>');
    else if (d.brief) { state.selectedDecision=d.brief; $('#brief-document').innerHTML=decisionDocument(data.decisions.find(x=>x.id===d.brief)); updateDecisionCounts(); }
    else if (d.approve) resolveDecision(d.approve,'approved');
    else if (d.defer) resolveDecision(d.defer,'deferred');
    else if (d.evidence) {
      const [id,index] = d.evidence.split(':'); const item=data.decisions.find(x=>x.id===id);
      show('Supporting evidence','<span class="eyebrow">' + item.context + '</span><h1>' + item.evidence[Number(index)] + '</h1><p class="surface-intro">Sample evidence excerpt: the responsible specialist reviewed the acceptance criteria, recorded the outcome, and attached the result to this decision.</p><div class="recommendation"><strong>Recommendation context</strong>' + item.recommendation + '</div><div class="decision-actions">' + button('Back to decision','data-decision',id) + '</div>',true);
    }
    else if (d.board) { document.body.classList.toggle('board-only',d.board==='board'); $$('[data-board]').forEach(b=>b.classList.toggle('active',b===el)); }
    else if (d.action === 'close') closeSheet();
    else if (d.action === 'type') { restoreFocus=document.activeElement; $('.composer-popover').hidden=false; $('#friday-input').focus(); }
    else if (d.action === 'close-type') { $('.composer-popover').hidden=true; restoreFocus?.focus(); }
    else if (d.action === 'home') { document.body.classList.remove('canvas-open'); $('#dynamic-canvas').hidden=true; $('.canvas-hero [data-action="voice"]').focus(); }
    else if (d.action === 'open-graph') location.href='03-constellation.html';
    else if (d.action === 'project-home') toast('You are viewing Northstar’s customer portal.');
    else if (d.action === 'voice') show('A conversation with Friday','<div class="voice-preview">' + orb() + '<h2>What would you like to see?</h2><p>Try a sample spoken request below.<br>This is a voice interaction preview; your microphone is not recording.</p><div class="suggested-prompts">' + button('“Show my decisions”','data-surface','decisions') + button('“Who is working on what?”','data-surface','workforce') + button('“Show my companies”','data-surface','companies') + '</div></div>',true);
    else if (d.action === 'next-event') {
      const events = [['leo','attached a reviewable change.','NS-036 · Implementation'],['imani','received the handoff and opened the checks.','NS-038 · Verification'],['maya','linked the release report to your decision.','Decision · Approval requested']];
      const item=events[state.activity++ % events.length];
      $('#studio-event').innerHTML='<div class="mini-event">' + avatar(agent(item[0])) + '<div><p><strong>' + agent(item[0]).name + '</strong> ' + item[1] + '</p><small>' + item[2] + '</small></div></div>';
      toast('Next sample event. Task data is unchanged.');
    }
  });
  $('#friday-form').addEventListener('submit',event=>{event.preventDefault();command($('#friday-input').value);$('#friday-input').value='';});
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape') {
      if (!$('.composer-popover').hidden) { $('.composer-popover').hidden=true; restoreFocus?.focus(); }
      else closeSheet();
    }
    if(event.key==='Tab') {
      const dialog=!$('.composer-popover').hidden?$('.composer-popover'):!$('.sheet').hidden?$('.sheet'):null;
      if(!dialog) return;
      const elements=$$('button,a[href],input,[tabindex="0"]',dialog).filter(e=>!e.hidden);
      const first=elements[0],last=elements[elements.length-1];
      if(event.shiftKey && (document.activeElement===first||document.activeElement===dialog)) {event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
    }
  });
  if ($('#brief-document')) $('#brief-document').innerHTML=decisionDocument(data.decisions[0]);
  $('#agent-filter')?.addEventListener('change',event=>{
    $$('[data-task-agent]').forEach(card=>{card.hidden=event.target.value!=='all'&&card.dataset.taskAgent!==event.target.value;});
    $$('.kanban > section').forEach(column=>{$('[data-column-count]',column).textContent=$$('[data-task-agent]',column).filter(c=>!c.hidden).length;});
  });

  // Meaningful graph records: portfolio, companies, projects, assignments, tasks, evidence.
  if ($('#work-graph')) {
    const nodes=[{id:'friday',type:'coordinator',label:'Friday',x:490,y:345,color:'#197b82'}], edges=[];
    const centres=[[245,270],[760,270],[560,555]];
    data.companies.forEach((c,ci)=>{
      const [cx,cy]=centres[ci];
      nodes.push({id:c.id,type:'company',label:c.name,x:cx,y:cy,color:c.color,company:c.id});
      edges.push({from:'friday',to:c.id});
      c.projects.forEach((p,pi)=>{
        const angle=ci*.4+pi*Math.PI+.4;
        const project={id:c.id+'-project-'+pi,type:'project',label:p,x:cx+Math.cos(angle)*84,y:cy+Math.sin(angle)*64,color:c.color,company:c.id,index:pi};
        nodes.push(project); edges.push({from:c.id,to:project.id});
      });
      c.agents.forEach((id,i)=>{
        const angle=i/c.agents.length*Math.PI*2-.8, radius=130+(i%2)*14;
        const a=agent(id), assignment={id:c.id+'-'+id,type:'assignment',label:a.name,x:cx+Math.cos(angle)*radius,y:cy+Math.sin(angle)*radius*.74,color:'#8c83b7',company:c.id,agent:id};
        nodes.push(assignment); edges.push({from:c.id+'-project-'+(i%2),to:assignment.id});
        const taskNames = {maya:'Review launch scope',leo:'Implement release changes',imani:'Verify release evidence',rae:'Prepare creative test',noah:'Refine customer journey',alex:'Check application health',jules:'Qualify new enquiries',eden:'Group customer feedback'};
        const task={id:assignment.id+'-task',type:'task',label:taskNames[id],x:cx+Math.cos(angle+.15)*(radius+39),y:cy+Math.sin(angle+.15)*(radius+39)*.74,color:'#468b71',company:c.id,agent:id};
        nodes.push(task); edges.push({from:assignment.id,to:task.id,active:ci===0 && (id==='leo'||id==='imani')});
        for(let e=0;e<2;e++){
          const record={id:task.id+'-evidence-'+e,type:'evidence',label:e===0?'Task acceptance criteria':'Work result / review note',x:task.x+Math.cos(angle+(e===0?-.42:.42))*31,y:task.y+Math.sin(angle+(e===0?-.42:.42))*31,color:'#b1894b',company:c.id,agent:id,parent:task.label};
          nodes.push(record); edges.push({from:task.id,to:record.id});
        }
      });
    });
    const transform=$('#graph-transform'), svg=$('#work-graph');
    transform.innerHTML=edges.map(e=>{
      const a=nodes.find(n=>n.id===e.from),b=nodes.find(n=>n.id===e.to);
      const dx=b.x-a.x,dy=b.y-a.y;
      return '<path class="graph-edge'+(e.active?' active':'')+'" d="M'+a.x+' '+a.y+' Q'+((a.x+b.x)/2-dy*.15)+' '+((a.y+b.y)/2+dx*.15)+' '+b.x+' '+b.y+'"/>';
    }).join('')+nodes.map(n=>{
      const radius=n.type==='company'?29:n.type==='coordinator'?25:n.type==='project'?9:n.type==='assignment'?7:n.type==='task'?4:2.5;
      const label=n.type==='company'||n.type==='coordinator'?'<text text-anchor="middle" y="4">'+n.label+'</text>':n.type==='project'||n.type==='assignment'?'<text x="12" y="3">'+n.label+'</text>':'';
      return '<g class="graph-node '+n.type+'" data-node-id="'+n.id+'" tabindex="0" role="button" aria-label="'+escape(n.type+': '+n.label)+'" transform="translate('+n.x+','+n.y+')" style="--node-color:'+n.color+'"><title>'+escape(n.type+' · '+n.label)+'</title><circle class="hit" r="'+Math.max(radius,12)+'"/>'+(n.type==='company'?'<circle class="company-halo" r="39"/>':'')+'<circle class="record" r="'+radius+'"/>'+label+'</g>';
    }).join('');
    $('#graph-summary').textContent=nodes.length+' meaningful records · 3 companies · 8 shared specialists';
    let zoom=1, offset={x:0,y:0},drag=null,moved=false;
    function applyTransform(){transform.setAttribute('transform','translate('+offset.x+' '+offset.y+') translate(500 340) scale('+zoom+') translate(-500 -340)');$('#zoom-label').textContent=Math.round(zoom*100)+'%';}
    function select(id){
      const n=nodes.find(n=>n.id===id);
      $$('.graph-node').forEach(el=>el.classList.toggle('selected',el.dataset.nodeId===id));
      const c=n.company?company(n.company):null;
      $('#graph-breadcrumb').textContent=c?'Portfolio / '+c.name+' / '+n.type:'Portfolio / Friday';
      if(n.type==='company'){zoom=1.8;offset={x:(500-n.x)*zoom,y:(340-n.y)*zoom};applyTransform();}
      let details='';
      if(n.type==='company')details='<p class="inspector-description">'+c.description+'. Two projects, with a company-scoped team and evidence attached to the work.</p><dl class="detail-list"><div><dt>Projects</dt><dd>2</dd></div><div><dt>Specialists</dt><dd>'+c.agents.length+'</dd></div></dl>'+button('Open company','data-company',c.id);
      else if(n.type==='assignment')details='<p class="inspector-description">'+agent(n.agent).name+' is assigned to '+c.name+'. This assignment shares an employee identity with other companies, while its work context stays here.</p><div class="skill-chips">'+agent(n.agent).skills.map(s=>'<span>'+s+'</span>').join('')+'</div>'+button('Open employee profile','data-agent',n.agent);
      else if(n.type==='project')details='<p class="inspector-description">A project within '+c.name+'. Connections show its specialist assignments, tasks, and evidence.</p>'+button('Inspect project','data-project',c.id+':'+n.index);
      else if(n.type==='task')details='<p class="inspector-description">'+agent(n.agent).name+' owns this task for '+c.name+'. The two linked evidence records contain its acceptance criteria and work result.</p>'+button('Inspect owner','data-agent',n.agent)+button('View artefacts','data-surface','artefacts');
      else if(n.type==='evidence')details='<p class="inspector-description">A sample evidence record for “'+n.parent+'”, owned by '+agent(n.agent).name+' in '+c.name+'.</p><div class="recommendation"><strong>Record excerpt</strong>'+ (n.label==='Task acceptance criteria'?'Scope, expected outcome, and the conditions for completing the task.':'The specialist’s result, review outcome, and next action.')+'</div>';
      else details='<p class="inspector-description">Friday coordinates your portfolio and brings decisions to you. Company teams own the execution.</p>'+button('Review decisions','data-surface','decisions');
      $('#graph-inspector').innerHTML='<div class="eyebrow">'+(c?c.name+' / ':'')+n.type+'</div><h2>'+escape(n.label)+'</h2>'+details+'<div class="subtle-rule"></div><button class="text-link" data-zoom="reset">'+icon('back')+' Back to all companies</button><p class="graph-app-note">Every point represents a selectable sample record. Lines represent coordination, assignment, or attached evidence.</p>';
    }
    document.addEventListener('click',e=>{
      const control=e.target.closest('[data-zoom]');
      if(control){
        const action=control.dataset.zoom,previous=zoom;
        if(action==='reset'){zoom=1;offset={x:0,y:0};$('#graph-breadcrumb').textContent='Portfolio / All companies';}
        else {zoom=Math.max(.55,Math.min(3,zoom*(action==='in'?1.25:.8)));offset.x*=zoom/previous;offset.y*=zoom/previous;}
        applyTransform();
      }
      const node=e.target.closest('[data-node-id]');
      if(node&&!moved)select(node.dataset.nodeId);
    });
    svg.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.dataset.nodeId){e.preventDefault();select(e.target.dataset.nodeId);}});
    svg.addEventListener('pointerdown',e=>{
      if(e.target.closest('[data-node-id]'))return;
      const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      drag={point,start:{...offset}};moved=false;svg.setPointerCapture(e.pointerId);$('.graph-stage').classList.add('dragging');
    });
    svg.addEventListener('pointermove',e=>{
      if(!drag)return;
      const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      if(Math.abs(p.x-drag.point.x)+Math.abs(p.y-drag.point.y)>3)moved=true;
      offset={x:drag.start.x+p.x-drag.point.x,y:drag.start.y+p.y-drag.point.y};applyTransform();
    });
    const endDrag=()=>{drag=null;$('.graph-stage').classList.remove('dragging');setTimeout(()=>{moved=false;},0);};
    svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',endDrag);
  }
})();
