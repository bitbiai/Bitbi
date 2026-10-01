import assert from 'node:assert/strict';
import {BROWSER_REPAIR,BROWSER_REPAIR_ACCEPTANCE,BROWSER_REPAIR_FILES,BROWSER_REPAIR_SPECS,browserHash,browserRows,repairedCase,verifyBrowserCaseCoverage,verifyBrowserRepairCoverage,verifyBrowserRepairProof,assertBrowserReportArtifact,assertBrowserSourceIdentity,assertBrowserRepairTrees,assertOriginalBrowserJob,assertCompletedBrowserRepair} from './lib/browser-fixture-repair.mjs';
import {repairKind,repairSelection,assertRepairAcceptance} from './lib/media-repair-source.mjs';
import {requiredJobs} from './pages-candidate.mjs';

const nav='cold workspace exposes grouped tasks and each group can collapse independently';
const instant='WebKit switches categories instantly with one precise scroll and no settling corrections';
const pass=(key,file='ordinary.spec.js',title=key,project='chromium')=>({key,file,title,project,expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,error:false}]});
const identity=({key,file,title,project})=>({key,file,title,project});
const skipped=row=>({...row,expectedStatus:'skipped',status:'skipped',results:[{status:'skipped',retry:0,error:false}]});
const repairs=['chromium','webkit-appearance'].map(project=>pass(project+'-nav','auth-admin.spec.js',nav,project));
for(const locale of ['en','de'])for(const project of ['chromium','webkit-assistant'])repairs.push(pass(project+'-'+locale,'website-assistant.spec.js',`website assistant ${locale}: real HTTP UI, route, knowledge and budget boundary with synthetic AI`,project));
const controls=['en','de'].flatMap(locale=>['chromium','webkit-assistant'].map(project=>pass(project+'-'+locale+'-control','website-assistant.spec.js',`website assistant ${locale}: keyboard chat waits for initial Help focus and a blocked submit cannot report completion`,project)));
const previous=[...Array.from({length:1593},(_,i)=>pass('ordinary-'+i)),skipped(pass('skip','homepage-carousel-focused.spec.js',instant)),...structuredClone(repairs)];
for(const row of previous.filter(row=>row.key.endsWith('-nav'))){row.status='unexpected';row.results=[{status:'failed',retry:0,error:true},{status:'failed',retry:1,error:true}];}
const flaky=previous.find(row=>row.key==='webkit-assistant-de');flaky.status='flaky';flaky.results=[{status:'failed',retry:0,error:true},{status:'passed',retry:1,error:false}];
const discovery=[...previous,...controls].map(identity);
const carousel=['chromium','firefox','webkit'].flatMap(project=>Array.from({length:13},(_,i)=>pass(project+'-tail-'+i,'homepage-carousel-focused.spec.js',i===0?instant:i===1?'settles exact transitions, keeps populated walls warm, and honors the latest rapid choice':i===2?'page-work measurement detects deliberately blocking work on a real carousel input':'tail-'+i,project)));
for(let i=0;i<carousel.length;i++){const row=carousel[i];if(row.title===instant&&row.project!=='webkit'||row.title.startsWith('settles exact')&&row.project==='webkit'||row.title.startsWith('page-work')&&row.project!=='chromium')carousel[i]=skipped(row);}
const evidence={previous,discovery,scoped:[...repairs,...controls],carouselDiscovery:carousel.map(identity),carousel};
const coverage=verifyBrowserCaseCoverage(evidence);assert.equal(coverage.reusedPassed,1593);assert.equal(coverage.freshPassed,10);assert.equal(coverage.carouselPassed,34);assert.equal(coverage.carouselSkipped,5);
for(const mutate of [
 e=>e.scoped.pop(),e=>e.discovery.pop(),e=>e.discovery.push(e.discovery[0]),e=>e.scoped[0].results[0].status='failed',e=>e.scoped[0].results.push({status:'passed',retry:1,error:false}),e=>e.scoped[0].results[0].retry=1,e=>e.scoped[0].status='flaky',e=>e.scoped[0].expectedStatus='failed',e=>e.scoped[0].results[0].error=true,e=>e.scoped[0].title='renamed',e=>e.previous[0].results[0].status='failed',e=>e.previous[0].status='unexpected',e=>e.previous[0].expectedStatus='skipped',e=>e.previous[0].title='changed old case',e=>e.discovery[0].title='changed discovery',e=>e.carousel.pop(),e=>e.carouselDiscovery.pop(),e=>e.carousel[3].results[0].status='failed',e=>e.carousel[3]=skipped(e.carousel[3]),e=>e.carousel[3].results.push({status:'passed',retry:1,error:false}),e=>e.carousel[3].project='foreign',e=>e.carouselDiscovery[0].title='filtered tail',
]) {const bad=structuredClone(evidence);mutate(bad);assert.throws(()=>verifyBrowserCaseCoverage(bad));}
assert.throws(()=>verifyBrowserRepairCoverage(evidence),/Original failed case evidence changed/,'Synthetic passes cannot replace immutable source results');
const manifest={sha:BROWSER_REPAIR.sha,run:BROWSER_REPAIR.run,attempt:BROWSER_REPAIR.attempt};
const proof={job:'browser-validation',status:'passed',manifestHash:browserHash(JSON.stringify(manifest)),reportHash:browserHash(JSON.stringify(evidence)),tests:1637,browserRepair:{policy:BROWSER_REPAIR.policy,source:BROWSER_REPAIR,publicationSha:'a'.repeat(40),run:'202',attempt:'1',evidence,coverage}};
assert.throws(()=>verifyBrowserRepairProof(proof,manifest),/Original failed case evidence changed/);
for(const key of ['sha','run','attempt']){const bad={...manifest,[key]:'wrong'};assert.throws(()=>assertBrowserSourceIdentity(bad));}
const artifact={id:BROWSER_REPAIR.artifact,name:BROWSER_REPAIR.artifactName,digest:`sha256:${BROWSER_REPAIR.archiveHash}`,expired:false,expires_at:new Date(Date.now()+86400000).toISOString(),workflow_run:{id:Number(BROWSER_REPAIR.run),head_sha:BROWSER_REPAIR.sha}};
assertBrowserReportArtifact([artifact]);
for(const mutate of [a=>a.id++,a=>a.name='different',a=>a.digest='sha256:'+'0'.repeat(64),a=>a.expired=true,a=>a.expires_at='invalid',a=>a.workflow_run.id++,a=>a.workflow_run.head_sha='b'.repeat(40)]){const bad=structuredClone(artifact);mutate(bad);assert.throws(()=>assertBrowserReportArtifact([bad]));}
assert.throws(()=>assertBrowserReportArtifact([artifact,artifact]));assert.throws(()=>assertBrowserReportArtifact([]));
const originalJob={head_sha:BROWSER_REPAIR.sha,status:'completed',conclusion:'failure',steps:[['Install carousel browser matrix','success'],['Download candidate build','success'],['Restore exact candidate static site','success'],['Run full static browser regression','failure'],['Confirm tested browser candidate bytes','skipped']].map(([name,conclusion])=>({name,status:'completed',conclusion}))};
assertOriginalBrowserJob(originalJob);
for(const name of ['Install carousel browser matrix','Download candidate build','Restore exact candidate static site','Run full static browser regression','Confirm tested browser candidate bytes']){const missing=structuredClone(originalJob);missing.steps=missing.steps.filter(s=>s.name!==name);assert.throws(()=>assertOriginalBrowserJob(missing));for(const conclusion of ['success','failure','skipped'])if(conclusion!==originalJob.steps.find(s=>s.name===name).conclusion){const bad=structuredClone(originalJob);bad.steps.find(s=>s.name===name).conclusion=conclusion;assert.throws(()=>assertOriginalBrowserJob(bad));}}
assert.throws(()=>assertOriginalBrowserJob({...originalJob,steps:[...originalJob.steps].reverse()}));
const publicationGuardFiles=['scripts/lib/media-publication.mjs','scripts/test-release-plan.mjs','scripts/test-media-auth-config.mjs'];
const files=[...BROWSER_REPAIR_FILES].filter(f=>!publicationGuardFiles.includes(f));assert.equal(repairKind(files),'browser-fixture');
for(const file of ['workers/auth/src/index.js','js/shared/website-assistant.js','tests/helpers/website-assistant-server.mjs','package-lock.json','playwright.config.js','scripts/build-static-site.mjs'])assert.throws(()=>repairKind([...files,file]));
for(const file of ['tests/auth-admin.spec.js','tests/website-assistant.spec.js','.github/workflows/static.yml'])assert.throws(()=>repairKind(files.filter(f=>f!==file)));
const selected=repairSelection({reasons:{auth:[],static:[]},files},files);assert.equal(selected.browserRepair,true);assert.equal(selected.auth,true);for(const key of ['full','workers','homepage','carousel','assets'])assert.equal(selected[key],false);
const requirements=requiredJobs(selected);assert.deepEqual(requirements['browser-validation'],['Run repaired browser acceptance','Confirm tested browser candidate bytes']);
const repairRequirements=structuredClone(requirements);repairRequirements['release-compatibility']=repairRequirements['release-compatibility'].filter(s=>s!=='Record candidate build');repairRequirements['release-compatibility'].push('Select tests from changed files','Validate static website references');
const jobs=Object.entries(repairRequirements).map(([name,steps])=>({name,head_sha:'a'.repeat(40),status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
assertRepairAcceptance(jobs,'a'.repeat(40),files);
for(const name of ['Run repaired browser acceptance','Confirm tested browser candidate bytes'])for(const conclusion of ['failure','skipped']){const bad=structuredClone(jobs);bad.find(j=>j.name==='browser-validation').steps.find(s=>s.name===name).conclusion=conclusion;assert.throws(()=>assertRepairAcceptance(bad,'a'.repeat(40),files));}
assert.throws(()=>assertBrowserRepairTrees('0'.repeat(40),'a'.repeat(40)),/Different browser repair source/);
const publicationFiles=[...files,...publicationGuardFiles];assert.equal(repairKind(publicationFiles),'browser-publication');
const publicationSelection=repairSelection({reasons:{auth:[],static:[]},files:publicationFiles},publicationFiles);
for(const key of ['full','workers','homepage','carousel','assets','auth','browserRepair'])assert.equal(publicationSelection[key],false,`Completed ${key} acceptance must not rerun`);
assert.deepEqual(Object.keys(requiredJobs(publicationSelection)),['release-compatibility']);
assertRepairAcceptance(jobs.filter(j=>j.name!=='browser-validation'),'a'.repeat(40),publicationFiles);
assert.throws(()=>assertRepairAcceptance(jobs.filter(j=>j.name!=='browser-validation').map(j=>({...j,conclusion:'failure'})),'a'.repeat(40),publicationFiles));
for(const name of publicationGuardFiles.slice(1))assert.throws(()=>repairKind(publicationFiles.filter(f=>f!==name)),/focused regression/);
const accepted=BROWSER_REPAIR_ACCEPTANCE;
const acceptedStep=name=>({name,status:'completed',conclusion:'success'});
const acceptedJob=(name,conclusion,steps=[])=>({name,head_sha:accepted.publicationSha,status:'completed',conclusion,steps});
const acceptedState={run:{id:Number(accepted.run),run_attempt:1,head_sha:accepted.publicationSha,head_branch:'main',path:'.github/workflows/static.yml',event:'push',repository:{full_name:'bitbiai/Bitbi'},head_repository:{full_name:'bitbiai/Bitbi'},status:'completed',conclusion:'failure'},jobs:[
  acceptedJob('release-compatibility','success'),acceptedJob('worker-validation','skipped'),acceptedJob('homepage-validation','skipped'),
  acceptedJob('browser-validation','success',['Install carousel browser matrix','Restore unchanged browser repair candidate','Restore exact candidate static site','Run repaired browser acceptance','Confirm tested browser candidate bytes','Upload tested browser candidate identity'].map(acceptedStep)),
  acceptedJob('deploy','failure',[{...acceptedStep('Apply verified candidate backend prerequisites'),conclusion:'failure'},...['Preserve backend activation evidence','Deploy and verify Cloudflare frontend','Record durable frontend receipt'].map(name=>({...acceptedStep(name),conclusion:'skipped'}))]),
],artifacts:[{id:accepted.artifact,name:`pages-proof-browser-validation-${accepted.publicationSha}-${accepted.run}-${accepted.attempt}`,digest:`sha256:${accepted.archiveHash}`,expired:false,expires_at:new Date(Date.now()+86400000).toISOString(),size_in_bytes:1024,workflow_run:{id:Number(accepted.run),head_sha:accepted.publicationSha}}]};
assertCompletedBrowserRepair(acceptedState);
for(const mutate of [
 s=>s.run.id++,s=>s.run.run_attempt++,s=>s.run.head_sha='0'.repeat(40),s=>s.run.event='pull_request',s=>s.run.conclusion='success',s=>s.run.status='in_progress',s=>s.run.repository.full_name='foreign/repo',
 s=>s.jobs.pop(),s=>s.jobs[3].conclusion='failure',s=>s.jobs[3].conclusion='skipped',s=>s.jobs[3].steps.pop(),s=>s.jobs[3].steps.reverse(),s=>s.jobs[3].steps[0].conclusion='skipped',s=>s.jobs[4].steps[0].name='Unrelated failure',s=>s.jobs[4].steps[1].conclusion='success',s=>s.jobs.push(s.jobs[3]),
 s=>s.artifacts=[],s=>s.artifacts.push(s.artifacts[0]),s=>s.artifacts[0].id++,s=>s.artifacts[0].digest='sha256:'+'0'.repeat(64),s=>s.artifacts[0].expired=true,s=>s.artifacts[0].expires_at='invalid',s=>s.artifacts[0].workflow_run.head_sha='0'.repeat(40),s=>s.artifacts[0].workflow_run.id++,s=>s.artifacts[0].size_in_bytes=0,
]){const bad=structuredClone(acceptedState);mutate(bad);assert.throws(()=>assertCompletedBrowserRepair(bad));}
const report={errors:[],stats:{expected:1,unexpected:0,flaky:0,skipped:0},suites:[{specs:[{id:'i',file:'f',title:'t',tests:[{projectName:'p',expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0}]}]}]}]};
assert.deepEqual(browserRows(report),[pass('p:i','f','t','p')]);assert.deepEqual(browserRows(report,{discovery:true}),[identity(pass('p:i','f','t','p'))]);assert.throws(()=>browserRows({...report,errors:[{}]}));assert.throws(()=>browserRows({suites:[]}));
for(const stats of [undefined,{}, {...report.stats,expected:0},{...report.stats,skipped:-1},{...report.stats,flaky:'0'},{...report.stats,unexpected:1}])assert.throws(()=>browserRows({...report,stats}));
assert(repairs.every(repairedCase)&&controls.every(repairedCase));assert.equal(Object.keys(BROWSER_REPAIR_SPECS).length,2);
console.log('Browser fixture repair: complete case union, immutable failed-source identity, exact fresh controls/tail, retry/failure/skip/tampering/missing evidence and selected-job gates verified (synthetic counterchecks).');
