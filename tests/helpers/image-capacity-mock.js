const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');

// Legacy route fixtures execute the real slot SQL/constraints. This projection
// is not native D1 acceptance; the queue controls use the complete real schema.
function executeImageCapacity(host,{query,bindings,mode}) {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=OFF;
      CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE canvas_projects(id TEXT PRIMARY KEY,revision INTEGER,deleted_at TEXT);
      CREATE TABLE member_generation_jobs(id TEXT PRIMARY KEY,usage_attempt_id TEXT,user_id TEXT);
      CREATE TABLE member_ai_usage_attempts(id TEXT PRIMARY KEY,provider_outcome TEXT,billing_status TEXT,metadata_json TEXT,user_id TEXT,operation_key TEXT,created_at TEXT,result_model TEXT);
      CREATE TABLE ai_usage_attempts(id TEXT PRIMARY KEY,provider_outcome TEXT,billing_status TEXT,metadata_json TEXT,user_id TEXT,operation_key TEXT,created_at TEXT,result_model TEXT);
      CREATE TABLE canvas_agent_runs(id TEXT PRIMARY KEY,status TEXT,expected_revision INTEGER,expires_at TEXT);`);
    for(const [table,key,cols] of [['users','users',['id','status']],['canvas_projects','canvasProjects',['id','revision','deleted_at']],
      ['member_generation_jobs','memberGenerationJobs',['id','usage_attempt_id','user_id']],
      ['member_ai_usage_attempts','memberAiUsageAttempts',['id','provider_outcome','billing_status','metadata_json','user_id','operation_key','created_at','result_model']],
      ['ai_usage_attempts','aiUsageAttempts',['id','provider_outcome','billing_status','metadata_json','user_id','operation_key','created_at','result_model']],
      ['canvas_agent_runs','canvasAgentRuns',['id','status','expected_revision','expires_at']]]) {
      const insert=db.prepare(`INSERT INTO ${table} VALUES(${cols.map(()=>'?')})`);
      for(const row of host.state[key]||[])insert.run(...cols.map(col=>row[col]??null));
    }
    const migration=fs.readFileSync(path.join(__dirname,'../../workers/auth/migrations/0112_canvas_assistant_models_and_scheduling.sql'),'utf8');
    const schema=migration.match(/CREATE TABLE image_generation_slots \([\s\S]*?BEGIN SELECT RAISE\(ABORT,'image_generation_identity_immutable'\); END;/)?.[0];
    if(!schema)throw new Error('Missing actual image capacity schema');
    db.exec(schema);
    const columns=db.prepare('PRAGMA table_info(image_generation_slots)').all().map(row=>row.name);
    const insert=db.prepare(`INSERT INTO image_generation_slots(${columns}) VALUES(${columns.map(()=>'?')})`);
    for(const row of host.state.imageGenerationSlots||[])insert.run(...columns.map(col=>row[col]??null));
    if(host.missingTables.has('image_generation_slots'))db.exec('DROP TABLE image_generation_slots');
    if(host.failQueries.some(fragment=>query.includes(fragment)))throw new Error('forced query failure');
    const statement=db.prepare(query);
    let result;
    if(mode==='first')result=statement.get(...bindings)||null;
    else if(mode==='all')result={results:statement.all(...bindings)};
    else {const changed=statement.run(...bindings);result={success:true,meta:{changes:Number(changed.changes)}};}
    host.state.imageGenerationSlots=db.prepare('SELECT * FROM image_generation_slots ORDER BY rowid').all();
    return result;
  } finally {db.close();}
}
module.exports={executeImageCapacity};
