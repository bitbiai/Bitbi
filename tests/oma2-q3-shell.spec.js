const { test, expect } = require('@playwright/test');
const admin = { id:'q3-admin', email:'operator@example.test', role:'admin' };
function deferred() { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; }
async function fixture(page, baseURL, handler = () => null, gate = 200) {
  const unexpected = [], requests=[];
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); requests.push(url.pathname);
    if (url.origin !== origin) { unexpected.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let response = await handler(request,url);
    if (!response) {
      const defaults = {
        '/api/admin/me':{ok:gate===200,user:admin}, '/api/me':{loggedIn:true,user:admin},
        '/api/admin/stats':{ok:true,stats:{totalUsers:27,activeUsers:25,admins:2,verifiedUsers:26,disabledUsers:2,recentRegistrations:3}},
        '/api/admin/billing/events':{ok:true,events:[]}, '/api/admin/ai/usage-attempts':{ok:true,attempts:[]}, '/api/admin/data-lifecycle/requests':{ok:true,requests:[]},
        '/api/admin/users':{ok:true,users:[{id:'q3-user',email:'artist@example.test',role:'user',is_disabled:0}],has_more:false},
        '/api/admin/registration/status':{ok:true,registration:{enabled:true}}, '/api/admin/avatars/latest':{ok:true,avatars:[]},
        '/api/admin/r2/buckets':{ok:true,data:{buckets:[{id:'USER_IMAGES',name:'Images'}]}}, '/api/admin/r2/objects':{ok:true,data:{folders:[],objects:[{type:'object',key:'synthetic.txt',name:'synthetic.txt',size:10,contentType:'text/plain'}] }},
      };
      if (request.method() !== 'GET') unexpected.push(request.method()+' '+url.pathname);
      response = {status:url.pathname==='/api/admin/me'?gate:200,body:defaults[url.pathname]||{ok:true}};
    }
    await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)});
  });
  await page.addInitScript(() => { localStorage.setItem('bitbi_cookie_consent',JSON.stringify({v:'1',ts:Date.now(),necessary:true,analytics:false,marketing:false})); });
  return {unexpected,requests};
}
async function ready(page, section) { await expect(page.locator('#'+section)).toHaveAttribute('data-load-state','ready'); }
async function go(page, section) { await page.evaluate(s=>location.hash=s,section); }
for (const viewport of [{width:1440,height:900},{width:390,height:844}]) test.describe(`Q3 workspace ${viewport.width}px`,()=>{
  test.use({viewport});
  test('workspace loads real tasks after gating, with deferred domains and real account destinations',async({page,baseURL})=>{
    const state=await fixture(page,baseURL);
    await page.goto('/admin/index.html'); await ready(page,'sectionDashboard');
    await expect(page.getByRole('heading',{name:'Workspace',exact:true})).toBeVisible();
    await expect(page.locator('#adminOwnerActionSummary a')).toHaveCount(6);
    await expect(page.locator('#statTotal')).toHaveText('27');
    expect(state.requests.some(p=>/\/(ai-lab|fable-data-center|homepage-hero-videos|news-feed-agent)\.js$/.test(p))).toBe(false);
    expect(state.requests.some(p=>/\/control-plane\/(billing|ai-budget|object-storage|tenant-assets|lifecycle)\.js$/.test(p))).toBe(false);
    expect(state.requests.filter(p=>p==='/api/admin/billing/live-readiness/status')).toHaveLength(0);
    await expect(page.locator('#adminCapabilityDetails')).not.toHaveAttribute('open','');
    await page.route('**/account/credits.html',route=>route.fulfill({contentType:'text/html',body:'<h1>Account credits target</h1>'}));
    await page.locator('.admin-account-shortcuts a[data-nav="credits"]').click();
    await expect(page).toHaveURL(/\/account\/credits\.html$/);
    await expect(page.getByRole('heading',{name:'Account credits target'})).toBeVisible();
    expect(state.unexpected).toEqual([]);
  });
  test('failed admin gate never imports optional product domains',async({page,baseURL})=>{
    const state=await fixture(page,baseURL,()=>null,403);
    await page.goto('/admin/index.html#ai-lab'); await expect(page.locator('#adminDenied')).toBeVisible();
    await expect(page.locator('#adminPanel')).not.toBeVisible();
    expect(state.requests.some(p=>p.endsWith('/ai-lab.js'))).toBe(false);
    expect(state.unexpected).toEqual([]);
  });
  test('late optional module A does not initialize or focus after B is current',async({page,baseURL})=>{
    const state=await fixture(page,baseURL); const started=deferred(), finish=deferred();
    await page.route('**/news-feed-agent.js*',async route=>{started.resolve();await finish.promise;await route.continue();});
    await page.goto('/admin/index.html'); await ready(page,'sectionDashboard');
    await go(page,'news-feed-agent'); await started.promise;
    await go(page,'object-storage'); await ready(page,'sectionObjectStorage');
    await page.locator('#objectStorageRefreshBtn').focus();
    const completion=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/news-feed-agent.js'));
    finish.resolve();await completion;
    await expect(page.locator('#adminHeroTitle')).toHaveText('R2 Object Storage');
    await expect(page.locator('#objectStorageRefreshBtn')).toBeFocused();
    expect(state.requests.filter(p=>p.startsWith('/api/admin/news-pulse/'))).toHaveLength(0);
    expect(state.unexpected).toEqual([]);
  });
  test('optional import failure stays local and has an honest recovery route',async({page,baseURL})=>{
    const state=await fixture(page,baseURL);let attempts=0;
    await page.route('**/control-plane/object-storage.js*',route=>++attempts===1?route.abort('failed'):route.continue());
    await page.goto('/admin/index.html#object-storage');
    await expect(page.locator('#adminSectionState')).toContainText('could not be loaded');
    await page.locator('#adminSectionState button').click();
    await ready(page,'sectionObjectStorage');
    await expect(page.locator('#objectStorageTable')).toContainText('synthetic.txt');
    expect(attempts).toBe(2);expect(state.unexpected).toEqual([]);
  });
  test('unknown routes do not silently become dashboard; back and forward restore sections',async({page,baseURL})=>{
    await fixture(page,baseURL);await page.goto('/admin/index.html');await ready(page,'sectionDashboard');
    await go(page,'unknown-q3-destination');await expect(page.locator('#adminSectionState')).toContainText('Unknown admin destination');
    await expect(page.locator('#sectionDashboard')).not.toBeVisible();
    await page.goBack();await ready(page,'sectionDashboard');
    await page.goForward();await expect(page.locator('#adminHeroTitle')).toHaveText('Section unavailable');
  });
  test('Fable import failure does not disable AI Lab, and its direct target can recover',async({page,baseURL})=>{
    await fixture(page,baseURL);let imports=0;
    await page.route('**/fable-data-center.js*',route=>++imports===1?route.abort('failed'):route.continue());
    await page.goto('/admin/index.html#fable-data-center');
    await ready(page,'sectionAiLab');
    await expect(page.locator('[data-fable-load-error]')).toContainText('AI Lab remains available');
    await expect(page.locator('#adminNav a[data-section="fable-data-center"]')).toHaveAttribute('aria-current','page');
    await expect(page.locator('#sectionAiLab [data-ai-mode="text"]')).toBeEnabled();
    await page.getByRole('button',{name:'Retry Fable data',exact:true}).click();
    await expect(page.locator('[data-fable-load-error]')).toHaveCount(0);
    await expect(page.locator('#fableDataWorkspace')).toBeVisible();
    expect(imports).toBe(2);
  });
  test('AI list refresh interrupted by navigation resumes a read without redispatch',async({page,baseURL})=>{
    const held=deferred(),start=deferred();let reads=0;
    const state=await fixture(page,baseURL,async(req,url)=>{
      if(url.pathname==='/api/admin/ai/usage-attempts') {
        if(++reads===2){start.resolve();await held.promise;}
        return {status:200,body:{ok:true,attempts:[{attemptId:'q3-attempt',status:'unknown',feature:'ai.text.generate',createdAt:'2026-09-06T10:00:00Z'}]}};
      }
    });
    await page.goto('/admin/index.html#ai-usage');await ready(page,'sectionAiUsage');
    await page.locator('#aiAttemptsRefresh').click();await start.promise;
    await go(page,'users');await ready(page,'sectionUsers');
    await go(page,'ai-usage');await ready(page,'sectionAiUsage');
    await expect(page.locator('#aiAttemptsList')).toContainText('unknown');
    held.resolve();expect(reads).toBe(3);expect(state.unexpected).toEqual([]);
  });
  test('navigation, focus and narrow reflow remain usable without motion',async({page,baseURL})=>{
    await page.emulateMedia({reducedMotion:'reduce'});await fixture(page,baseURL);
    await page.goto('/admin/index.html');await ready(page,'sectionDashboard');
    if(viewport.width<900){await page.locator('#adminNavToggle').press('Enter');await expect(page.locator('#adminNavToggle')).toHaveAttribute('aria-expanded','true');}
    const link=page.locator('#adminNav a[data-section="users"]');await link.focus();await link.press('Enter');await ready(page,'sectionUsers');
    await expect(page.locator('#adminHeroTitle')).toBeFocused();
    await expect(link).toHaveAttribute('aria-current','page');
    if(viewport.width<900){await page.locator('#adminNavToggle').press('Enter');await link.focus();await link.press('Escape');await expect(page.locator('#adminNavToggle')).toBeFocused();}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(await page.locator('#adminHeroTitle').evaluate(el=>getComputedStyle(el).color)).not.toBe('rgba(0, 0, 0, 0)');
  });
  test('auth actor change discards cached private content and fences late loads',async({page,baseURL})=>{
    await fixture(page,baseURL);await page.goto('/admin/index.html#users');await ready(page,'sectionUsers');
    await expect(page.locator('#sectionUsers')).toContainText('artist@example.test');
    if(viewport.width<600)await page.locator('.admin-mobile-card__header').click();
    await page.locator('#sectionUsers').getByRole('button',{name:'Info',exact:true}).filter({visible:true}).click();
    await expect(page.locator('#userInfoModalBody')).toContainText('artist@example.test');
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{ready:true,loggedIn:true,user:{id:'another-admin',role:'admin'}}})));
    await expect(page.locator('#adminDenied')).toBeVisible();
    await expect(page.locator('#adminPanel')).toBeEmpty();
    await expect(page.locator('#userInfoModalBody')).toBeEmpty();
    await expect(page.locator('#userInfoModal')).toBeHidden();
    await go(page,'dashboard');await expect(page.locator('#adminPanel')).not.toBeVisible();
  });
});

for (const scenario of ['leave-return', 'logout']) test(`dashboard pending reads and failures belong to their view: ${scenario}`, async ({ page, baseURL }) => {
  const statsStarted=deferred(), statsEnd=deferred(), sampleStarted=deferred(), sampleEnd=deferred();
  let statsReads=0, sampleReads=0;
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const state=await fixture(page,baseURL,async(req,url)=>{
    if(url.pathname==='/api/admin/stats' && ++statsReads===1){statsStarted.resolve();await statsEnd.promise;return {status:503,body:{ok:false,error:'Old view stats error'}};}
    if(url.pathname==='/api/admin/billing/events' && ++sampleReads===1){sampleStarted.resolve();await sampleEnd.promise;return {status:200,body:{ok:true,events:[{id:'old-event',processingStatus:'failed'}]}};}
  });
  await page.goto('/admin/index.html');await Promise.all([statsStarted.promise,sampleStarted.promise]);
  if(scenario==='logout'){
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{ready:true,loggedIn:false,user:null}})));
    await expect(page.locator('#adminDenied')).toBeVisible();
  }else{
    await go(page,'users');await ready(page,'sectionUsers');
    await go(page,'dashboard');await ready(page,'sectionDashboard');
    await expect(page.locator('#statTotal')).toHaveText('27');
  }
  const response=page.waitForResponse(r=>r.url().includes('/api/admin/billing/events')&&r.status()===200);
  statsEnd.resolve();sampleEnd.resolve();await response;
  // Flush response callbacks, then verify the new owner rather than accepting an old toast.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  if(scenario==='logout')await expect(page.locator('#adminPanel')).toBeEmpty();
  else{await expect(page.locator('#statTotal')).toHaveText('27');await expect(page.locator('#adminAttention')).not.toContainText('A sampled record needs review: failed');}
  await expect(page.locator('#adminToast')).toBeEmpty();expect(errors).toEqual([]);expect(state.unexpected).toEqual([]);
});

test('late capability probe after leaving cannot publish availability in a new view',async({page,baseURL})=>{
  const started=deferred(),finish=deferred();let planReads=0;
  await fixture(page,baseURL,async(req,url)=>{
    if(url.pathname==='/api/admin/billing/plans' && ++planReads===1){started.resolve();await finish.promise;return {status:200,body:{ok:true,plans:[]}};}
  });
  await page.goto('/admin/index.html');await ready(page,'sectionDashboard');
  await page.locator('#adminCapabilityDetails > summary').click();await page.locator('#adminCapabilitiesRefresh').click();await started.promise;
  await go(page,'users');await ready(page,'sectionUsers');await go(page,'dashboard');await ready(page,'sectionDashboard');
  await expect(page.locator('#adminCapabilitiesState')).toContainText('previous check was left');
  const response=page.waitForResponse(r=>r.url().includes('/api/admin/billing/plans'));finish.resolve();await response;
  await expect(page.locator('#adminCapabilitiesState')).not.toContainText('API responses observed');
  await page.locator('#adminCapabilitiesRefresh').click();await expect(page.locator('#adminCapabilitiesState')).toContainText('API responses observed');
  expect(planReads).toBe(2);
});

for (const nextUser of [null, {id:'different-admin',role:'admin'}]) test(`auth loss cancels an unsubmitted user deletion: ${nextUser?'actor switch':'logout'}`,async({page,baseURL})=>{
  const state=await fixture(page,baseURL);await page.goto('/admin/index.html#users');await ready(page,'sectionUsers');
  await page.locator('#userTbody').getByRole('button',{name:'Delete',exact:true}).click();
  const dialog=page.locator('[data-testid="admin-delete-user-dialog"]');await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('artist@example.test');await page.locator('[data-testid="admin-delete-confirm-input"]').fill('artist@example.test');
  await expect(page.locator('[data-testid="admin-delete-submit"]')).toBeEnabled();
  await page.evaluate(user=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{ready:true,loggedIn:!!user,user}})),nextUser);
  await expect(dialog).toHaveCount(0);await expect(page.locator('#adminDenied')).toBeVisible();
  await expect(page.locator('#adminPanel')).toBeEmpty();expect(state.unexpected).toEqual([]);
});
