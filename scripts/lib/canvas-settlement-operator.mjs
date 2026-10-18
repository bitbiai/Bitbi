// Narrow D1 binding adapter for the audited Canvas settlement service. Query
// text comes from repository code, never from the operator's input document.
// https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
const fail=code=>{throw Object.assign(new Error(code),{code});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function validateCanvasSettlementOperatorInput(input,{execute=false}={}) {
    const identities=['userId','projectId','runId','stepId','operationId','usageAttemptId'];
    const allowed=[...identities,'expectedSource','expectedSchema','originalReservationCredits','projectCapCredits','reviewDigest','actor','authorizationRef'];
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key))
        ||identities.some(key=>!id(input[key]))||!/^[a-f0-9]{40}$/.test(input.expectedSource||'')
        ||!/^[0-9]{4}_canvas_agent_settlement_reviews\.sql$/.test(input.expectedSchema||'')
        ||!Number.isSafeInteger(input.originalReservationCredits)||input.originalReservationCredits<1
        ||!Number.isSafeInteger(input.projectCapCredits)||input.projectCapCredits<input.originalReservationCredits||input.projectCapCredits>100000
        ||execute&&(!/^[a-f0-9]{64}$/.test(input.reviewDigest||'')
          ||!/^[a-zA-Z0-9_.:/-]{1,160}$/.test(input.authorizationRef||'')||!/^[a-zA-Z0-9_.:@/-]{1,100}$/.test(input.actor||'')))
        fail('canvas_settlement_operator_input_invalid');
    return {...input};
}

export function createCanvasSettlementCloudflareClient({accountId,databaseId,token,fetcher=fetch}) {
    if(!/^[a-f0-9]{32}$/.test(accountId||'')||!uuid(databaseId)||typeof token!=='string'||!token.trim())
        fail('canvas_settlement_operator_credential_unavailable');
    const origin=`https://api.cloudflare.com/client/v4/accounts/${accountId}`;
    async function request(path,body,{mutation=false}={}) {
        let response,payload;
        try {
            response=await fetcher(origin+path,{method:body?'POST':'GET',redirect:'error',
                headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},
                ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
            payload=await response.json();
        } catch {fail(mutation?'canvas_settlement_transport_outcome_unknown':'canvas_settlement_read_unavailable');}
        if(!response.ok||payload?.success!==true)fail(mutation?'canvas_settlement_mutation_not_confirmed':'canvas_settlement_read_unavailable');
        return payload.result;
    }
    return {
        query:async(queries,{batch=false}={})=>{
            const mutation=queries.some(item=>!/^\s*SELECT\b/i.test(item.sql));
            const result=await request(`/d1/database/${databaseId}/query`,batch?{batch:queries}:queries[0],{mutation});
            if(!Array.isArray(result)||result.length!==queries.length||result.some(item=>item?.success!==true||!Array.isArray(item.results)))
                fail(mutation?'canvas_settlement_mutation_not_confirmed':'canvas_settlement_read_invalid');
            return result;
        },
        readWorker:async(worker,version=null)=>{
            if(!['auth','ai'].includes(worker)||version!==null&&!uuid(version))fail('canvas_settlement_read_path_invalid');
            return request(`/workers/scripts/bitbi-${worker}/${version?`versions/${version}`:'deployments'}`);
        },
    };
}

export function createCanvasSettlementD1Binding(client,{readOnly=true}={}) {
    const owned=new WeakSet();
    const validate=sql=>{
        if(typeof sql!=='string'||sql.length>150000||sql.includes(';')||!/^(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql.trim()))
            fail('canvas_settlement_statement_invalid');
        if(readOnly&&!/^\s*SELECT\b/i.test(sql))fail('canvas_settlement_read_only');
    };
    function prepare(sql,params=[]) {
        validate(sql);
        const statement={sql,params,
            bind(...values){if(values.some(value=>value!==null&&!['string','number'].includes(typeof value)))fail('canvas_settlement_parameter_invalid');return prepare(sql,values);},
            async all(){return (await client.query([{sql,params}]))[0];},
            async run(){return this.all();},
            async first(column){const row=(await this.all()).results[0]||null;return column&&row?row[column]:row;},
        };
        owned.add(statement);return statement;
    }
    return {prepare,
        async batch(statements){
            if(!Array.isArray(statements)||!statements.length||statements.length>100||statements.some(value=>!owned.has(value)))
                fail('canvas_settlement_batch_invalid');
            for(const statement of statements)validate(statement.sql);
            // One REST request preserves D1 batch atomicity. A transport failure
            // is never retried here, including a lost response after commitment.
            return client.query(statements.map(({sql,params})=>({sql,params})),{batch:true});
        },
    };
}

export async function verifyCanvasSettlementRuntime(client,DB,input) {
    const components={};
    for(const worker of ['auth','ai']) {
        const deployments=await client.readWorker(worker),deployment=deployments?.deployments?.[0];
        if(deployment?.versions?.length!==1||deployment.versions[0].percentage!==100||!uuid(deployment.versions[0].version_id))
            fail('canvas_settlement_runtime_not_current');
        const version=await client.readWorker(worker,deployment.versions[0].version_id);
        if(version?.id!==deployment.versions[0].version_id||version.annotations?.['workers/message']!==`bitbi-${worker}:${input.expectedSource}`)
            fail('canvas_settlement_runtime_not_current');
        components[worker]={versionId:version.id,deploymentId:deployment.id,source:input.expectedSource,activatedAt:deployment.created_on};
    }
    const migration=await DB.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').first();
    if(migration?.name!==input.expectedSchema)fail('canvas_settlement_schema_not_current');
    return {components,schema:migration.name,verifiedAt:new Date().toISOString()};
}

export function verifyCanvasSettlementOperatorQuote(input,preview) {
    if(preview.reservationCredits!==input.originalReservationCredits||preview.budget?.capCredits!==input.projectCapCredits
        ||preview.settlementCredits>input.originalReservationCredits||preview.budget.committedCredits>input.projectCapCredits)
        fail('canvas_settlement_operator_scope_changed');
    if(input.reviewDigest&&input.reviewDigest!==preview.reviewDigest)fail('canvas_settlement_operator_review_changed');
    return preview;
}
