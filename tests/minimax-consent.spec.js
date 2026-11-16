const {test,expect}=require('@playwright/test');
const {mockPublicAppearance}=require('./helpers/appearance.js');
const {mockAvailability}=require('./helpers/generation-selectors.cjs');
const VERSION='minimax-consent-v3-2026-11-16';
async function setup(page,locale,{loggedIn=true,granted=false}={}){
 let consent={granted,grantedAt:granted?'2026-11-16T10:00:00.000Z':null,textVersion:granted?VERSION:null},stale=false;
 const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>route.fulfill({json:{ok:true,data:{assets:[],folders:[],counts:{},creditBalance:5000},profile:{},account:{},items:[]}}));
 await mockPublicAppearance(page);await mockAvailability(page);
 await page.route('**/api/me',route=>route.fulfill({json:loggedIn?{loggedIn:true,user:{id:'consent-member',email:'consent@example.invalid',role:'user',minimaxConsent:consent}}:{loggedIn:false,user:null}}));
 await page.route('**/api/account/minimax-consent**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()==='POST'){const body=req.postDataJSON();requests.push({path,body});consent=path.endsWith('/revoke')?{...consent,granted:false,revokedAt:'2026-11-16T11:00:00.000Z'}:{granted:true,grantedAt:'2026-11-16T10:00:00.000Z',textVersion:VERSION,source:body.source};}
  return route.fulfill({json:{ok:true,consent}});
 });
 await page.route('**/api/register',route=>{requests.push({path:'/api/register',body:route.request().postDataJSON()});return route.fulfill({status:201,json:{ok:true,needsVerification:true}});});
 await page.route('**/api/ai/generate-*',route=>{requests.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});if(stale){stale=false;consent={...consent,granted:false};return route.fulfill({status:403,json:{ok:false,code:'consent_required',error:'MiniMax consent is required.'}});}return route.fulfill({json:{ok:true,data:{}}});});
 await page.route('**/minimax-consent-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${locale}"><body><div id="authModal"></div><section id="minimax-consent"></section><button id="anchor">Reference</button></body></html>`}));
 const harness=async()=>{await page.goto(`/${locale==='de'?'de/':''}minimax-consent-harness`);await page.evaluate(async()=>{const {initAuth}=await import('/js/shared/auth-state.js');await initAuth();});};
 return {requests,errors,harness,stale(){stale=true;},revoke(){consent={...consent,granted:false};}};
}
for(const locale of ['en','de']){
 test(`MiniMax ${locale} optional registration preserves account creation and exact checkbox opt-in`,async({page})=>{
  const f=await setup(page,locale,{loggedIn:false});await f.harness();
  await page.evaluate(async()=>{const m=await import('/js/shared/auth-modal.js');m.initAuthModal();m.openAuthModal('register');});
  const form=page.locator('#authRegisterForm'),box=form.locator('[name=minimaxConsent]');await expect(box).not.toBeChecked();await expect(box).not.toHaveAttribute('required');
  await form.locator('[name=email]').fill('new@example.invalid');await form.locator('[name=password]').fill('Synthetic-password-123');await form.locator('[type=submit]').click();
  await expect.poll(()=>f.requests.length).toBe(1);expect(f.requests[0].body).toMatchObject({minimaxConsent:false,locale});await expect(form.locator('[name=email]')).toHaveValue('');
  await form.locator('[name=email]').fill('another@example.invalid');await form.locator('[name=password]').fill('Synthetic-password-123');await box.check();await form.locator('[type=submit]').click();
  await expect.poll(()=>f.requests.length).toBe(2);expect(f.requests[1].body).toMatchObject({minimaxConsent:true,locale});expect(f.errors).toEqual([]);
 });
 test(`MiniMax ${locale} shared generation first-use decline grant persistence and stale 403`,async({page})=>{
  const f=await setup(page,locale);await f.harness();
  const submit=()=>page.evaluate(async()=>{window.generationResult=null;const {apiAiGenerateMusic}=await import('/js/shared/auth-api.js?v=__ASSET_VERSION__');void apiAiGenerateMusic({prompt:'Synthetic track'}).then(r=>window.generationResult=r);});
  await submit();const dialog=page.locator('[data-minimax-consent-dialog]');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:locale==='de'?'Nicht jetzt':'Not now',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.generationResult?.code)).toBe('consent_required');expect(f.requests).toEqual([]);
  await submit();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:locale==='de'?'Einwilligen':'Consent',exact:true}).click();
  await expect.poll(()=>f.requests.length).toBe(2);expect(f.requests.map(x=>x.path)).toEqual(['/api/account/minimax-consent','/api/ai/generate-music']);expect(f.requests[0].body.source).toBe('first_use');
  await submit();await expect.poll(()=>f.requests.length).toBe(3);await expect(dialog).toHaveCount(0);
  f.stale();await submit();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:locale==='de'?'Einwilligen':'Consent',exact:true}).click();await expect.poll(()=>f.requests.length).toBe(6);expect(f.errors).toEqual([]);
 });
 test(`MiniMax ${locale} one-click withdrawal and dialog-only regrant settings`,async({page})=>{
  const f=await setup(page,locale,{granted:true});await f.harness();await page.evaluate(async()=>{const m=await import('/js/shared/minimax-consent-ui.js?v=__ASSET_VERSION__');m.mountMinimaxSettings(document.getElementById('minimax-consent'));});
  const toggle=page.locator('#minimaxConsentToggle');await expect(toggle).toBeChecked();await toggle.click();await expect.poll(()=>f.requests.length).toBe(1);expect(f.requests[0].path).toBe('/api/account/minimax-consent/revoke');await expect(toggle).not.toBeChecked();
  await toggle.click();const dialog=page.locator('[data-minimax-consent-dialog]');await expect(dialog).toBeVisible();expect(f.requests.length).toBe(1);await dialog.getByRole('button',{name:locale==='de'?'Nicht jetzt':'Not now',exact:true}).click();await expect(toggle).not.toBeChecked();
  await toggle.click();await dialog.getByRole('button',{name:locale==='de'?'Einwilligen':'Consent',exact:true}).click();await expect(toggle).toBeChecked();expect(f.requests[1].body.source).toBe('settings');await expect(page.locator('#minimax-consent [role=status]')).toContainText(locale==='de'?'Sie haben erneut':'You consented again');expect(f.errors).toEqual([]);
 });
 test(`MiniMax ${locale} H3 reference assurance is unchecked and required for each added file`,async({page})=>{
  const f=await setup(page,locale);await f.harness();await page.evaluate(async locale=>{
   const {createH3ReferenceControls}=await import('/js/shared/h3-reference-controls.js?v=__ASSET_VERSION__');window.references=[];window.picks=0;
   const c=createH3ReferenceControls({anchor:document.getElementById('anchor'),de:locale==='de',read:()=>window.references,write:v=>window.references=v,changed(){},pick:({onApply})=>{window.picks++;onApply([{id:'a'.repeat(32),title:'Synthetic image'}]);}});c.sync(true,false,'minimax/h3');
  },locale);
  const box=page.locator('[data-minimax-reference-assurance]'),add=page.getByRole('button',{name:locale==='de'?'Gespeichertes Medium auswählen':'Choose saved media'});await expect(box).not.toBeChecked();await add.click();expect(await page.evaluate(()=>window.picks)).toBe(0);await box.check();await add.click();expect(await page.evaluate(()=>window.references.length)).toBe(1);await expect(box).not.toBeChecked();await add.click();expect(await page.evaluate(()=>window.picks)).toBe(1);expect(f.errors).toEqual([]);
 });
 test(`MiniMax ${locale} actual Generate Lab blocks request until dialog consent`,async({page})=>{
  const f=await setup(page,locale);await page.goto(`/${locale==='de'?'de/':''}generate-lab/`);await page.locator('[data-media-type="music"]').click();await page.locator('#labPrompt').fill('Synthetic consent track');await page.locator('#labGenerate').click();
  const dialog=page.locator('[data-minimax-consent-dialog]');await expect(dialog).toBeVisible();expect(f.requests).toEqual([]);await expect(page.locator('[data-minimax-consent-notice]')).toBeVisible();await dialog.getByRole('button',{name:locale==='de'?'Nicht jetzt':'Not now',exact:true}).click();expect(f.requests).toEqual([]);
  // Declining optional consent must not invalidate the authenticated session.
  await page.locator('#labGenerate').click();await expect(dialog).toBeVisible();await expect(page.locator('#authModal')).not.toBeVisible();
  await dialog.getByRole('button',{name:locale==='de'?'Einwilligen':'Consent',exact:true}).click();await expect.poll(()=>f.requests.length).toBe(2);
  await expect(page.locator('[data-minimax-consent-notice] a')).toHaveAttribute('href',locale==='de'?'/de/account/profile-settings.html#minimax-consent':'/account/profile-settings.html#minimax-consent');expect(f.errors).toEqual([]);
 });
 test(`MiniMax ${locale} stale displayed consent requires reload without undisplayed grant`,async({page})=>{
  const f=await setup(page,locale);await f.harness();let grants=0;
  await page.route('**/api/account/minimax-consent',route=>{if(route.request().method()==='POST'){grants++;return route.fulfill({status:409,json:{ok:false,code:'consent_text_changed'}});}return route.fulfill({json:{ok:true,consent:{granted:false}}});});
  await page.evaluate(async()=>{const {showMinimaxConsentDialog}=await import('/js/shared/minimax-consent-ui.js?v=__ASSET_VERSION__');void showMinimaxConsentDialog();});
  const dialog=page.locator('[data-minimax-consent-dialog]');await dialog.getByRole('button',{name:locale==='de'?'Einwilligen':'Consent',exact:true}).click();
  const reload=dialog.getByRole('button',{name:locale==='de'?'Seite neu laden':'Reload page',exact:true});await expect(reload).toBeVisible();expect(grants).toBe(1);
  await reload.click();await expect(dialog).toHaveCount(0);expect(grants).toBe(1);expect(f.requests).toEqual([]);expect(f.errors).toEqual([]);
 });
 test(`MiniMax ${locale} actual Sound Lab blocks request until dialog consent`,async({page})=>{
  const f=await setup(page,locale);await page.goto(locale==='de'?'/de/#soundlab':'/#soundlab');await page.locator('#soundLabCreateTab').click();await page.locator('#soundMusicPrompt').fill('Synthetic consent track');await page.locator('#soundMusicGenerate').click();
  const dialog=page.locator('[data-minimax-consent-dialog]');await expect(dialog).toBeVisible();expect(f.requests).toEqual([]);await dialog.getByRole('button',{name:locale==='de'?'Nicht jetzt':'Not now',exact:true}).click();expect(f.requests).toEqual([]);expect(f.errors).toEqual([]);
 });

}
