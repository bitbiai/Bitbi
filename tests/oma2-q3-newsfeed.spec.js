const { test, expect } = require('@playwright/test');
const admin = { id:'reader-admin', role:'admin', email:'reader@example.test' };
const item = (id, extra = {}) => ({ id, title:'A new chapter for creative tools', summary:'Researchers explore how small, local models can support a more thoughtful creative process.', source:'Research journal', category:'Research', locale:'en', status:'active', published_at:'2026-09-09T12:00:00Z', created_at:'2026-09-08T11:00:00Z', updated_at:'2026-09-09T10:00:00Z', expires_at:null, expired:false, visual_type:'generated', visual_status:'ready', admin_thumb_url:`/api/admin/news-pulse/thumbs/${id}`, visual_generated_at:'2026-09-09T11:00:00Z', visual_attempts:1, ...extra });
const sampleImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
function deferred() { let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve}; }
async function setup(page, baseURL, options = {}) {
  const calls = [], errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({v:'1',ts:Date.now(),necessary:true,analytics:false,marketing:false})));
  await page.context().route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if (u.origin!==new URL(baseURL).origin) return route.abort();
    if (!u.pathname.startsWith('/api/')) return route.continue();
    calls.push({path:u.pathname,query:u.search,method:req.method()});
    const custom=await options.handle?.(req,u);
    if (custom) return route.fulfill(custom);
    const user=options.user===undefined?admin:options.user;
    if (u.pathname.startsWith('/api/admin/news-pulse/thumbs/')) return route.fulfill({contentType:'image/png',body:sampleImage,headers:{'cache-control':'private, no-store'}});
    const defaults={
      '/api/me':{loggedIn:!!user,user}, '/api/admin/me': options.gate ? {ok:false,error:'Admin access required',code:options.gate===428?'ADMIN_MFA_REQUIRED':'forbidden'} : {ok:true,user},
      '/api/admin/stats':{ok:true,stats:{totalUsers:4}},
      '/api/admin/news-pulse/items':{ok:true,data:{items:[item('a')],schema_available:true,has_more:false,next_cursor:null}},
      '/api/public/news-pulse':{enabled:false,items:[]},
    };
    let body=defaults[u.pathname]||{ok:true};
    if (/\/api\/admin\/news-pulse\/items\//.test(u.pathname)) body={ok:true,data:{item:item(decodeURIComponent(u.pathname.split('/').pop()),{visual_prompt_present:true})}};
    await route.fulfill({status:u.pathname==='/api/admin/me'?(options.gate||200):200,contentType:'application/json',body:JSON.stringify(body)});
  });
  return {calls,errors};
}
const json = (data,status=200) => ({status,contentType:'application/json',body:JSON.stringify(data)});
const open = async page => { await page.goto('/admin/index.html#newsfeed'); await expect(page.locator('#sectionNewsfeed')).toHaveAttribute('data-load-state','ready'); };
const cards = page => page.locator('.admin-reader__card');
function readOnly(e) { expect(e.calls.every(c=>c.method==='GET')).toBe(true); expect(e.errors).toEqual([]); }

test('lazy admin entry, direct reload, back/forward and existing management view stay distinct',async({page,baseURL})=>{
  const e=await setup(page,baseURL);
  await page.goto('/admin/index.html'); await expect(page.locator('#sectionDashboard')).toHaveAttribute('data-load-state','ready');
  expect(e.calls.filter(c=>c.path.startsWith('/api/admin/news-pulse/'))).toEqual([]);
  await page.getByRole('link',{name:'Newsfeed',exact:true}).click(); await expect(cards(page)).toHaveCount(1);
  await page.reload();await expect(cards(page)).toHaveCount(1);
  await page.evaluate(()=>location.hash='dashboard');await expect(cards(page)).toHaveCount(0);
  await page.goBack();await expect(cards(page)).toHaveCount(1);
  await expect(page.getByRole('link',{name:'News Feed Agent',exact:true})).toHaveAttribute('href','#news-feed-agent');
  expect(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('creative tools')))).toBe(false);
  readOnly(e);
});
for (const [name,user,gate] of [['guest',null,401],['member',{id:'member',role:'user'},403],['admin awaiting MFA',admin,428]]) test(`${name} cannot load the reader`,async({page,baseURL})=>{
  const e=await setup(page,baseURL,{user,gate});await page.goto('/admin/index.html#newsfeed');
  await expect(page.locator('#adminDenied')).toBeVisible();await expect(page.locator('#adminPanel')).not.toBeVisible();
  expect(e.calls.filter(c=>c.path.startsWith('/api/admin/news-pulse/items'))).toEqual([]);readOnly(e);
});

test('cards, protected image, provenance and safe text use only supplied identities',async({page,baseURL})=>{
  const e=await setup(page,baseURL);await open(page);
  await expect(cards(page).locator('img')).toHaveJSProperty('naturalWidth',1);
  await cards(page).getByText('Inspect article',{exact:true}).click();
  await expect(cards(page)).toContainText('Full article text and original/source image variants are not supplied');
  await cards(page).getByText('Image & provenance',{exact:true}).click();
  await expect(cards(page)).toContainText('Generated preview, as recorded by the API');
  await expect(cards(page)).toContainText('Yes (prompt text not supplied)');
  await expect(cards(page)).toContainText('2026-09-08 11:00:00 UTC');
  expect(e.calls.filter(c=>c.path.includes('/thumbs/')).every(c=>c.path==='/api/admin/news-pulse/thumbs/a')).toBe(true);readOnly(e);
});

test('pagination retries retain unique loaded cards; search is explicitly local',async({page,baseURL})=>{
  let second=0;
  const e=await setup(page,baseURL,{handle:(_req,u)=>{
    if(u.pathname!=='/api/admin/news-pulse/items')return;
    if(u.searchParams.get('cursor')) {
      if(++second===1)return json({ok:false},503);
      return json({ok:true,data:{items:[item('a'),item('b',{title:'Weitere Perspektiven',locale:'de'})],schema_available:true,has_more:false,next_cursor:null}});
    }
    return json({ok:true,data:{items:[item('a')],schema_available:true,has_more:true,next_cursor:'24'}});
  }});
  await open(page);await page.getByRole('button',{name:'Load more'}).click();await expect(page.getByRole('alert')).toContainText('More articles could not');
  await expect(cards(page)).toHaveCount(1);await page.getByRole('button',{name:'Load more'}).click();await expect(cards(page)).toHaveCount(2);
  await page.getByLabel('Search loaded articles').fill('Weitere');await expect(page.locator('.admin-reader__card:visible')).toHaveCount(1);
  await expect(page.locator('.admin-reader__info')).toContainText('1 shown · 2 loaded');
  expect(e.calls.filter(c=>c.path==='/api/admin/news-pulse/items')).toHaveLength(3);readOnly(e);
});

for (const [name,data,expected] of [
  ['empty',{items:[],schema_available:true},'No stored news matches'],
  ['unavailable',{items:[],schema_available:false},'News storage is unavailable'],
  ['malformed',{},'News could not be loaded'],
  ['partial',{items:[{title:'no id'},item('a',{title:'',summary:'',published_at:'not-a-date',admin_thumb_url:null})],schema_available:true},'Partial response'],
]) test(`${name} is not confused with another feed state`,async({page,baseURL})=>{
  const e=await setup(page,baseURL,{handle:(_r,u)=>u.pathname==='/api/admin/news-pulse/items'?json({ok:true,data}):null});await open(page);
  await expect(page.locator('#sectionNewsfeed')).toContainText(expected);
  if(name==='partial') {await expect(cards(page)).toContainText('Headline not provided');await expect(cards(page)).toContainText('Invalid supplied timestamp');await expect(cards(page)).toContainText('No image reference provided');}
  readOnly(e);
});

test('unsafe supplied URLs are never requested; failed images and detail errors have local recovery',async({page,baseURL})=>{
  let tries=0;
  const e=await setup(page,baseURL,{handle:(_r,u)=>{
    if(u.pathname==='/api/admin/news-pulse/items')return json({ok:true,data:{items:[item('a'),item('b',{title:'<img src=x onerror=alert(1)>',admin_thumb_url:'/api/admin/news-pulse/thumbs/a'})],has_more:false}});
    if(u.pathname.includes('/thumbs/'))return {status:404,body:''};
    if(u.pathname==='/api/admin/news-pulse/items/a')return ++tries===1?json({ok:false},503):json({ok:true,data:{item:item('a',{url:'javascript:alert(1)'})}});
  }});await open(page);await expect(cards(page).first()).toContainText('Image failed to load');await expect(cards(page).nth(1)).toContainText('cannot be verified');
  await expect(cards(page).nth(1).locator('h2 img')).toHaveCount(0);
  await cards(page).first().getByText('Inspect article',{exact:true}).click();await expect(cards(page).first()).toContainText('Details could not be loaded');
  await page.getByRole('button',{name:'Retry details'}).click();await expect(cards(page).first()).toContainText('Source link cannot be verified');readOnly(e);
});

test('late list cannot overwrite a different filter or survive leaving; confirmed logout clears data',async({page,baseURL})=>{
  const held=deferred(),started=deferred();let n=0;
  const e=await setup(page,baseURL,{handle:async(_r,u)=>{
    if(u.pathname==='/api/admin/news-pulse/items' && ++n===1){started.resolve();await held.promise;return json({ok:true,data:{items:[item('old')],has_more:false}});}
    if(u.pathname==='/api/admin/news-pulse/items')return json({ok:true,data:{items:[item('new',{locale:'de',title:'Aktueller Stand'})],has_more:false}});
  }});
  await page.goto('/admin/index.html#newsfeed');await started.promise;
  await expect(page.locator('.admin-reader__notice')).toContainText('Loading');
  await page.getByLabel('Language',{exact:true}).selectOption('de');await expect(cards(page)).toHaveAttribute('data-news-id','new');held.resolve();
  await expect(cards(page)).toHaveCount(1);
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{ready:true,loggedIn:false,sessionConfirmed:true,user:null}})));
  await expect(page.locator('#adminPanel')).not.toBeVisible();await expect(cards(page)).toHaveCount(0);readOnly(e);
});

test('expired authorization on refresh removes loaded records and image URLs',async({page,baseURL})=>{
  let n=0;
  const e=await setup(page,baseURL,{handle:(_r,u)=>u.pathname==='/api/admin/news-pulse/items'&&++n>1?json({ok:false,error:'Session expired'},401):null});
  await open(page);await expect(cards(page)).toHaveCount(1);await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('News access could not be authorized');await expect(cards(page)).toHaveCount(0);readOnly(e);
});

for(const width of [1440,390]) test(`reader is usable at ${width}px with native details and visible focus`,async({page,baseURL},testInfo)=>{
  await page.setViewportSize({width,height:960});
  const e=await setup(page,baseURL,{handle:(_r,u)=>{
    if(u.pathname.includes('/thumbs/')) return {contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#153743"/><circle cx="680" cy="240" r="175" fill="#66b1b5"/><path d="M0 540L260 160L520 540Z" fill="#d7bd85"/><path d="M300 540L600 280L960 540Z" fill="#233f55"/></svg>'};
    if(u.pathname==='/api/admin/news-pulse/items')return json({ok:true,data:{items:[item('a'),item('b',{title:'A quieter approach to the tools we use every day',source:'Studio notes'}),item('c',{title:'Eine neue Perspektive auf kreative Arbeit',locale:'de',admin_thumb_url:null})],has_more:false}});
  }});
  await open(page);await expect(cards(page)).toHaveCount(3);
  await page.getByLabel('Search loaded articles').focus();await expect(page.getByLabel('Search loaded articles')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`reader-${width}.png`),fullPage:true});
  const summary=cards(page).first().getByText('Inspect article',{exact:true});await summary.focus();await page.keyboard.press('Enter');
  await expect(cards(page).first()).toContainText('Only the stored summary');
  await page.screenshot({path:testInfo.outputPath(`reader-details-${width}.png`),fullPage:true});readOnly(e);
});

test('public disabled response remains hidden in EN and DE; no admin reads',async({page,baseURL})=>{
  const e=await setup(page,baseURL);
  for(const url of ['/','/de/']) {await page.goto(url);await expect(page.locator('[data-news-pulse]')).toHaveAttribute('aria-hidden','true');await expect(page.locator('[data-news-pulse]')).toHaveClass(/is-disabled/);await expect(page.locator('[data-news-pulse] > *')).toHaveCount(0);/* Desktop keeps an empty transparent layout box; no feed content is rendered. */}
  expect(e.calls.some(c=>c.path.startsWith('/api/admin/news-pulse/'))).toBe(false);
});

test('closed or mismatched detail responses never populate another record',async({page,baseURL})=>{
  const held=deferred(),started=deferred();
  const e=await setup(page,baseURL,{handle:async(_r,u)=>{
    if(u.pathname==='/api/admin/news-pulse/items')return json({ok:true,data:{items:[item('a'),item('b')],has_more:false}});
    if(u.pathname==='/api/admin/news-pulse/items/a'){started.resolve();await held.promise;return json({ok:true,data:{item:item('a',{visual_error:'Late A detail'})}});}
    if(u.pathname==='/api/admin/news-pulse/items/b')return json({ok:true,data:{item:item('foreign',{visual_error:'Foreign detail'})}});
  }});
  await open(page);await cards(page).first().getByText('Inspect article',{exact:true}).click();await started.promise;
  await cards(page).first().getByText('Inspect article',{exact:true}).click();
  await cards(page).nth(1).getByText('Inspect article',{exact:true}).click();held.resolve();
  await expect(cards(page).nth(1)).toContainText('Details could not be loaded');
  await expect(page.locator('#sectionNewsfeed')).not.toContainText('Foreign detail');await expect(page.locator('#sectionNewsfeed')).not.toContainText('Late A detail');readOnly(e);
});
