const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const original = fs.readFileSync(path.join(__dirname, 'fixtures/media/detail-original.mp4'));
const poster = fs.readFileSync(path.join(__dirname, 'fixtures/media/member-video-poster.webp'));
const png = fs.readFileSync(path.join(__dirname, 'fixtures/media/member-image.png'));
const file = '/api/gallery/memvids/abcdef/v1/file';

async function fixture(page, {language='en', comments=[], denied=false}={}) {
  const reads=[];
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({v:'1',ts:Date.now(),necessary:true,analytics:false,marketing:false})));
  await page.route('**/api/**', async route => {
    const req=route.request(), url=new URL(req.url());
    reads.push({path:url.pathname,method:req.method()});
    if(url.pathname.endsWith('/poster'))return route.fulfill({contentType:'image/webp',body:poster});
    if(url.pathname===file)return route.fulfill(denied === 'html' ? {status:200,contentType:'text/html',body:'<h1>Not a video</h1>'} : denied ? {status:403,json:{ok:false}} : {contentType:'video/mp4',body:original});
    if(url.pathname.includes('/mempics/') && /\/(file|thumb|medium)$/.test(url.pathname))return route.fulfill({contentType:'image/png',body:png});
    let body={ok:true,data:{items:[],comments,count:comments.length}};
    if(url.pathname==='/api/me')body={loggedIn:false,user:null};
    if(url.pathname==='/api/gallery/memvids')body={ok:true,data:{items:[{id:'abcdef',title:'Original sample.mp4',mime_type:'video/mp4',size_bytes:original.length,
      file:{url:file},poster:{url:'/api/gallery/memvids/abcdef/v1/poster',w:320,h:180},width:1920,height:1080, // untrusted requested dimensions
      publisher:{display_name:'Test member'},comment_count:comments.length}]}};
    if(url.pathname==='/api/gallery/mempics')body={ok:true,data:{items:[{id:'fedcba',title:'Original image',publisher:{display_name:'Test member'},full:{url:'/api/gallery/mempics/fedcba/v1/file'},preview:{url:'/api/gallery/mempics/fedcba/v1/medium',w:1600,h:1200},thumb:{url:'/api/gallery/mempics/fedcba/v1/thumb',w:320,h:320}}]}};
    return route.fulfill({json:body});
  });
  await page.goto(language==='de'?'/de/':'/');
  return reads;
}
async function openVideo(page, mobile=false) {
  if(mobile || !await page.locator('#navbar [data-category-link="video"]').isVisible())await page.locator('#video-creations').scrollIntoViewIfNeeded();
  else await page.locator('#navbar [data-category-link="video"]').click();
  await page.locator('#videoGrid .video-card').first().click();
  const dialog=page.locator(mobile?'.mobile-media-detail-overlay--video':'#videoModal.active');
  await expect(dialog).toBeVisible();
  return dialog;
}
async function assertFits(dialog, mobile) {
  const metrics=await dialog.evaluate((el,mobile)=>{
    const card=el.querySelector(mobile?'.mobile-media-detail-overlay__shell':'.modal-card');
    const player=el.querySelector('video'), r=player.getBoundingClientRect(), c=card.getBoundingClientRect();
    const scrollers=[...el.querySelectorAll('*')].filter(n=>['auto','scroll'].includes(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+2);
    return {width:c.width,viewport:innerWidth,height:c.height,viewportHeight:innerHeight,overflow:card.scrollWidth-card.clientWidth,
      videoWidth:r.width,videoHeight:r.height,scrollers:scrollers.map(n=>n.className),background:getComputedStyle(document.body).overflow};
  },mobile);
  expect(metrics,JSON.stringify(metrics)).toMatchObject({background:'hidden'});
  expect(metrics.overflow).toBeLessThanOrEqual(1);
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.scrollers.length).toBeLessThanOrEqual(1);
  if(!mobile)expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight);
  return metrics;
}
for(const language of ['en','de'])for(const mobile of [false,true]) {
  test(`${language} ${mobile?'touch':'desktop'} public media dialog uses original dimensions/download and distinct controls`,async({browser},testInfo)=>{
    const context=await browser.newContext({viewport:mobile?{width:390,height:640}:{width:1440,height:900},hasTouch:mobile});
    const page=await context.newPage();
    const reads=await fixture(page,{language});
    const dialog=await openVideo(page,mobile);
    const video=dialog.locator('video');
    await expect.poll(()=>video.evaluate(v=>[v.videoWidth,v.videoHeight])).toEqual([640,360]);
    await expect(dialog.locator('dl')).toContainText('640 × 360');
    await expect(dialog.locator('dl')).not.toContainText('320 × 180');
    await expect(dialog.locator('dl')).not.toContainText('1920 × 1080');
    const metrics=await assertFits(dialog,mobile);
    expect(metrics.videoWidth/metrics.videoHeight).toBeCloseTo(640/360,1);
    if(!mobile) {
      expect(metrics.height).toBeLessThan(650); // content, not the previous fixed 828px dialog
      const buttons=await dialog.locator('.modal-action').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,height:r.height,bottom:r.bottom};}));
      expect(buttons[0].right+7).toBeLessThanOrEqual(buttons[1].x);
      const playerBox=await video.boundingBox();
      for(const b of buttons)expect(b.bottom).toBeLessThanOrEqual(playerBox.y); // includes native WebKit fullscreen/PiP space
      for(const b of buttons){expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);}
      const popupPromise=page.waitForEvent('popup');
      await dialog.locator('.video-modal__full-link').click();
      const popup=await popupPromise;expect(popup.url()).toContain(file);await popup.close();
    }
    // Actual native controls remain attached; pause/play retains the original source.
    await expect(video).toHaveJSProperty('controls',true);
    await video.evaluate(v=>v.pause());await expect(video).toHaveJSProperty('paused',true);
    await video.evaluate(v=>v.play());await expect(video).toHaveJSProperty('paused',false);
    await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(0);
    const menu=dialog.locator('.public-media-detail__menu-button');
    if(mobile)await menu.tap();else {await menu.focus();await page.keyboard.press('Enter');}
    const download=page.waitForEvent('download');
    await dialog.getByRole('button',{name:language==='de'?'Herunterladen':'Download',exact:true}).click();
    const result=await download;
    expect(result.suggestedFilename()).toBe('Original sample.mp4');
    expect(fs.readFileSync(await result.path())).toEqual(original);
    await expect(dialog).toBeVisible();
    await menu.click();await page.keyboard.press('Escape');await expect(menu).toBeFocused();await expect(menu).toHaveAttribute('aria-expanded','false');
    await menu.click();await page.screenshot({path:testInfo.outputPath(`${language}-${mobile?'mobile':'desktop'}.png`)});
    const close=dialog.locator(mobile?'.mobile-media-detail-overlay__close':'.video-modal-close');
    if(mobile)await close.tap();else {await close.focus();await page.keyboard.press('Enter');}
    await expect(dialog).toHaveCount(0);
    expect(reads.filter(r=>r.method!=='GET')).toEqual([]);
    await context.close();
  });
}
for(const [label,comments] of [['none',[]],['short',[{body:'A short comment'}]],['long',Array.from({length:12},(_,i)=>({body:i===0?'Long comment '.repeat(70):`Comment ${i}`}))]]) {
  test(`public media dialog ${label} comments scroll only when needed and tabs contract`,async({page},testInfo)=>{
    await page.setViewportSize({width:1440,height:760});
    await fixture(page,{comments:comments.map((c,i)=>({...c,id:String(i),author:{display_name:'Test member'},created_at:'2026-09-13T09:00:00Z'}))});
    let dialog=await openVideo(page);
    await expect(dialog.locator('dl')).toContainText('640 × 360');
    const before=await assertFits(dialog,false);
    await dialog.getByRole('tab',{name:/Comments/}).click();
    await expect(dialog.locator('.public-media-comments__item')).toHaveCount(comments.length);
    await expect(dialog.locator('.public-media-comments__status')).toHaveText(comments.length?'':'No comments yet');
    const after=await assertFits(dialog,false);
    expect(after.scrollers.length).toBe(comments.length>2?1:0);
    if(comments.length<2)expect(after.height).toBeLessThan(600);
    await dialog.getByRole('tab',{name:'Details',exact:true}).click();
    expect((await assertFits(dialog,false)).height).toBeCloseTo(before.height,0);
    await dialog.locator('.video-modal-close').click();
    await page.setViewportSize({width:390,height:480});
    dialog=await openVideo(page,true);
    await dialog.getByRole('tab',{name:/Comments/}).click();
    await expect(dialog.locator('.public-media-comments__item')).toHaveCount(comments.length);
    // A late, unrelated inline unlock must not release an open public dialog.
    await page.evaluate(()=>{document.body.style.overflow='';});
    await assertFits(dialog,true);
    const backgroundY=await page.evaluate(()=>scrollY);
    await dialog.locator('.public-media-comments__auth-hint').scrollIntoViewIfNeeded();
    await expect(dialog.locator('.mobile-media-detail-overlay__close')).toBeInViewport();
    expect(await page.evaluate(()=>scrollY)).toBe(backgroundY);
    await page.screenshot({path:testInfo.outputPath(`comments-${label}-mobile.png`)});
    await dialog.locator('.mobile-media-detail-overlay__close').click();
  });
}
for(const denied of [true,'html'])test(`public media dialog rejects ${denied === true ? 'inaccessible original' : 'HTML response'} without substituting poster or requested dimensions`,async({page})=>{
  await fixture(page,{language:'de',denied});
  const dialog=await openVideo(page);
  await expect(dialog.locator('dl')).toContainText('Nicht verfügbar');
  let downloaded=false;page.on('download',()=>{downloaded=true;});
  await dialog.locator('.public-media-detail__menu-button').click();
  await dialog.getByRole('button',{name:'Herunterladen',exact:true}).click();
  await expect(dialog.locator('.public-media-detail__interaction-status')).toContainText('Originaldatei ist nicht verfügbar');
  expect(downloaded).toBe(false);
});
test('public media dialog image original download does not label preview dimensions as original',async({page})=>{
  await fixture(page);
  await page.locator('#navbar [data-category-link="gallery"]').click();
  await page.locator('#galleryGrid .gallery-item:not(.locked-area)').first().click();
  const dialog=page.locator('#galleryModal.active');
  await expect(dialog.locator('dl')).not.toContainText('1600 × 1200');
  await dialog.locator('.public-media-detail__menu-button').click();
  const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();
  const result=await pending;expect(result.suggestedFilename()).toBe('Original image.png');expect(fs.readFileSync(await result.path())).toEqual(png);
});

test('public media dialog tablet keeps the current original and close action in the viewport',async({browser})=>{
  const context=await browser.newContext({viewport:{width:820,height:1024},hasTouch:true});
  const page=await context.newPage();await fixture(page,{language:'de'});
  const dialog=await openVideo(page);
  await expect(dialog.locator('dl')).toContainText('640 × 360');
  await assertFits(dialog,false);
  await expect(dialog.locator('.video-modal-close')).toBeInViewport();
  await dialog.locator('.video-modal-close').tap();await context.close();
});
