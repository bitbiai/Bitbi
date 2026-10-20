const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');

for(const name of ['evidence','quoted','budget-scope'])test(`Canvas informed explanation ${name} preserves source facts and financial scope`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try{
    const {canvasExplanationCase}=await import('./helpers/canvas-agent-explanation-control.mjs');
    expect((await canvasExplanationCase({...createAuthTestEnv(),DB},name)).case).toBe(name);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

test('Canvas selected Fable production corrects invalid plans and applies ordinary editable graph with pinned billing',async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try{
    const {canvasAssistantProductionCase}=await import('./helpers/canvas-assistant-model-control.mjs');
    expect(await canvasAssistantProductionCase({...createAuthTestEnv(),DB})).toEqual({providerCalls:2,corrections:1,nodes:4,assemblyClips:3,technicalOnly:true,acceptedModelPinned:true});
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

test('Canvas assistant switching preserves pending model receipts billing attribution and canonical project memory',async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try{
    const {canvasAssistantModelSwitchCase}=await import('./helpers/canvas-assistant-model-control.mjs');
    expect(await canvasAssistantModelSwitchCase({...createAuthTestEnv(),DB})).toEqual({models:2,providerCalls:2,debits:2,originalIdentitiesPreserved:true,opaqueContextShared:false});
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

test('Canvas duration delegation requires affirmative intent and preserves a known numeric answer',async()=>{
  const {userDuration,emptyBrief}=await import('../workers/auth/src/lib/canvas-agent-conversation.js');
  const id='duration-source-message',unasked=emptyBrief(),asked=emptyBrief();asked.duration.asked=true;
  for(const text of ['Do not choose the duration.','Please do not choose the film length.','Wähle die Dauer nicht.','Bestimme nicht die Länge.','', 'Enough questions.']) {
    expect(userDuration(text,unasked,id),text).toBeNull();expect(userDuration(text,asked,id),text).toBeNull();
  }
  for(const text of ['Choose a suitable duration.','Please pick the film length.','Wähle eine passende Dauer.'])
    expect(userDuration(text,unasked,id),text).toMatchObject({choice:'delegated',targetDurationSeconds:null,sourceMessageId:id});
  expect(userDuration('you choose',unasked,id)).toBeNull();
  expect(userDuration('you choose',asked,id)).toMatchObject({choice:'delegated',sourceMessageId:id});
  expect(userDuration('Roughly two minutes.',unasked,id)).toMatchObject({choice:'explicit',targetDurationSeconds:120,sourceMessageId:id});
  expect(userDuration('120',asked,id)).toMatchObject({choice:'explicit',targetDurationSeconds:120,sourceMessageId:id});
  expect(userDuration('120',unasked,id)).toBeNull();
  for(const text of ['Ein lustiger Clip von ungefähr 45 Sekunden mit Hintergrundmusik.', 'A funny clip about 45 seconds long with background music.'])
    expect(userDuration(text,asked,id),text).toMatchObject({choice:'explicit',targetDurationSeconds:45,sourceMessageId:id});
  for(const text of ['Drei Clips von 15 Sekunden.', 'Je Clip 15 Sekunden.', '45 oder 60 Sekunden.',
    'Use a 5 second clip for each scene.', 'Ein Clip von 5 Sekunden pro Szene.'])
    expect(userDuration(text,asked,id),text).toBeNull();
});

for(const name of ['briefing','isolation','recovery','unknown','revocation','concurrency','status-pending','paused-cap'])test(`Canvas conversation ${name} through authenticated durable production boundaries`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try {
    const {canvasConversationCase}=await import('./helpers/canvas-agent-conversation-control.mjs');
    const result=await canvasConversationCase({...createAuthTestEnv(),DB},name);
    expect(result.case).toBe(name);expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

for(const name of ['queued-observation','snail','prepare','rejected','rejected-tail','malformed','invalid-tail','lost-acceptance','ack-error','normalization','storage','completed-tail','failed-projection','expired-projection','historical','stale-policy','isolation'])test(`Canvas conversation recovery ${name} through signed transport and persisted receipts`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try {
    const {canvasConversationRecoveryCase}=await import('./helpers/canvas-agent-conversation-recovery-control.mjs');
    const result=await canvasConversationRecoveryCase({...createAuthTestEnv(),DB},name);
    expect(result.case).toBe(name);expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

test('Canvas conversation migration preserves existing productions without inventing a transcript',async()=>{
  const fs=require('node:fs'),path=require('node:path'),DB=new SqliteD1Database();
  applyAuthMigrations(DB,{through:'0108_canvas_creative_export_retention.sql'});
  try {
    const {seedCanvasConversationMigration,verifyCanvasConversationMigration}=await import('./helpers/canvas-agent-conversation-control.mjs');
    const env={...createAuthTestEnv(),DB},seed=await seedCanvasConversationMigration(env);
    DB.exec(fs.readFileSync(path.join(process.cwd(),'workers/auth/migrations/0109_canvas_agent_conversations.sql'),'utf8'));
    expect(await verifyCanvasConversationMigration(env,seed)).toEqual({historicalRequestsPreserved:1,fabricatedConversations:0,creativeRevisionUnchanged:true});
  }finally{DB.close();}
});

test('Canvas natural-chat migration preserves paid identities and saved conversations without inventing action consent',async()=>{
  const fs=require('node:fs'),path=require('node:path'),DB=new SqliteD1Database();
  applyAuthMigrations(DB,{through:'0109_canvas_agent_conversations.sql'});
  try {
    const {seedCanvasNaturalChatMigration,verifyCanvasNaturalChatMigration}=await import('./helpers/canvas-agent-natural-control.mjs');
    const env={...createAuthTestEnv(),DB},seed=await seedCanvasNaturalChatMigration(env);
    DB.exec(fs.readFileSync(path.join(process.cwd(),'workers/auth/migrations/0110_canvas_agent_conversation_actions.sql'),'utf8'));
    expect(await verifyCanvasNaturalChatMigration(env,seed)).toEqual({originalDebit:78,originalConversationPreserved:true,newAuthorizations:0});
  } finally {DB.close();}
});

for(const name of ['immediate','delegation','waiting','unknown-waiting','cancel-waiting','stale-project','stale-brief','stale-price','consent-isolation','concurrent-approval','natural-start','button-chat-race','emergency','saved-brief','clear-intent','quote-evaluation','stale-metering-quote'])test(`Canvas natural chat ${name} uses the existing durable production authority`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try{
    const {canvasNaturalCase}=await import('./helpers/canvas-agent-natural-control.mjs');
    expect((await canvasNaturalCase({...createAuthTestEnv(),DB},name)).case).toBe(name);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

for(const name of ['assembly','node-settings','regenerate','consent','foreign-target','stale-target','production-controls','assembly-extended','budget-controls'])test(`Canvas conversational actions ${name} update ordinary owned project services`,async()=>{
  const fs=require('node:fs'),path=require('node:path'),DB=new SqliteD1Database();applyAuthMigrations(DB);
  const media=file=>fs.readFileSync(path.join(__dirname,'fixtures/media',file)).toString('base64');
  try{
    const {canvasActionCase}=await import('./helpers/canvas-agent-natural-control.mjs');
    expect((await canvasActionCase({...createAuthTestEnv(),DB},{name,videoBase64:media('canvas-end-frame.mp4'),imageBase64:media('h3-frame.png'),musicBase64:media('member-music.mp3')})).case).toBe(name);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

test('Canvas runtime policy stays in signed Worker inputs and outside the static website build',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {buildStaticSite,SITE_ROOT_DIRS}=await import('../scripts/lib/asset-version.mjs');
  const {core}=await import('../workers/shared/canvas-agent/core.mjs');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-policy-build-')),repo=path.join(temp,'repo'),out=path.join(temp,'site');
  const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
  const assertPublicBoundary=directory=>{
    expect(fs.existsSync(path.join(directory,'workers')),'Worker instruction package must not be published').toBe(false);
    for(const file of walk(directory).filter(file=>/\.(?:js|mjs|html|json)$/.test(file))) {
      const source=fs.readFileSync(file,'utf8');
      expect(source,`${file} may not embed the policy core`).not.toContain(core.text);
      expect(source,`${file} may not import server policy`).not.toMatch(/(?:from\s*|import\s*\(\s*|import\s*)['"][^'"]*workers\/shared\/canvas-agent/);
    }
  };
  try {
    fs.mkdirSync(path.join(repo,'js'),{recursive:true});
    fs.writeFileSync(path.join(repo,'index.html'),'<script type="module" src="js/app.js?v=__ASSET_VERSION__"></script>');
    fs.writeFileSync(path.join(repo,'js/app.js'),'document.body.textContent = "Canvas";');
    fs.cpSync(path.join(process.cwd(),'workers/shared/canvas-agent'),path.join(repo,'workers/shared/canvas-agent'),{recursive:true});
    buildStaticSite(repo,{outDir:out,placeholder:'__ASSET_VERSION__',versionToken:'policy-boundary'});
    assertPublicBoundary(out);
    // Calibrate the actual verifier against both ways a private module could leak.
    fs.writeFileSync(path.join(out,'js/broken.js'),`import '../workers/shared/canvas-agent/manifest.mjs';`);
    expect(()=>assertPublicBoundary(out)).toThrow();
    fs.writeFileSync(path.join(out,'js/broken.js'),core.text);
    expect(()=>assertPublicBoundary(out)).toThrow();
    fs.unlinkSync(path.join(out,'js/broken.js'));
    for(const root of SITE_ROOT_DIRS) {
      const directory=path.join(process.cwd(),root);
      if(fs.existsSync(directory))assertPublicBoundary(directory);
    }
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
