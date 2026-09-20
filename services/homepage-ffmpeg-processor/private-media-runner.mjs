// Both adapters drain accepted media work through the same authenticated transport.
export async function runPrivateMedia({requestJson,token,runner,processExports,processPosters,processReferences=async()=>{},processPreviews=async()=>{},now=Date.now}) {
  if(!/^[a-f0-9]{32}$/.test(token||'')||!/^[a-zA-Z0-9_-]{1,100}$/.test(runner||''))throw Object.assign(new Error('media_runner_invalid'),{code:'media_runner_invalid'});
  const call=async action=>(await requestJson('/api/internal/homepage/hero-videos/private-media/runner',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,runner,action}),signal:AbortSignal.timeout(15000)})).data;
  await call('acquire');
  const started=now();let passes=0,pending=0;
  try {
    do {
      const {previews}=await call('heartbeat');
      await processReferences();
      await processExports();
      await processPosters(); // Includes the export just saved, same invocation.
      await processPreviews(previews);
      passes++;
      pending=(await call('heartbeat')).pending;if(!pending)break;
    } while(passes<8 && now()-started<15*60_000);
  } finally {await call('finish');}
  console.log(JSON.stringify({phase:'private_media',passes,status:pending?'yielded':'drained'}));
  return {passes};
}
