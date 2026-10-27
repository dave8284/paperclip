import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelIntelligence } from "./index.mjs";
const candidates = ["strong", "fast"].map(id => ({ id, provider: "openai", model: id, method: "subscription", available: true }));
const input = (id, extra = {}) => ({ namespace:"company-a", requestId:id, taskKey:id, taskType:"content", complexity:"routine", defaultCandidateId:"strong", candidates, ...extra });
function review(engine,id,model,latency,passed=true) {
 engine.select(input(id,{defaultCandidateId:model,candidates:[candidates.find(row=>row.id===model)]}));
 engine.evaluate({namespace:"company-a",id,receiptId:id,passed,iterations:1,latencyMs:latency,source:"human",evaluator:"owner",evidenceRef:`task:${id}:acceptance`});
}
test("holds baseline without quality evidence; only measured qualified improvement wins",()=>{
 const engine=createModelIntelligence(":memory:");
 assert.equal(engine.select(input("initial")).candidate.id,"strong");
 for(let i=0;i<5;i++){review(engine,`strong${i}`,"strong",1000);review(engine,`fast${i}`,"fast",400);}
 const receipt=engine.select(input("learned"));assert.equal(receipt.candidate.id,"fast");assert.equal(receipt.evidence.evaluations,5);
 assert.equal(engine.select(input("complex",{complexity:"complex"})).candidate.id,"strong");
 assert.equal(engine.select(input("other-task-type",{taskType:"engineering"})).candidate.id,"strong");
 assert.equal(engine.select(input("other-company",{namespace:"company-b"})).candidate.id,"strong");
 assert.deepEqual(engine.select(input("learned")),receipt);
 assert.throws(()=>engine.select(input("learned",{taskType:"engineering"})),/different inputs/);
 engine.close();
});
test("active tasks stay pinned, quality regressions remove automatic preference, rollback fails closed",()=>{
 const engine=createModelIntelligence(":memory:");engine.select(input("pin"));
 for(let i=0;i<5;i++){review(engine,`strong${i}`,"strong",1000);review(engine,`fast${i}`,"fast",400);}
 assert.equal(engine.select(input("resume",{taskKey:"pin"})).candidate.id,"strong");
 assert.equal(engine.select(input("winner")).candidate.id,"fast");
 review(engine,"fail1","fast",400,false);review(engine,"fail2","fast",400,false);
 assert.equal(engine.select(input("after-regression")).candidate.id,"strong");
 engine.policy({namespace:"company-a",candidateId:"fast",action:"block",reason:"Failed independent quality review"});
 assert.throws(()=>engine.select(input("winner-resume",{taskKey:"winner"})),/Pinned profile is unavailable/);
 assert.equal(engine.analytics("company-a").events.length,2);engine.close();
});
test("feedback requires a real receipt, deduplicates and survives restart",()=>{
 const dir=mkdtempSync(join(tmpdir(),"agentos-model-test-")),path=join(dir,"intelligence.sqlite");
 let engine=createModelIntelligence(path);
 const evaluation={namespace:"company-a",id:"eval",receiptId:"run",passed:true,iterations:1,latencyMs:200,source:"human",evaluator:"owner",evidenceRef:"task:run:verified-output"};
 assert.throws(()=>engine.evaluate(evaluation),/not found/);engine.select(input("run"));engine.evaluate(evaluation);engine.evaluate(evaluation);
 assert.equal(engine.analytics().counts.evaluations,1);assert.throws(()=>engine.evaluate({...evaluation,passed:false}),/different results/);
 engine.close();engine=createModelIntelligence(path);assert.equal(engine.analytics().counts.selections,1);assert.equal(engine.analytics().evaluations[0].evidenceRef,evaluation.evidenceRef);
 engine.close();rmSync(dir,{recursive:true});
});
test("rejects untrusted profiles and malformed evaluation claims",()=>{
 const engine=createModelIntelligence(":memory:");
 assert.throws(()=>engine.select(input("paid",{candidates:[{...candidates[0],method:"api_key"}]})),/subscription/);
 assert.throws(()=>engine.select(input("unavailable",{candidates:[{...candidates[0],available:false}]})),/available/);
 engine.select(input("run"));assert.throws(()=>engine.evaluate({namespace:"company-a",id:"eval",receiptId:"run",passed:true,iterations:0,latencyMs:-1,source:"process-exit",evaluator:"owner",evidenceRef:"no checked work"}),/Invalid evaluation/);engine.close();
});
test("learning library aggregates beyond the recent ledger and uses the routing qualification evidence",()=>{
 const engine=createModelIntelligence(":memory:");
 for(let i=0;i<5;i++){review(engine,`strong${i}`,"strong",1000);review(engine,`fast${i}`,"fast",400);}
 for(let i=0;i<105;i++)engine.select(input(`extra${i}`,{namespace:"company-b",taskType:"engineering.testing"}));
 const a=engine.analytics("company-a");assert.equal(a.profiles.length,2);assert.equal(a.profiles.find(row=>row.candidate.id==="fast").qualityQualified,true);
 assert.equal(a.profiles[0].evidence.evaluations,5);assert(a.taskFamilies.some(row=>row.id==="engineering.testing"));
 const all=engine.analytics();assert.equal(all.receipts.length,100);assert.equal(all.profiles.find(row=>row.namespace==="company-b").selections,105);
 engine.policy({namespace:"company-a",candidateId:"fast",action:"block",reason:"Quality regression"});
 assert.equal(engine.analytics("company-a").profiles.find(row=>row.candidate.id==="fast").qualityQualified,false);engine.close();
});
