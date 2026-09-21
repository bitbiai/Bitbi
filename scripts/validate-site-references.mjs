// Website URLs resolve against a website root, never the runner filesystem.
// Source and immutable candidate are intentionally separate invocations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SITE_ROOT_FILES,SITE_ROOT_DIRS} from './lib/asset-version.mjs';

export function validateSiteReferences(directory,{source=false}={}) {
  const root=path.resolve(directory), html=[];
  assert(fs.lstatSync(root).isDirectory()&&!fs.lstatSync(root).isSymbolicLink(),'Website root must be a real directory');
  const regular=relative=>{
    const parts=relative.split('/');
    assert(!parts.includes('..'),'Reference escapes website root');
    for(let i=1;i<=parts.length;i++)assert(!fs.lstatSync(path.join(root,...parts.slice(0,i))).isSymbolicLink(),'Website symlinks are not supported');
    return fs.lstatSync(path.join(root,relative));
  };
  const visit=relative=>{
    const stat=regular(relative);
    if(stat.isDirectory())for(const name of fs.readdirSync(path.join(root,relative)).sort())visit(path.posix.join(relative,name));
    else {assert(stat.isFile(),'Non-regular website file');if(/\.html$/i.test(relative))html.push(relative);}
  };
  // The build allowlist excludes candidate/, tests, tooling and local archives.
  const entries=source?[...SITE_ROOT_FILES,...SITE_ROOT_DIRS].filter(name=>fs.existsSync(path.join(root,name))):fs.readdirSync(root);
  entries.forEach(visit);
  assert(html.length,'No website HTML to validate');
  let references=0;const errors=[];
  for(const file of html) {
    const text=fs.readFileSync(path.join(root,file),'utf8').replace(/<!--[\s\S]*?-->/g,'');
    // Match actual link/script tags, including multiline and single-quoted URLs.
    for(const tag of text.matchAll(/<(link|script)\b[^>]*>/gi)) {
      const attribute=tag[1].toLowerCase()==='link'?'href':'src';
      const ref=tag[0].match(new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'))?.slice(1).find(v=>v!==undefined);
      if(!ref||/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref))continue;
      const url=new URL(ref.replaceAll('&amp;','&'),`https://site.invalid/${file}`);
      if(!/\.(?:css|m?js)$/i.test(url.pathname))continue;
      references++;
      try {
        const target=decodeURIComponent(url.pathname).replace(/^\//,'');
        assert(!target.includes('\\')&&!target.includes('\0'),'Invalid website reference');
        assert(regular(target).isFile(),'Reference is not a file');
      } catch {errors.push(`${file}: missing/unsafe ${attribute}=${JSON.stringify(ref)}`);}
    }
  }
  assert.equal(errors.length,0,`Invalid local CSS/JS references in ${root}:\n${errors.join('\n')}`);
  return {root,html:html.length,references};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    assert(args[0]==='--root'&&args[1]&&[2,3].includes(args.length)&&(args.length===2||args[2]==='--source'),'Use --root WEBSITE_DIRECTORY [--source]');
    console.log(JSON.stringify(validateSiteReferences(args[1],{source:args[2]==='--source'})));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
