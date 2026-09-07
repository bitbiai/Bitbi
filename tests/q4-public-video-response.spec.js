const { test, expect } = require('@playwright/test');
let api;
test.beforeAll(async()=>{api=await import('../workers/auth/src/lib/public-video-response.mjs');});
test('public video ranges retain exact byte semantics without full-body buffering',async()=>{
  for(const [field,expected] of [['bytes=1-2',{offset:1,length:2}],['bytes=-999999999999999999999',{offset:0,length:8}],['bytes=0-999999999999999999999',{offset:0,length:8}],['bytes=8-',{unsatisfiable:true}],['bytes=-0',{unsatisfiable:true}],['bytes=0-1,4-5',null],['bytes=bad',null]])expect(api.parseVideoRange(field,8)).toEqual(expected);
  const metadata={size:8,etag:'old',httpEtag:'"old"',uploaded:new Date('2026-09-07T00:00:00Z')};
  const calls=[];const bucket={head:async()=>metadata,get:async(key,options)=>{calls.push(options);return {...metadata,body:new Uint8Array([2,3])};}};
  const result=await api.publicVideoResponse(new Request('https://fixture.invalid/file',{headers:{Range:'bytes=2-3'}}),bucket,'key',()=>new Headers({'Content-Length':'8'}));
  expect(calls).toEqual([{range:{offset:2,length:2},onlyIf:{etagMatches:'old'}}]);expect(result.status).toBe(206);
  expect(result.headers.get('content-length')).toBe('2');expect(result.headers.get('content-range')).toBe('bytes 2-3/8');
  expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([2,3]);
});
test('public video replacement and missing object never return a mismatched partial body',async()=>{
  const headers=()=>new Headers();const request=new Request('https://fixture.invalid/file',{headers:{Range:'bytes=2-3'}});
  const metadata={size:8,etag:'old',httpEtag:'"old"'};
  const changed=await api.publicVideoResponse(request,{head:async()=>metadata,get:async()=>({...metadata,etag:'new'})},'key',headers);
  expect(changed.status).toBe(503);expect(changed.headers.get('cache-control')).toBe('no-store');
  expect(await api.publicVideoResponse(request,{head:async()=>null},'key',headers)).toBeNull();
  const calls=[];
  const bucket={head:async()=>metadata,get:async(k,o)=>{calls.push(o);return {...metadata,body:new Uint8Array(8)};}};
  const stale=await api.publicVideoResponse(new Request(request,{headers:{Range:'bytes=2-3','If-Range':'W/"old"'}}),bucket,'key',headers);
  expect(stale.status).toBe(200);expect(calls).toEqual([undefined]);await stale.arrayBuffer();
});
