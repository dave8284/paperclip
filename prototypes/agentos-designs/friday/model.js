export const companies = [
  {id:'northstar',name:'Northstar',mark:'N',description:'Customer intelligence',purpose:'Help small teams understand their customers and turn feedback into better products.',ceo:'Nora',phase:'Preparing to launch',agents:['maya','leo','imani','rae','noah']},
  {id:'forma',name:'Forma',mark:'f',description:'Design subscription',purpose:'Make thoughtful design accessible to growing companies, from the first brief to the final handoff.',ceo:'Kai',phase:'Growing steadily',agents:['noah','rae','jules','eden']},
  {id:'arbor',name:'Arbor',mark:'a',description:'Home services',purpose:'Connect homeowners with trusted local services and make every booking feel effortless.',ceo:'Sofia',phase:'Building the foundation',agents:['leo','alex','eden']}
];
export const agents = [
  {id:'maya',name:'Maya',role:'Product lead',skills:['Product strategy','Discovery','Prioritisation']},
  {id:'leo',name:'Leo',role:'Engineering',skills:['TypeScript','System design','Deployments']},
  {id:'imani',name:'Imani',role:'Quality',skills:['Release checks','Accessibility','Regression testing']},
  {id:'rae',name:'Rae',role:'Growth',skills:['Campaigns','Content iteration','Experiment design']},
  {id:'noah',name:'Noah',role:'Design',skills:['Interaction design','Design systems','Prototyping']},
  {id:'alex',name:'Alex',role:'Operations',skills:['Reliability','Incident review','Cost controls']},
  {id:'jules',name:'Jules',role:'Sales',skills:['Lead qualification','Outreach','Pipeline analysis']},
  {id:'eden',name:'Eden',role:'Research',skills:['Feedback synthesis','Customer interviews','Market research']}
];
export const projects = [
  {id:'customer-portal',company:'northstar',name:'Customer portal',department:'Product & engineering',lead:'maya',description:'Give every customer a clear, confident first five minutes.',kind:'Application',agents:['maya','leo','imani','noah'],asset:'Northstar web application',tasks:[
    ['Ship the staged rollout','leo','todo','Waiting for the release decision'],
    ['Verify invitation edge cases','imani','doing','Checking expired links and existing members'],
    ['Refine onboarding screens','noah','doing','Applying feedback from product review'],
    ['Map the first customer journey','maya','done','Brief and acceptance criteria attached'],
    ['Add workspace event tracking','leo','done','Changes reviewed; evidence attached'],
    ['Review release accessibility','imani','done','Keyboard and contrast checks recorded']]},
  {id:'launch-campaign',company:'northstar',name:'Launch campaign',department:'Marketing',lead:'rae',description:'Introduce Northstar with a story customers recognise.',kind:'Campaign',agents:['rae','noah','maya'],asset:'Northstar web application',tasks:[
    ['Publish the launch announcement','rae','todo','Scheduled after the product release decision'],
    ['Edit the product walkthrough','noah','doing','Refining the opening sequence'],
    ['Prepare three launch messages','rae','doing','Adapting the story for each channel'],
    ['Agree the launch narrative','maya','done','Audience and positioning documented'],
    ['Build the creative storyboard','noah','done','Six scenes ready for production'],
    ['Define campaign success measures','rae','done','Qualified signups and activation recorded']]},
  {id:'client-workspace',company:'forma',name:'Client workspace',department:'Product',lead:'noah',description:'A simple place for clients to brief, review, and receive design work.',kind:'Application',agents:['noah','eden','jules'],asset:'Forma client portal',tasks:[
    ['Prioritise the next client workflow','noah','todo','Waiting for research synthesis'],
    ['Review client interview notes','eden','doing','Grouping brief and approval friction'],
    ['Refine the design handoff','noah','doing','Testing clearer file previews'],
    ['Map the onboarding journey','noah','done','Journey reviewed with the team'],
    ['Summarise prospect questions','jules','done','Common objections linked to the brief'],
    ['Publish the research plan','eden','done','Five interviews scoped']]},
  {id:'creative-pipeline',company:'forma',name:'Creative pipeline',department:'Marketing & sales',lead:'rae',description:'Turn feedback into the next useful creative experiment.',kind:'Ongoing programme',agents:['rae','noah','jules'],asset:null,tasks:[
    ['Run the next creative test','rae','todo','Waiting for a $120 budget decision'],
    ['Produce the second creative variant','noah','doing','Testing an alternate opening hook'],
    ['Qualify campaign enquiries','jules','doing','Linking responses to the right campaign'],
    ['Review last week’s campaign','rae','done','Comparison and learnings attached'],
    ['Record the experiment baseline','rae','done','Audience and control held constant'],
    ['Package reusable visual assets','noah','done','Reusable assets versioned']]},
  {id:'booking-platform',company:'arbor',name:'Booking platform',department:'Engineering & operations',lead:'leo',description:'Make finding and booking a trusted service feel effortless.',kind:'Application',agents:['leo','alex','eden'],asset:'Arbor booking application',tasks:[
    ['Release appointment reminders','leo','todo','Queued after booking validation'],
    ['Implement booking confirmation','leo','doing','Connecting the confirmation state'],
    ['Review service health thresholds','alex','doing','Checking error and response-time baselines'],
    ['Group booking feedback','eden','done','Customer pain points documented'],
    ['Set up the release checklist','alex','done','Checks and rollback ownership agreed'],
    ['Scope reminder behaviour','leo','done','Consent and timing acceptance criteria ready']]},
  {id:'local-acquisition',company:'arbor',name:'Local acquisition',department:'Growth & research',lead:'eden',description:'Understand each neighbourhood before expanding into it.',kind:'Research programme',agents:['eden','alex'],asset:null,tasks:[
    ['Choose the next neighbourhood','eden','todo','Shortlist ready for review'],
    ['Compare customer demand signals','eden','doing','Grouping requests by service and area'],
    ['Check provider onboarding capacity','alex','doing','Comparing availability with demand'],
    ['Publish the neighbourhood brief','eden','done','Market evidence linked'],
    ['Set the weekly research routine','eden','done','Review cadence and owner established'],
    ['Review operating costs','alex','done','Baseline costs recorded']]}
];
projects.forEach((project,pi)=>{
  project.tasks=project.tasks.map(([title,agent,status,note],i)=>({id:project.company.slice(0,2).toUpperCase()+'-'+(pi*10+i+31),project:project.id,company:project.company,title,agent,status,note,evidence:['Acceptance criteria','Work result / review note']}));
});
export const tasks = projects.flatMap(p=>p.tasks);
export const decisions = [
  {id:'launch',company:'northstar',project:'customer-portal',agent:'maya',title:'Launch to 10% of customers?',type:'Release approval',summary:'The customer portal is ready for a staged release. The team has prepared the checks and rollback steps.',recommendation:'Start with 10% of customers. Monitor reliability before expanding the rollout.',evidence:['Release report reviewed by Imani','Rollback procedure prepared by Leo','Customer announcement drafted by Rae'],metrics:[['98.7%','Checks passed'],['0','Critical issues'],['10%','Initial rollout']],action:'Approve staged launch'},
  {id:'budget',company:'forma',project:'creative-pipeline',agent:'rae',title:'Increase the test budget by $120?',type:'Budget decision',summary:'One creative direction is producing more qualified enquiries. The team proposes a small follow-up experiment.',recommendation:'Run a three-day test with a hard $120 cap and compare qualified enquiries against the current control.',evidence:['Creative performance comparison attached','Daily spend limit included','Review scheduled after three days'],metrics:[['$120','Maximum spend'],['3 days','Test duration'],['2','Creative variants']],action:'Approve $120 test'},
  {id:'invites',company:'northstar',project:'customer-portal',agent:'maya',title:'Prioritise team invitations?',type:'Product direction',summary:'Twelve customers requested team invitations. The first version is scoped and ready to prioritise.',recommendation:'Start with email invitations into a shared workspace. Keep role customisation for a later cycle.',evidence:['Twelve customer requests linked','Engineering scope reviewed','Interaction draft ready'],metrics:[['12','Requests'],['4 days','Estimate'],['3','Tasks scoped']],action:'Approve next-cycle priority'},
  {id:'creative',company:'northstar',project:'launch-campaign',agent:'rae',title:'Approve the launch creative?',type:'Creative review',summary:'The first campaign creative is ready for review before the launch announcement is scheduled.',recommendation:'Use the customer-story opening and keep the product walkthrough as the follow-up. Publication still waits for the release approval.',evidence:['Customer-story storyboard attached','Channel-specific copy reviewed','Publication depends on the release decision'],metrics:[['3','Channel drafts'],['1','Opening story'],['0','Posts published']],action:'Approve creative direction'}
];
export const findCompany = id => companies.find(c=>c.id===id);
export const findProject = id => projects.find(p=>p.id===id);
export const findAgent = id => agents.find(a=>a.id===id);
export const scopeProjects = company => projects.filter(p=>!company || p.company===company);
export function scopeTasks(company,project) { return tasks.filter(t=>(!company||t.company===company)&&(!project||t.project===project)); }
export function counts(items) {return {todo:items.filter(t=>t.status==='todo').length,doing:items.filter(t=>t.status==='doing').length,done:items.filter(t=>t.status==='done').length};}
export function parseRoute(hash) {
  const [path,query='']=hash.replace(/^#\/?/,'').split('?');
  const parts=path.split('/').filter(Boolean).map(p=>{try{return decodeURIComponent(p);}catch{return '';}});
  const params=new URLSearchParams(query);
  return {page:parts[0]||'home',id:parts[1]||'',tab:parts[2]||'home',company:params.get('company')||'',project:params.get('project')||'',decision:params.get('decision')||''};
}
export function navigationRequested(text){
  if(/\b(don['’]?t|do not|no need to)\s+(show|open|navigate|take|switch|go|display)/i.test(text))return false;
  return /\b(show|open|navigate|take me|bring up|switch|go to|go back|display|let me see)\b/i.test(text)||/^(companies|projects|decisions|workforce|routines|artefacts|artifacts|audit trail|agent map|home)$/i.test(text.trim());
}
export function routeScope(route){
  const project=route.page==='project'?findProject(route.id):route.project?findProject(route.project):null;
  const company=route.page==='company'?findCompany(route.id):project?findCompany(project.company):findCompany(route.company);
  if(route.company&&project&&route.company!==project.company)return {};
  return {company:company?.id||'',project:project?.id||''};
}
export function scopeQuery(company='',project=''){
  const params=new URLSearchParams();if(company)params.set('company',company);if(project)params.set('project',project);
  return params.size?'?'+params.toString():'';
}
export function interpret(text,route) {
  const q=text.toLowerCase().replace(/[?!.,]/g,'').trim();
  const directCompany=companies.find(c=>q.includes(c.name.toLowerCase()));
  const directProject=projects.find(p=>q.includes(p.name.toLowerCase()));
  const current=routeScope(route),companyId=directCompany?.id||directProject?.company||current.company;
  const projectId=directProject?.id||(!directCompany?current.project:'');
  const base=projectId?'#/project/'+projectId:companyId?'#/company/'+companyId:'';
  if(!navigationRequested(text)){
    if(/^(hi|hello|hey|good morning|good evening)\b/.test(q))return {reply:'Hi. I’m here. We can talk through your companies, your team, or what needs your attention.'};
    if(/\b(thank|thanks)\b/.test(q))return {reply:'You’re welcome. I’m here when you need me.'};
    if(/routine/.test(q))return {reply:'Routines belong to a project. A company view brings its project routines together. I can open the current scope when you ask.'};
    if(/decision|attention|needs? me/.test(q))return {reply:'Your team has recommendations ready for review, each linked to its company, project, owner, and evidence. Ask me to show the decisions when you’re ready.'};
    if(directCompany){const work=counts(scopeTasks(directCompany.id));return {reply:directCompany.name+' has '+scopeProjects(directCompany.id).length+' projects, '+work.doing+' tasks in motion, and '+work.done+' completed tasks in this sample portfolio.'};}
    if(/compan|portfolio/.test(q))return {reply:'You have '+companies.length+' companies in this sample portfolio: '+companies.map(c=>c.name).join(', ')+'. We can talk about any of them here.'};
    return {reply:'That isn’t covered by the sample replies yet. We can keep the conversation here, or you can ask me to show a company, project, or decision.'};
  }
  if(/\b(home|go back|agent os)\b/.test(q)) return {route:'#/',reply:'Back to your Friday home. I’m here when you need me.'};
  if(/\b(approve|reject|yes|no)\b/.test(q)) return {reply:'Please open the decision and use its labelled action in this preview, so your choice is attached to the right proposal.'};
  const portfolioWide=/all compan|across (the |my )?portfolio|portfolio-wide/.test(q);
  if(/decision|attention|blocker|needs? me/.test(q)) return {route:base&&!portfolioWide?base+'/decisions':'#/decisions',reply:'Here are the decisions for '+(portfolioWide||!base?'your portfolio':projectId?findProject(projectId).name:findCompany(companyId).name)+', with each recommendation and its evidence.'};
  if(/routine/.test(q)) return {route:base&&!portfolioWide?base+'/routines':'#/routines',reply:'Here are the routines for '+(portfolioWide||!base?'your portfolio':projectId?findProject(projectId).name:findCompany(companyId).name)+'.'};
  if(/artefact|artifact|result/.test(q)) return {route:base&&!portfolioWide?base+'/artefacts':'#/artefacts',reply:'Here are the work products for the selected scope.'};
  if(/audit|history|trail/.test(q)) return {route:'#/audit'+(portfolioWide?'':scopeQuery(companyId,projectId)),reply:'Here is the audit trail. Your company and project context stays in the navigation.'};
  if(/combined|kanban/.test(q)&&base) return {route:base+'/combined',reply:'Here is the combined view: all work to do, in motion, and done, with the activity alongside it.'};
  if(/agent map|graph|galaxy|work in motion/.test(q)) return {route:base?base+'/map':'#/map',reply:'Here is the work map. Every point represents a record you can inspect.'};
  if(directProject) return {route:'#/project/'+directProject.id,reply:'Here is '+directProject.name+' at '+findCompany(directProject.company).name+'.'};
  if(directCompany) return {route:'#/company/'+directCompany.id,reply:'Here is '+directCompany.name+', including its projects, team, and decisions.'};
  if(/project/.test(q)) return {route:companyId?'#/company/'+companyId:'#/projects',reply:'Here are the projects. Open any card to see its workspace.'};
  if(/compan|portfolio/.test(q)) return {route:'#/companies',reply:'Here are your companies. Choose one to explore its projects.'};
  if(/team|agent|workforce|who/.test(q)) return {route:'#/workforce',reply:'Here is your shared workforce, with each person’s skills and company assignments.'};
  return {reply:'I haven’t changed the view. Tell me which company, project, or decision you’d like to open.'};
}
