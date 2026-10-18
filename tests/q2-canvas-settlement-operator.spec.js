const {test,expect}=require('@playwright/test');
const account='a'.repeat(32),database='11111111-1111-1111-1111-111111111111',version='22222222-2222-2222-2222-222222222222';
const source='b'.repeat(40),schema='0111_canvas_agent_settlement_reviews.sql';
const load=()=>import('../scripts/lib/canvas-settlement-operator.mjs');
const input=()=>({userId:'synthetic-owner',projectId:'synthetic-project',runId:'synthetic-run',stepId:'synthetic-step',
    operationId:'synthetic-operation',usageAttemptId:'synthetic-usage',expectedSource:source,expectedSchema:schema,
    originalReservationCredits:146,projectCapCredits:3893});
const result=results=>Response.json({success:true,result:results.map(rows=>({success:true,results:rows,meta:{changes:0}}))});

test('Canvas settlement operator validates exact monetary scope and explicit digest approval',async()=>{
    const m=await load(),value=input();
    expect(m.validateCanvasSettlementOperatorInput(value)).toEqual(value);
    for(const changed of [{...value,sql:'UPDATE users SET status=active'},{...value,endpoint:'https://example.com'},
        {...value,projectCapCredits:145},{...value,expectedSource:'main'},{...value,userId:null}])
        expect(()=>m.validateCanvasSettlementOperatorInput(changed)).toThrow('canvas_settlement_operator_input_invalid');
    expect(()=>m.validateCanvasSettlementOperatorInput(value,{execute:true})).toThrow('canvas_settlement_operator_input_invalid');
    const approved={...value,reviewDigest:'c'.repeat(64),actor:'fixture-operator',authorizationRef:'fixture-owner-approval'};
    expect(m.validateCanvasSettlementOperatorInput(approved,{execute:true})).toEqual(approved);
    const preview={reservationCredits:146,settlementCredits:94,budget:{capCredits:3893,committedCredits:168},reviewDigest:approved.reviewDigest};
    expect(m.verifyCanvasSettlementOperatorQuote(approved,preview)).toBe(preview);
    for(const changed of [{...preview,reservationCredits:147},{...preview,settlementCredits:147},
        {...preview,budget:{capCredits:4000,committedCredits:168}},{...preview,reviewDigest:'d'.repeat(64)}])
        expect(()=>m.verifyCanvasSettlementOperatorQuote(approved,changed)).toThrow();
});

test('Canvas settlement D1 adapter emits one documented atomic batch with original bound values',async()=>{
    const m=await load(),calls=[];
    const client=m.createCanvasSettlementCloudflareClient({accountId:account,databaseId:database,token:'synthetic-credential',
        fetcher:async(url,init)=>{calls.push({url,init});return result([[],[],[{ok:1}]]);}});
    const DB=m.createCanvasSettlementD1Binding(client,{readOnly:false});
    const statements=[DB.prepare('UPDATE audit SET state=? WHERE id=?').bind('settled','original'),
        DB.prepare('INSERT INTO events(id,value) VALUES(?,?)').bind('original',94),DB.prepare('SELECT 1 AS ok')];
    const rows=await DB.batch(statements);
    expect(rows[2].results).toEqual([{ok:1}]);expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`);
    expect(calls[0].init.method).toBe('POST');expect(calls[0].init.redirect).toBe('error');
    expect(JSON.parse(calls[0].init.body)).toEqual({batch:[
        {sql:'UPDATE audit SET state=? WHERE id=?',params:['settled','original']},
        {sql:'INSERT INTO events(id,value) VALUES(?,?)',params:['original',94]},
        {sql:'SELECT 1 AS ok',params:[]},
    ]});
});

test('Canvas settlement dry run rejects writes, stacked SQL and foreign batch statements before transport',async()=>{
    const m=await load(),calls=[],client={query:async(...args)=>{calls.push(args);return [{success:true,results:[]}];}};
    const DB=m.createCanvasSettlementD1Binding(client);
    for(const sql of ['UPDATE audit SET state=1','SELECT 1; DELETE FROM audit','PRAGMA writable_schema=1'])
        expect(()=>DB.prepare(sql)).toThrow();
    await expect(DB.batch([{sql:'SELECT 1',params:[]}])).rejects.toThrow('canvas_settlement_batch_invalid');
    const statement=DB.prepare('SELECT 1');statement.sql='UPDATE audit SET state=1';
    await expect(DB.batch([statement])).rejects.toThrow('canvas_settlement_read_only');
    expect(calls).toHaveLength(0);
});

test('Canvas settlement adapter validates D1 envelopes and never repeats an uncertain mutation',async()=>{
    const m=await load();
    for(const outcome of ['timeout','partial','malformed','rejected']){
        let calls=0;
        const client=m.createCanvasSettlementCloudflareClient({accountId:account,databaseId:database,token:'synthetic-credential',fetcher:async()=>{
            calls++;
            if(outcome==='timeout')throw Error('private provider or SQL details must not escape');
            if(outcome==='malformed')return new Response('not json');
            if(outcome==='rejected')return Response.json({success:false,errors:[{message:'private SQL value'}]},{status:400});
            return Response.json({success:true,result:[{success:true,results:[]},{success:false,results:[],error:'private'}]});
        }});
        const DB=m.createCanvasSettlementD1Binding(client,{readOnly:false});
        let caught;try{await DB.batch([DB.prepare('UPDATE audit SET state=?').bind(1),DB.prepare('SELECT 1')]);}catch(error){caught=error;}
        expect(calls).toBe(1);expect(caught?.code).toMatch(/^canvas_settlement_(?:transport_outcome_unknown|mutation_not_confirmed)$/);
        expect(String(caught)).not.toContain('private');
    }
});

test('Canvas settlement operator requires actual deployed Auth and AI source plus current schema',async()=>{
    const m=await load(),reads=[];
    const client={readWorker:async(worker,requestedVersion)=>{
        reads.push([worker,requestedVersion]);
        return requestedVersion?{id:version,annotations:{'workers/message':`bitbi-${worker}:${source}`}}:
            {deployments:[{id:`deployment-${worker}`,created_on:'2026-10-18T00:00:00Z',versions:[{version_id:version,percentage:100}]}]};
    }};
    const DB={prepare:sql=>({first:async()=>{expect(sql).toBe('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1');return{name:schema};}})};
    const proof=await m.verifyCanvasSettlementRuntime(client,DB,input());
    expect(proof.schema).toBe(schema);expect(proof.components.auth.source).toBe(source);expect(reads).toHaveLength(4);
    await expect(m.verifyCanvasSettlementRuntime({...client,readWorker:async(worker,v)=>v?{id:version,annotations:{'workers/message':`bitbi-${worker}:${'e'.repeat(40)}`}}:client.readWorker(worker,v)},DB,input()))
        .rejects.toThrow('canvas_settlement_runtime_not_current');
    await expect(m.verifyCanvasSettlementRuntime({...client,readWorker:async()=>({deployments:[{versions:[{version_id:version,percentage:50}]}]})},DB,input()))
        .rejects.toThrow('canvas_settlement_runtime_not_current');
    await expect(m.verifyCanvasSettlementRuntime(client,{prepare:()=>({first:async()=>({name:'0110_previous.sql'})})},input()))
        .rejects.toThrow('canvas_settlement_schema_not_current');
});
