import {companies,findCompany,findProject,findAgent,scopeProjects,scopeTasks} from './model.js';
import {icon,esc} from './icons.js';
export function graphRecords(companyId='',projectId=''){
  const nodes=[],edges=[],project=projectId?findProject(projectId):null;
  const cs=companies.filter(c=>(!companyId||c.id===companyId)&&(!project||c.id===project.company));
  const add=(node,parent,active=false)=>{nodes.push(node);if(parent)edges.push({from:parent,to:node.id,active});return node;};
  if(!project)add({id:'portfolio',kind:'portfolio',label:'Friday',x:450,y:310,href:'#/'});
  cs.forEach((c,ci)=>{
    const [cx,cy]=project?[450,290]:cs.length===1?[450,300]:[[220,185],[680,185],[450,440]][ci%3];
    const scale=project?1.65:cs.length===1?1.65:1;
    if(!project)add({id:c.id,kind:'company',label:c.name,x:cx,y:cy,href:'#/company/'+c.id,company:c.id},'portfolio');
    const ps=scopeProjects(c.id).filter(p=>!project||p.id===project.id);
    ps.forEach((p,pi)=>{
      const angle=pi*Math.PI+.4;
      add({id:p.id,kind:'project',label:p.name,x:project?cx:cx+Math.cos(angle)*58*scale,y:project?cy:cy+Math.sin(angle)*45*scale,href:'#/project/'+p.id,company:c.id},project?null:c.id);
    });
    const ids=project?project.agents:c.agents;
    ids.forEach((id,i)=>{
      const angle=i/Math.max(ids.length,1)*Math.PI*2-.7;
      add({id:c.id+'-agent-'+id,kind:'agent',label:findAgent(id).name,x:cx+Math.cos(angle)*77*scale,y:cy+Math.sin(angle)*67*scale,href:'#/agent/'+id,company:c.id,agent:id},project?project.id:c.id);
    });
    const work=scopeTasks(c.id,project?.id);
    work.forEach((t,i)=>{
      const angle=i/Math.max(work.length,1)*Math.PI*2-.45, radius=(112+(i%2)*17)*scale;
      const task=add({id:t.id,kind:'task',label:t.title,x:cx+Math.cos(angle)*radius,y:cy+Math.sin(angle)*radius*.8,href:'#/task/'+t.id,company:c.id,agent:t.agent,status:t.status},c.id+'-agent-'+t.agent,t.status==='doing');
      edges.push({from:t.project,to:task.id});
      const evidenceCount=t.status==='done'?2:1;
      for(let e=0;e<evidenceCount;e++){
        const ea=angle+(e===0?-.22:.22);
        add({id:t.id+'-e'+e,kind:'evidence',label:t.evidence[e],x:task.x+Math.cos(ea)*24*scale,y:task.y+Math.sin(ea)*24*scale,href:'#/task-evidence/'+t.id+'/'+e,company:c.id,agent:t.agent,task:t.title},task.id);
      }
    });
  });
  return {nodes,edges};
}
export function mountGraph(companyId='',projectId=''){
  const svg=document.querySelector('#work-map'),group=document.querySelector('#map-transform');
  if(!svg)return()=>{};
  const {nodes,edges}=graphRecords(companyId,projectId),byId=new Map(nodes.map(n=>[n.id,n]));
  group.innerHTML=edges.map(e=>{
    const a=byId.get(e.from),b=byId.get(e.to);if(!a||!b)return '';
    return '<path class="map-edge'+(e.active?' active':'')+'" d="M'+a.x+' '+a.y+' Q'+((a.x+b.x)/2-(b.y-a.y)*.14)+' '+((a.y+b.y)/2+(b.x-a.x)*.14)+' '+b.x+' '+b.y+'"/>';
  }).join('')+nodes.map(n=>{
    const r=n.kind==='company'?22:n.kind==='portfolio'?20:n.kind==='project'?13:n.kind==='agent'?5:n.kind==='task'?3.5:2;
    return '<g class="map-node" data-node="'+esc(n.id)+'" data-kind="'+n.kind+'" transform="translate('+n.x+','+n.y+')" role="button" tabindex="0" aria-label="'+esc(n.kind+': '+n.label)+'"><title>'+esc(n.kind+' · '+n.label)+'</title><circle r="'+Math.max(11,r)+'" fill="transparent"/><circle class="point" r="'+r+'"/>'+(['company','portfolio','project','agent'].includes(n.kind)?'<text text-anchor="'+(['company','portfolio'].includes(n.kind)?'middle':'start')+'" x="'+(['company','portfolio'].includes(n.kind)?0:r+7)+'" y="3">'+esc(n.label)+'</text>':'')+'</g>';
  }).join('');
  document.querySelector('#map-count').textContent=nodes.length+' records · '+edges.length+' meaningful connections';
  let zoom=1,offset={x:0,y:0},drag=null;
  const controller=new AbortController(),options={signal:controller.signal};
  function apply(){group.setAttribute('transform','translate('+offset.x+' '+offset.y+') translate(450 305) scale('+zoom+') translate(-450 -305)');document.querySelector('#map-zoom').textContent=Math.round(zoom*100)+'%';}
  function select(id){
    const n=byId.get(id);if(!n)return;
    group.querySelectorAll('[data-node]').forEach(el=>el.classList.toggle('selected',el.dataset.node===id));
    const descriptions={
      portfolio:'Friday coordinates your portfolio. Company teams own the work.',
      company:'An independent venture with its own CEO, projects, and company-scoped assignments.',
      project:'A workspace for the team, its tasks, routines, decisions, and results.',
      agent:'A company assignment of a shared specialist. Company context stays with the assignment.',
      task:'A task owned by '+(n.agent?findAgent(n.agent).name:'the team')+'. State: '+({todo:'to do',doing:'in motion',done:'done'}[n.status]||'')+'.',
      evidence:'A supporting record for “'+(n.task||'the task')+'”. Pending work results are not represented as completed evidence.'
    };
    document.querySelector('#map-inspector').innerHTML='<span class="eyebrow">'+(n.company?esc(findCompany(n.company).name)+' / ':'')+n.kind+'</span><h3>'+esc(n.label)+'</h3><p>'+esc(descriptions[n.kind])+'</p><a class="btn" href="'+n.href+'">Open '+(n.kind==='agent'?'employee':n.kind)+' '+icon('arrow')+'</a><div class="line"></div><p>Dots represent records. Lines show ownership, assignment, or attached evidence.</p>';
  }
  svg.addEventListener('click',event=>{const n=event.target.closest('[data-node]');if(n)select(n.dataset.node);},options);
  svg.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.closest('[data-node]')){event.preventDefault();select(event.target.closest('[data-node]').dataset.node);}},options);
  document.querySelectorAll('[data-zoom]').forEach(button=>button.addEventListener('click',()=>{
    const before=zoom;
    if(button.dataset.zoom==='fit'){zoom=1;offset={x:0,y:0};}
    else{zoom=Math.max(.5,Math.min(4,zoom*(button.dataset.zoom==='in'?1.25:.8)));offset.x*=zoom/before;offset.y*=zoom/before;}
    apply();
  },options));
  svg.addEventListener('pointerdown',event=>{
    if(event.target.closest('[data-node]'))return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    drag={point,offset:{...offset}};svg.setPointerCapture(event.pointerId);svg.style.cursor='grabbing';
  },options);
  svg.addEventListener('pointermove',event=>{
    if(!drag)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    offset={x:drag.offset.x+point.x-drag.point.x,y:drag.offset.y+point.y-drag.point.y};apply();
  },options);
  const release=()=>{drag=null;svg.style.cursor='grab';};
  svg.addEventListener('pointerup',release,options);svg.addEventListener('pointercancel',release,options);
  return ()=>controller.abort();
}
