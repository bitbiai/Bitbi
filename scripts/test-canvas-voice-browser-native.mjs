import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {launchCanvasVoiceNativeChild} from '../tests/helpers/canvas-voice-native-launcher.mjs';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
assert.equal(process.platform,'darwin','This registered acceptance uses the Mac browser cache and sandbox-exec; use the separate native Linux suite there.');
assert.equal(Number(process.versions.node.split('.')[0]),22,'Use locked Node22');
assert(process.argv.length===2||process.argv.length===4&&process.argv[2]==='--artifacts','Usage: test-canvas-voice-browser-native [--artifacts <outside-repository-directory>]');
const supplied=process.argv[3]&&path.resolve(process.argv[3]);
// Only the synthetic aggregate is shared with the unprivileged Linux verifier;
// per-attempt reports and native runtime artifacts below remain private.
if(supplied)fs.mkdirSync(supplied,{recursive:true,mode:0o755});
const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'voice-browser-native-'));fs.chmodSync(artifacts,0o700);
const reports=supplied?fs.mkdtempSync(path.join(fs.realpathSync(supplied),'voice-browser-native-')):artifacts;
const staticRoot=fs.realpathSync(path.resolve(root,process.env.STATIC_TEST_ROOT||'.'));
const sourceSha=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();assert.match(sourceSha,/^[a-f0-9]{40}$/);
const {chromium,webkit,expect}=require('@playwright/test'),version=require('@playwright/test/package.json').version;
assert.equal(version,JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'))).packages['node_modules/@playwright/test'].version,'Browser runtime matches root lock');
const {runCanvasVoiceNativeBrowserJourney}=require('../tests/helpers/canvas-voice-native-browser.cjs'),records=[];
const served=[],unexpectedStatic=[];
const safeStatic=relative=>/^(?:js\/(?:shared|pages\/canvas)\/|css\/(?:base\/|pages\/canvas(?:-voice)?\.css$))/.test(relative)&&path.resolve(staticRoot,relative).startsWith(staticRoot+path.sep);
// AudioWorklet module fetches do not consistently cross page.route. A single
// local server owns real static delivery until both browser consumers finish.
const server=createServer((request,response)=>{
  const relative=decodeURIComponent(new URL(request.url,'http://localhost').pathname).replace(/^\//,'');
  if(request.method!=='GET'||!safeStatic(relative)){unexpectedStatic.push(relative);response.writeHead(404).end();return;}
  try{served.push(relative);response.writeHead(200,{'Content-Type':relative.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'});response.end(fs.readFileSync(path.resolve(staticRoot,relative)));}
  catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseURL='http://127.0.0.1:'+server.address().port;
try{
for(const [type,german] of [[chromium,false],[webkit,true]]){
  const name=type.name(),started=Date.now();let browser,context,native;
  try{
    native=await launchCanvasVoiceNativeChild({artifacts,name:'browser-'+name,locale:german?'de':'en'});
    await assert.rejects(()=>native.call('fetch',{url:'/api/account/canvas/projects/'+ 'f'.repeat(32)+'/agent/voice'}),/only the synthetic owned project/);
    await assert.rejects(()=>native.call('unapproved-command',{}),/Unknown browser\/native fixture command/);
    browser=await type.launch({headless:true});context=await browser.newContext({baseURL,viewport:{width:german?390:1280,height:800}});
    const page=await context.newPage(),requests=[],unexpected=[],servedBefore=served.length;
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==baseURL){unexpected.push(url.origin);return route.abort();}
      const relative=decodeURIComponent(url.pathname).replace(/^\//,'');
      if(relative==='favicon.ico')return route.fulfill({status:204});
      if(!safeStatic(relative)){unexpected.push(url.pathname);return route.abort();}
      const file=path.resolve(staticRoot,relative);assert(file.startsWith(staticRoot+path.sep),'Static path remains owned');requests.push(relative);
      await route.fulfill({contentType:relative.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(file)});
    });
    const info={project:{name:german?'webkit-canvas':'chromium'},async attach(title,{body,contentType}){assert.equal(contentType,'application/json');fs.writeFileSync(path.join(reports,name+'-'+title+'.json'),body,{flag:'wx'});}};
    const acceptance=await runCanvasVoiceNativeBrowserJourney({page,native},expect,info);
    assert.deepEqual(unexpected,[],'No unexpected browser external/API requests');
    assert([...requests,...served.slice(servedBefore)].includes('js/pages/canvas/voice-capture-worklet.js'),'Actual capture worklet is loaded');
    assert.deepEqual(unexpectedStatic,[],'Static server never serves API/provider traffic');
    records.push({name:'canvas_voice_browser_'+name+'_'+(german?'de':'en'),status:'PASS',durationMs:Date.now()-started,playwrightVersion:version,
      workletLoaded:true,...acceptance});
  }catch(error){records.push({name:'canvas_voice_browser_'+name,status:'FAIL',durationMs:Date.now()-started,error:error.message,stack:error.stack});process.exitCode=1;}
  finally{await context?.close();await browser?.close();await native?.close();}
  const summary={schema:1,sourceSha,staticRoot,reportDirectory:reports,records};
  fs.writeFileSync(path.join(reports,'result.json'),JSON.stringify(summary,null,2));
  if(supplied)fs.writeFileSync(path.join(supplied,'result.json'),JSON.stringify(summary,null,2));
  if(process.exitCode)break;
}
}finally{await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({artifacts,reports,records:records.map(({name,status,durationMs,captureDurationMs,error})=>({name,status,durationMs,captureDurationMs,...(error?{error}:{})}))}));
