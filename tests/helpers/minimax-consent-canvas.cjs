module.exports=async({page,expect,locale,mockSharedAuth,createCanvasApiMock})=>{
 const de=locale==='de',id=n=>String(n).repeat(32),now=new Date().toISOString();
 await mockSharedAuth(page);await page.setViewportSize({width:1440,height:900});
 const registry=await import('../../js/shared/canvas-model-contract.mjs');
 const models=registry.listCanvasModelsForRole('user');
 const state=createCanvasApiMock(page,{modelPayload:{models,organizations:[],selected_organization_id:null,access:{role:'user'}}});
 state.projects=[{id:id(1),title:'Consent fixture',locale,created_at:now,updated_at:now}];
 state.nodes=[{id:id(2),project_id:id(1),type:'video_generation',title:'MiniMax shot',model_id:'minimax/h3',config:{prompt:'Synthetic motion',duration:5,resolution:'768P'},content:{},x:100,y:100,created_at:now,updated_at:now}];
 let granted=false,grants=0;const runKeys=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/account/minimax-consent',route=>{if(route.request().method()==='POST'){granted=true;grants++;}return route.fulfill({json:{ok:true,consent:{granted,grantedAt:now,textVersion:'minimax-consent-v3-2026-11-16'}}});});
 await page.route(`**/nodes/${id(2)}/run`,route=>{
  runKeys.push(route.request().headers()['idempotency-key']);
  if(runKeys.length===1){granted=false;return route.fulfill({status:403,json:{ok:false,code:'consent_required',error:'MiniMax consent is required.'}});}
  return route.fulfill({json:{ok:true,data:{run:{id:id(3),project_id:id(1),node_id:id(2),model_id:'minimax/h3',status:'completed',output:null,created_at:now,updated_at:now}}}});
 });
 await page.goto(de?'/de/canvas/':'/canvas/');await page.locator(`[data-node-id="${id(2)}"]`).click();
 const panel=page.locator('#canvasInspectorPanel');await expect(panel).toBeVisible();
 await panel.getByRole('button',{name:de?'Ausführen':'Run',exact:true}).click();
 const dialog=page.locator('[data-minimax-consent-dialog]');await expect(dialog).toBeVisible();
 expect(state.requests.filter(r=>r.method==='POST'&&r.pathname.endsWith('/run'))).toEqual([]);
 await dialog.getByRole('button',{name:de?'Nicht jetzt':'Not now',exact:true}).click();
 expect(state.requests.filter(r=>r.method==='POST'&&r.pathname.endsWith('/run'))).toEqual([]);
 expect(runKeys).toEqual([]);await panel.getByRole('button',{name:de?'Ausführen':'Run',exact:true}).click();
 await dialog.getByRole('button',{name:de?'Einwilligen':'Consent',exact:true}).click();
 await expect.poll(()=>runKeys.length).toBe(1);await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:de?'Einwilligen':'Consent',exact:true}).click();
 await expect.poll(()=>runKeys.length).toBe(2);expect(runKeys[0]).toBeTruthy();expect(runKeys[1]).toBe(runKeys[0]);expect(grants).toBe(2);await expect(dialog).toHaveCount(0);expect(errors).toEqual([]);
};
