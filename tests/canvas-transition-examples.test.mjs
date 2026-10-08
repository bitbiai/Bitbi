import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {TRANSITIONS} from '../js/shared/canvas-transitions.mjs';
const root='assets/canvas/transition-examples/',manifest=JSON.parse(fs.readFileSync(root+'manifest.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Every offered transition has a small distinct decoded GIF and a reduced-motion still',()=>{
 assert.deepEqual(manifest.entries.map(e=>e.id),TRANSITIONS.map(e=>e.id));
 assert.deepEqual(fs.readdirSync(root).sort(),['manifest.json',...TRANSITIONS.flatMap(e=>[e.id+'.gif',e.id+'.png'])].sort());
 assert.equal(manifest.synthetic,true);
 for(const [file,expected]of Object.entries(manifest.sourceHashes))assert.equal(hash(fs.readFileSync(file)),expected,'Changed rendering semantics require reviewed illustrative assets');
 const decoded=new Map();let total=0;
 for(const entry of manifest.entries){
  const gif=fs.readFileSync(root+entry.id+'.gif'),png=fs.readFileSync(root+entry.id+'.png');
  assert.equal(gif.subarray(0,6).toString(),'GIF89a');assert.equal(gif.readUInt16LE(6),160);assert.equal(gif.readUInt16LE(8),90);
  assert.equal(hash(gif),entry.gifSha256);assert.equal(hash(png),entry.posterSha256);assert.equal(gif.length,entry.gifBytes);assert.equal(png.length,entry.posterBytes);
  assert(gif.length<100000&&png.length<40000);total+=gif.length;
  const raw=execFileSync('ffmpeg',['-v','error','-ignore_loop','1','-i',root+entry.id+'.gif','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:4*1024*1024,timeout:10000});
  const size=160*90*3;assert.equal(raw.length%size,0);const frames=Array.from({length:raw.length/size},(_,i)=>raw.subarray(i*size,(i+1)*size));
  assert(frames.length>=40&&frames.length<=60);assert(new Set(frames.map(hash)).size>=3,'A, transition/B and restart slate must decode');decoded.set(entry.id,frames);
  execFileSync('ffmpeg',['-v','error','-i',root+entry.id+'.png','-f','null','-'],{timeout:10000});
 }
 assert(total<800000);assert.equal(new Set(manifest.entries.map(e=>e.gifSha256)).size,TRANSITIONS.length,'No shared generic fade substituted for distinct effects');
 const mean=b=>b.reduce((sum,v)=>sum+v,0)/b.length;
 const midpoint=id=>decoded.get(id)[19];
 assert(mean(midpoint('flash'))>mean(midpoint('fade'))+65,'Flash must brighten the actual example');
 assert(mean(midpoint('fadeblack'))<mean(midpoint('fade'))*.6,'Black variant must visibly darken');
 assert(mean(midpoint('fadewhite'))>mean(midpoint('fade'))+50,'White variant must visibly brighten');
 assert(mean(midpoint('bloom'))>mean(midpoint('fade')),'Glow is not the same cross dissolve');
 assert.notEqual(hash(midpoint('slideleft')),hash(midpoint('slideright')),'Direction variants must differ');
 console.log(JSON.stringify({examples:manifest.entries.length,gifBytes:total,width:160,height:90,decoded:true}));
});
