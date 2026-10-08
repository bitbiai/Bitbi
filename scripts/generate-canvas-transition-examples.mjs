// Development-only, deterministic synthetic A/B illustrations. Never called by the app/build.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {TRANSITIONS,transitionSettings} from '../js/shared/canvas-transitions.mjs';
import {applyVideoTransitions} from '../services/homepage-ffmpeg-processor/canvas-transitions.mjs';
const root=process.cwd(),out=path.join(root,'assets/canvas/transition-examples'),work=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-example-'));
const ff=args=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',...args],{timeout:60000,maxBuffer:1024*1024});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function scene(name){
 const w=320,h=180,data=Buffer.alloc(w*h*3),a=name==='A',blank=name==='reset';
 const pixel=(x,y,color)=>{if(x>=0&&x<w&&y>=0&&y<h){const i=(Math.floor(y)*w+Math.floor(x))*3;for(let c=0;c<3;c++)data[i+c]=color[c];}};
 const rect=(x,y,r,b,color)=>{for(let j=y;j<b;j++)for(let i=x;i<r;i++)pixel(i,j,color);};
 const line=(x0,y0,x1,y1,color,thick=1)=>{const n=Math.ceil(Math.hypot(x1-x0,y1-y0));for(let t=0;t<=n;t++)rect(Math.round(x0+(x1-x0)*t/n),Math.round(y0+(y1-y0)*t/n),Math.round(x0+(x1-x0)*t/n)+thick,Math.round(y0+(y1-y0)*t/n)+thick,color);};
 rect(0,0,w,h,blank?[13,23,36]:a?[12,28,51]:[58,23,37]);
 if(!blank){
  for(let x=0;x<w;x+=20)line(x,0,x,h,a?[23,54,77]:[78,35,47]);
  for(let y=0;y<h;y+=20)line(0,y,w,y,a?[23,54,77]:[78,35,47]);
  if(a){
   for(let y=25;y<147;y++)for(let x=34;x<156;x++){const r=Math.hypot(x-95,y-86);if(r<54)pixel(x,y,r>48?[181,255,238]:[46,161,180]);if(r<34&&r>30)pixel(x,y,[232,251,239]);}
   for(let i=0;i<5;i++)line(174,42+i*23,284,21+i*23,[192,230,245],3);
   line(169,151,296,151,[232,251,239],3);
  }else{
   for(let i=0;i<4;i++){const x=30+i*57,y=108-i*22;rect(x,y,x+42,156,[232,142+i*18,53]);for(let j=y+8;j<150;j+=16)rect(x+8,j,x+33,j+5,[255,244,216]);}
   for(let y=14;y<63;y++)for(let x=243;x<292;x++)if(Math.hypot(x-267,y-38)<23)pixel(x,y,[255,241,204]);
  }
  for(const [x,y]of [[19,17],[302,92],[159,13],[155,159]]){line(x-4,y,x+4,y,[255,253,240],2);line(x,y-4,x,y+4,[255,253,240],2);}
 }
 const glyphs={A:['01110','11011','11011','11111','11011','11011','11011'],B:['11110','11011','11011','11110','11011','11011','11110']};
 const text=(letter,x,y,scale=3)=>glyphs[letter].forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='1')rect(x+i*scale,y+j*scale,x+(i+1)*scale,y+(j+1)*scale,[240,247,251]);}));
 if(blank){text('A',112,79);text('B',193,79);line(143,89,177,89,[90,193,181],3);line(169,81,177,89,[90,193,181],3);line(169,97,177,89,[90,193,181],3);}
 else{rect(12,141,45,174,[13,23,36]);text(a?'A':'B',21,147);}
 const file=path.join(work,name+'.ppm');fs.writeFileSync(file,Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`),data]));return file;
}
try{
 fs.mkdirSync(out,{recursive:true});const clips=[];
 for(const name of ['A','B','reset']){const input=scene(name),file=path.join(work,name+'.mp4');ff(['-loop','1','-framerate','24','-i',input,'-t',name==='reset'?'0.5':'2','-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p',file]);clips.push(file);}
 const base=path.join(work,'base.mp4');ff(['-i',clips[0],'-i',clips[1],'-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p',base]);
 const entries=[];
 for(const preset of TRANSITIONS){
  const settings=transitionSettings({preset:preset.id,...(preset.id==='none'?{}:{duration:.8,...(preset.parameter?{strength:preset.default}:{})})});
  const frameBase={output:base,width:320,height:180,fps:24,mode:'synthetic',timeline:[{start:0,duration:2},{start:2,duration:2}],duration:4};
  const rendered=await applyVideoTransitions(frameBase,[settings],work,{run:async(command,args)=>execFileSync(command,args,{timeout:60000}).toString(),inspect:async file=>{const p=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',file]));return{audio:null,videoDuration:Number(p.streams[0].duration)};},limits:{outputBytes:20000000}});
  const gif=path.join(out,preset.id+'.gif'),poster=path.join(out,preset.id+'.png');
  ff(['-i',rendered.output,'-i',clips[2],'-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0,fps=12,scale=160:90:flags=lanczos,split[frames][colors];[colors]palettegen=max_colors=64:stats_mode=full[p];[frames][p]paletteuse=dither=none[out]','-map','[out]','-loop','0',gif]);
  ff(['-i',rendered.output,'-ss',preset.id==='none'?'2.25':'1.6','-frames:v','1','-vf','scale=160:90:flags=lanczos',poster]);
  entries.push({id:preset.id,settings,width:160,height:90,gifBytes:fs.statSync(gif).size,gifSha256:hash(fs.readFileSync(gif)),posterBytes:fs.statSync(poster).size,posterSha256:hash(fs.readFileSync(poster))});
 }
 const sources=['js/shared/canvas-transitions.mjs','services/homepage-ffmpeg-processor/canvas-transitions.mjs'];
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({version:1,synthetic:true,description:'Fixed A/B illustrations; not user clips or current controls. Neutral A-to-B slate marks loop restart.',tool:execFileSync('ffmpeg',['-version'],{encoding:'utf8'}).split('\n')[0],sourceHashes:Object.fromEntries(sources.map(file=>[file,hash(fs.readFileSync(file))])),entries},null,2)+'\n');
 console.log(JSON.stringify({examples:entries.length,gifBytes:entries.reduce((n,e)=>n+e.gifBytes,0),entries:entries.map(({id,gifBytes,posterBytes})=>({id,gifBytes,posterBytes}))}));
}finally{fs.rmSync(work,{recursive:true,force:true});}
