"""Regenerate the standalone HTML previews. No application services are used."""
from pathlib import Path
import json

ROOT = Path(__file__).parent
DESIGNS = [
    ("01-friday-canvas", "Friday Canvas", "A quiet, voice-first home. Friday makes room for whatever you need."),
    ("02-portfolio-desk", "Portfolio Desk", "Your companies at a glance. A warm, editorial view of the whole business."),
    ("03-constellation", "Constellation", "Work as a living map. Zoom from your portfolio into an individual record."),
    ("04-the-briefing", "The Briefing", "A calm decision room. Recommendations, evidence, and your next yes or no."),
    ("05-operations-studio", "Operations Studio", "See the work and the workers together. Kanban, handoffs, and results."),
]
ICONS = {
    "arrow": '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    "diagonal": '<path d="M6 18 18 6M6 6h12v12"/>',
    "back": '<path d="M19 12H5m6-6-6 6 6 6"/>',
    "close": '<path d="m6 6 12 12M6 18 18 6"/>',
    "check": '<path d="m5 12 4 4L19 6"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "minus": '<path d="M5 12h14"/>',
    "keyboard": '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h.01M18 10h.01M8 14h8"/>',
    "mic": '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
    "grid": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    "orbit": '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/>',
    "file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/>',
    "repeat": '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
    "people": '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "play": '<path d="m8 5 12 7-12 7z"/>',
    "fit": '<path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/>',
}
def icon(name): return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>'
def orb(): return '<div class="orb" aria-hidden="true"><div class="orb-core"></div><i class="orbit a"></i><i class="orbit b"></i><i class="orbit c"></i><i class="orbit d"></i></div>'
def wave(): return '<span class="voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>'
def brand(): return '<a class="brand" href="index.html"><span class="brand-symbol" aria-hidden="true"></span>Agent OS<span class="muted" style="font-weight:400">/</span></a>'
def avatar(name, color="#638ebc", large=False): return f'<span class="avatar{" lg" if large else ""}" style="--avatar-color:{color}">{name[0]}</span>'
def avatars(names): return '<div class="avatars">' + ''.join(avatar(n) for n in names) + '</div>'
def voice(label="Talk to Friday"): return f'<button class="voice-cta" data-action="voice">{wave()}{label}</button>'
def typing(): return f'<button class="type-trigger" data-action="type">{icon("keyboard")} Prefer to type?</button>'
def dock(): return f'<div class="friday-dock"><button aria-label="Preview talking to Friday" data-action="voice">{orb()}</button><button data-action="voice"><strong>Friday</strong><small>Here when you need me</small></button><button class="icon-button" data-action="type" aria-label="Type to Friday">{icon("keyboard")}</button></div>'
def header(selected):
    nav = "".join(f'<button data-surface="{key}" class="{"selected" if selected == key else ""}">{label}</button>' for key,label in [("companies","Companies"),("decisions",'Decisions <span class="count" data-decision-count>3</span>'),("workforce","Workforce")])
    return f'<header class="app-header">{brand()}<nav class="primary-nav" aria-label="Main navigation">{nav}</nav><div class="row"><button class="icon-button header-extra" data-surface="audit" aria-label="Open audit trail">{icon("clock")}</button><span class="avatar" aria-label="Dave">D</span></div></header>'
def preview(index):
    links = "".join(f'<a href="{slug}.html" class="{"active" if i == index else ""}" aria-label="{title}">{i + 1}</a>' for i,(slug,title,_) in enumerate(DESIGNS))
    return f'<div class="preview-bar"><a href="index.html">← All five designs</a><span class="preview-label">DESIGN PREVIEW · SAMPLE DATA</span><nav class="variation-links" aria-label="Design variations">{links}</nav></div>'
def shared():
    return f'''<div class="sheet-backdrop" hidden data-action="close"></div>
<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" hidden tabindex="-1"><div class="sheet-header"><h2 id="sheet-title"></h2><button class="icon-button" data-action="close" aria-label="Close panel">{icon("close")}</button></div><div id="sheet-content"></div></section>
<section class="composer-popover" role="dialog" aria-modal="true" aria-label="Type to Friday" hidden><div class="row between"><span class="eyebrow">A little space to talk</span><button class="icon-button" data-action="close-type" aria-label="Close typing input">{icon("close")}</button></div><form id="friday-form"><input id="friday-input" aria-label="Message for Friday" placeholder="Show me what needs my attention…" autocomplete="off"><button class="icon-button" aria-label="Send message">{icon("arrow")}</button></form><small>Preview commands: decisions, companies, workforce, work, routines, artefacts.</small></section>
<div class="toast" role="status" hidden></div>'''
def page(index, body, css_class):
    slug,title,_ = DESIGNS[index]
    if index == 0:
        (ROOT/(slug+".html")).write_text((ROOT/"friday"/"shell.html").read_text())
        return
    (ROOT/(slug+".html")).write_text(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>{title} · Agent OS design preview</title><link rel="stylesheet" href="styles.css"><script src="data.js" defer></script><script src="app.js" defer></script></head><body data-design="{index+1}">{preview(index)}<div class="{css_class}">{body}{dock()}</div>{shared()}</body></html>')

companies = [
    dict(id="northstar",name="Northstar",description="Customer intelligence",symbol="N",color="#638ebc",status="Launch week",revenue="$12.4k",growth="+18%",progress=61,agents=["maya","leo","imani","rae","noah"],projects=["Customer portal","Launch campaign"]),
    dict(id="forma",name="Forma",description="Design subscription",symbol="f",color="#8c83b7",status="Growing",revenue="$8.2k",growth="+12%",progress=82,agents=["noah","rae","jules","eden"],projects=["Client workspace","Creative pipeline"]),
    dict(id="arbor",name="Arbor",description="Home services",symbol="a",color="#799366",status="Building",revenue="$4.6k",growth="+9%",progress=36,agents=["leo","alex","eden"],projects=["Booking platform","Local acquisition"]),
]
agents = [
    dict(id="maya",name="Maya",role="Product lead",skills=["Product strategy","Discovery","Prioritisation"],color="#8c83b7"),
    dict(id="leo",name="Leo",role="Engineering",skills=["TypeScript","System design","Deployments"],color="#638ebc"),
    dict(id="imani",name="Imani",role="Quality",skills=["Release checks","Accessibility","Regression testing"],color="#b1894b"),
    dict(id="rae",name="Rae",role="Growth",skills=["Campaigns","Content iteration","Experiment design"],color="#bb7f76"),
    dict(id="noah",name="Noah",role="Design",skills=["Interaction design","Design systems","Prototyping"],color="#468b71"),
    dict(id="alex",name="Alex",role="Operations",skills=["Reliability","Incident review","Cost controls"],color="#638ebc"),
    dict(id="jules",name="Jules",role="Sales",skills=["Lead qualification","Outreach","Pipeline analysis"],color="#b1894b"),
    dict(id="eden",name="Eden",role="Research",skills=["Feedback synthesis","Customer interviews","Competitive research"],color="#8c83b7"),
]
decisions = [
    dict(id="launch",company="northstar",agent="maya",title="Ready to open the doors?",short="Launch to 10% of customers?",tag="Release approval",intro="The Northstar customer portal is ready for a staged release. Your team has finished the work; the rollout needs your approval.",recommendation="Start with 10% of customers. Let Alex monitor reliability, then ask you before expanding. Keep the previous version ready for rollback.",metrics=[["98.7%","Checks passed"],["0","Critical issues"],["10%","Initial rollout"]],evidence=["Release report reviewed by Imani","Rollback procedure prepared by Leo","Customer announcement drafted by Rae"],action="Approve staged launch",context="Customer portal · Release 0.8"),
    dict(id="budget",company="forma",agent="rae",title="Give the best idea a little more room.",short="Increase test budget by $120?",tag="Budget decision",intro="One creative direction is producing more qualified enquiries. Rae proposes a small follow-up experiment before committing to a larger campaign.",recommendation="Approve a $120 capped test over three days. Compare cost per qualified enquiry with the current control. Stop automatically at the budget limit.",metrics=[["$120","Maximum spend"],["3 days","Test duration"],["2","Creative variants"]],evidence=["Creative performance comparison attached","Daily spend cap included in the routine","Review scheduled after three days"],action="Approve $120 test",context="Creative pipeline · Experiment 04"),
    dict(id="invites",company="northstar",agent="maya",title="Build what customers keep asking for.",short="Prioritise team invites?",tag="Product direction",intro="Twelve customers asked for team invitations this week. Maya has grouped the feedback and scoped a first version with Leo.",recommendation="Move team invitations into the next cycle. Start with email invitations and one shared workspace. Keep role customisation for a later iteration.",metrics=[["12","Customer requests"],["4 days","Estimated work"],["3","Tasks scoped"]],evidence=["Feedback synthesis links all twelve requests","Engineering scope reviewed by Leo","Interaction draft ready from Noah"],action="Approve next-cycle priority",context="Customer portal · Next cycle"),
]
tasks = [
    dict(id="NS-041",title="Ship the staged rollout",agent="leo",stage="Ready",note="Waiting for launch approval",kind="Engineering"),
    dict(id="NS-042",title="Prepare customer announcement",agent="rae",stage="Ready",note="Copy ready for final review",kind="Growth"),
    dict(id="NS-038",title="Verify invitation edge cases",agent="imani",stage="In motion",note="Checking expired links and existing members",kind="Quality"),
    dict(id="NS-039",title="Refine onboarding screens",agent="noah",stage="In motion",note="Applying feedback from product review",kind="Design"),
    dict(id="NS-035",title="Map the first customer journey",agent="maya",stage="Done",note="Brief and acceptance criteria attached",kind="Product"),
    dict(id="NS-036",title="Add workspace event tracking",agent="leo",stage="Done",note="Changes reviewed; evidence attached",kind="Engineering"),
]
(ROOT/"data.js").write_text("window.AGENT_OS_DEMO = " + json.dumps(dict(companies=companies,agents=agents,decisions=decisions,tasks=tasks,icons=ICONS)) + ";\n")

def company_icon(c): return f'<span class="company-icon {c["id"]}">{c["symbol"]}</span>'
def decision_cards():
    return '<div class="decision-cards">' + ''.join(f'<button class="decision-card" data-decision="{d["id"]}"><span class="eyebrow">{d["company"]} · {d["tag"]}</span><strong>{d["short"]}</strong><span class="row"><small>{d["agent"].title()} recommends a next step</small>{icon("arrow")}</span></button>' for d in decisions) + '</div>'
def event(name,text,time):
    return f'<div class="mini-event">{avatar(name)}<div><p><strong>{name}</strong> {text}</p><small>{time}</small></div></div>'

# 01 — a deliberately quiet canvas
strip = '<div class="portfolio-strip"><span class="eyebrow" style="margin-right:7px">Your world</span>' + ''.join(f'<button class="company-tab" data-company="{c["id"]}"><b></b>{c["name"]}</button>' for c in companies) + '</div>'
page(0, header("") + f'''<main class="canvas-main">{strip}
<section class="canvas-hero">{orb()}<h1>A little clarity. A lot in motion.</h1><p>Your companies are moving forward.<br>Three decisions could use your attention.</p><div class="listen-row">{voice()}{typing()}</div><div class="quiet-status">3 companies <span aria-hidden="true">·</span> 8 shared specialists <span aria-hidden="true">·</span> 12 tasks in motion</div></section>
<div class="suggested-prompts"><button data-surface="decisions">What needs me?</button><button data-surface="companies">Show my companies</button><a class="btn text" href="03-constellation.html">{icon("orbit")} See work in motion</a></div>
<section class="decision-peek"><div class="section-heading"><h2>A few things to move forward</h2><button class="text-link" data-surface="decisions">Review all {icon("arrow")}</button></div>{decision_cards()}</section>
<p class="bottom-note">Friday brings the work to you. Your canvas opens when you need it.</p><section id="dynamic-canvas" hidden aria-live="polite"></section></main>''', "canvas-app")

# 02 — a company-first desk
venture_cards = ""
for c in companies:
    venture_cards += f'''<article class="venture-card"><div class="row">{company_icon(c)}<span class="pill">{c["status"]}</span></div><h3>{c["name"]}</h3><p class="description">{c["description"]}</p><div class="company-metric"><strong>{c["revenue"]}</strong><span>{c["growth"]}</span><p class="description">monthly revenue · sample</p></div><div class="row between progress-label"><small>Current cycle</small><small>{c["progress"]}%</small></div><div class="progress-line" style="--progress:{c["progress"]}%;--bar-color:{c["color"]}"><i></i></div><small>{len(c["projects"])} projects · {len(c["agents"])} specialists</small>{avatars([a.title() for a in c["agents"]])}<button class="btn" data-company="{c["id"]}">Open company {icon("arrow")}</button></article>'''
rows = "".join(f'<tr><td><button data-company="{c["id"]}">{c["projects"][0]}</button></td><td>{c["name"]}</td><td>{avatar(c["agents"][0].title())} {c["agents"][0].title()}</td><td><span class="pill teal">{c["status"]}</span></td></tr>' for c in companies)
page(1, header("companies")+f'''<main class="portfolio-main"><div class="row between portfolio-title"><div><div class="eyebrow">Your portfolio / Monday briefing</div><h1>Good things are taking shape.</h1><p>Three companies. One place to keep perspective.</p></div><button class="btn" data-surface="new-company">{icon("plus")} Start something new</button></div>
<div class="portfolio-stats"><div><strong>03</strong><small>Companies in your portfolio</small></div><div><strong>08</strong><small>Shared specialists</small></div><div><strong>27</strong><small>Tasks completed this week</small></div><div><strong data-decision-count>3</strong><small>Decisions waiting for you</small></div></div>
<div class="portfolio-layout"><div><div class="section-heading"><h2>Your companies</h2><button class="text-link" data-surface="companies">Portfolio details {icon("arrow")}</button></div><div class="venture-cards">{venture_cards}</div><section class="work-section"><div class="section-heading"><h2>Projects moving forward</h2><a class="text-link" href="05-operations-studio.html">Open workspace {icon("arrow")}</a></div><table class="work-table"><thead><tr><th>Project</th><th>Company</th><th>Lead</th><th>State</th></tr></thead><tbody>{rows}</tbody></table></section></div>
<aside class="portfolio-aside"><div class="brief-card">{orb()}<span class="eyebrow">A note from Friday</span><h3>Northstar is ready for its next chapter.</h3><p>The team has prepared the launch. I have one recommendation and the evidence ready for you.</p><button class="btn" data-decision="launch">Walk me through it {icon("arrow")}</button></div><section class="aside-activity"><div class="section-heading"><h2>Across your world</h2></div>{event("Imani","finished the release review.","Northstar · 4 min ago")}{event("Rae","prepared two creative variants.","Forma · 12 min ago")}{event("Eden","grouped the latest customer feedback.","Arbor · 28 min ago")}</section></aside></div></main>''',"portfolio-app")

# 03 — each point is a selectable record; the graph is built from the fixture.
page(2, header("")+f'''<main class="graph-layout"><section class="graph-space"><div class="graph-title"><div class="eyebrow" id="graph-breadcrumb">Portfolio / All companies</div><h1>Your world, connected.</h1><p id="graph-summary">Companies, people, and the work between them.</p></div><div class="graph-stage"><svg id="work-graph" viewBox="0 0 1000 680" aria-label="Interactive portfolio graph" role="group"><g id="graph-transform"></g></svg></div><div class="graph-controls"><button class="icon-button" data-zoom="out" aria-label="Zoom out">{icon("minus")}</button><span id="zoom-label">100%</span><button class="icon-button" data-zoom="in" aria-label="Zoom in">{icon("plus")}</button><button class="icon-button" data-zoom="reset" aria-label="Fit entire portfolio">{icon("fit")}</button></div><div class="graph-legend"><span><i class="legend-dot" style="background:#638ebc"></i> Company</span><span><i class="legend-dot" style="background:#8c83b7"></i> Agent</span><span><i class="legend-dot" style="background:#468b71"></i> Task</span><span><i class="legend-dot" style="background:#b1894b"></i> Evidence</span></div></section>
<aside class="graph-inspector" id="graph-inspector"><div class="eyebrow">Portfolio intelligence</div>{orb()}<h2>Everything has a place.</h2><p class="inspector-description">Follow a connection to see who owns the work, what they are doing, and the evidence behind it.</p><dl class="detail-list"><div><dt>Companies</dt><dd>3</dd></div><div><dt>Shared specialists</dt><dd>8</dd></div><div><dt>Company assignments</dt><dd>12</dd></div><div><dt>Decisions</dt><dd data-decision-count>3</dd></div></dl><button class="btn" data-surface="decisions">Review decisions {icon("arrow")}</button><p class="graph-app-note">Every dot is a sample record. Select a company to focus; select an agent, task, or artefact to inspect. Drag to pan and use + / − to zoom.</p></aside></main>''',"constellation-app")

# 04 — a decision room
inbox = "".join(f'<button class="inbox-item {"active" if i==0 else ""}" data-brief="{d["id"]}"><small>{d["company"].upper()} / {d["tag"]}</small><strong>{d["short"]}</strong><span class="row">{avatar(d["agent"].title())}{d["agent"].title()} · Recommendation ready</span></button>' for i,d in enumerate(decisions))
page(3,header("decisions")+f'''<main class="briefing-layout"><aside class="decision-inbox"><div class="eyebrow">Your attention / <span data-decision-count>3</span></div>{inbox}<div class="subtle-rule"></div><p class="muted" style="font-size:11px;padding:0 10px">Only the decisions that need you.<br>The team handles the rest.</p></aside><article class="decision-document" id="brief-document"></article><aside class="friday-brief"><div class="eyebrow" style="text-align:center">Your thinking partner</div>{orb()}<h3>Let's make this simple.</h3><p>I have the recommendation and the evidence. We can talk through the tradeoffs together.</p>{voice("Talk it through")}{typing()}<div class="subtle-rule"></div><div class="eyebrow">While you were away</div>{event("Leo","prepared the rollout.","Customer portal")}{event("Imani","checked the release evidence.","Quality review")}<button class="text-link" data-surface="audit">Follow the full trail {icon("arrow")}</button></aside></main>''',"briefing-app")

# 05 — a project workbench
board = ""
for stage in ["Ready","In motion","Done"]:
    cards = ""
    for t in [t for t in tasks if t["stage"]==stage]:
        cards += f'<button class="task-card {"running" if stage=="In motion" else ""}" data-task="{t["id"]}" data-task-agent="{t["agent"]}"><span class="task-id">{t["id"]} · {t["kind"]}</span><h3>{t["title"]}</h3><p class="task-note">{t["note"]}</p><span class="row"><span class="row" style="border:0;padding:0;gap:6px">{avatar(t["agent"].title())}{t["agent"].title()}</span><span class="pill {"teal" if stage=="In motion" else ""}">{stage}</span></span></button>'
    board += f'<section><div class="kanban-head">{stage}<span data-column-count>2</span></div>{cards}</section>'
project_links = "".join(f'<button class="sidebar-link" data-company="{c["id"]}">{company_icon(c)}{c["name"]}</button>' for c in companies)
page(4,header("")+f'''<main class="studio-shell"><aside class="studio-sidebar"><div class="eyebrow">Portfolio</div>{project_links}<div class="divider"></div><div class="eyebrow">Northstar / Projects</div><button class="sidebar-link active" data-action="project-home">{icon("grid")} Customer portal</button><button class="sidebar-link" data-surface="campaign">{icon("orbit")} Launch campaign</button><div class="divider"></div><button class="sidebar-link" data-surface="routines">{icon("repeat")} Routines</button><button class="sidebar-link" data-surface="artefacts">{icon("file")} Artefacts</button><button class="sidebar-link" data-surface="audit">{icon("clock")} Audit trail</button><div class="workforce-mini"><span class="eyebrow" style="padding:0">Shared workforce</span>{avatars(["Maya","Leo","Imani","Rae","Noah"])}<button class="text-link" data-surface="workforce">Meet the team {icon("arrow")}</button></div></aside><section class="studio-content"><div class="studio-title"><div class="row between"><div><div class="eyebrow">Northstar / Product & engineering</div><h1>Customer portal</h1></div>{avatars(["Maya","Leo","Imani","Noah"])}</div><p>Give every customer a clear, confident first five minutes.</p></div><div class="studio-toolbar"><div class="segmented" aria-label="Workspace view"><button class="active" data-board="combined">Combined</button><button data-board="board">Kanban</button><button data-action="open-graph">Agent map</button></div><div class="row"><span class="pill teal"><i class="status-dot"></i> 2 tasks in motion</span><select id="agent-filter" aria-label="Filter tasks by agent"><option value="all">All specialists</option>{''.join(f'<option value="{a["id"]}">{a["name"]}</option>' for a in agents[:5])}</select></div></div><div class="combined-grid"><div class="kanban">{board}</div><aside class="activity-column"><div class="section-heading"><h2>Work in motion</h2><span class="pill">Sample</span></div><div id="studio-event">{event("Imani","is checking invitation edge cases.","NS-038 · Quality review")}</div><div class="handoff-line"><span class="eyebrow" style="color:inherit">A handoff, with context</span><div class="row">{avatar("Leo")}<span class="connector"></span>{avatar("Imani")}</div><p>Implementation → verification</p></div><button class="btn" style="width:100%;font-size:10px" data-action="next-event">{icon("play")} Next sample event</button><button class="artifact-tile" data-surface="artefacts">{icon("file")}<span>Release evidence<small>Imani · Quality report</small></span></button><button class="artifact-tile" data-surface="routines">{icon("repeat")}<span>Post-release health check<small>Routine · Every 15 minutes</small></span></button><p class="footer-note">Follow the task, handoff, and evidence in one place. Open any card to inspect the details.</p></aside></div></section></main>''',"studio-app")

gallery_cards = "".join(f'''<article><div class="design-preview"><iframe src="{slug}.html?thumbnail=1" title="{title} preview" tabindex="-1" aria-hidden="true" loading="lazy"></iframe><a class="preview-hit" href="{slug}.html" aria-label="Explore {title}"><span>Explore this direction ↗</span></a></div><div class="design-caption"><span class="design-number">0{i+1}</span><div><h2><a href="{slug}.html">{title}</a></h2><p>{description}</p></div><a class="icon-button" href="{slug}.html" aria-label="Open {title}">{icon("diagonal")}</a></div></article>''' for i,(slug,title,description) in enumerate(DESIGNS))
(ROOT/"index.html").write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Five directions · Agent OS</title><link rel="stylesheet" href="styles.css"><script src="app.js" defer></script></head><body class="gallery"><main class="gallery-wrap"><header class="gallery-nav">{brand()}<span class="eyebrow">Design exploration / 01–05</span></header><section class="gallery-intro"><div><div class="eyebrow">The same vision. Five ways in.</div><h1>Make room for<br><em>a different kind of work.</em></h1></div><p>Friday at the centre. Your companies, people, and decisions within reach. Five interactive directions for Agent OS—open one and try it.</p></section><section class="gallery-grid" aria-label="Five design variations">{gallery_cards}</section><footer class="gallery-footer"><span><strong>Built for exploring.</strong> Fictional companies and sample activity. Voice interactions are simulated.</span><span>These ideas can be combined into one application.</span></footer></main></body></html>''')
print("Generated gallery, five designs, and sample data.")
