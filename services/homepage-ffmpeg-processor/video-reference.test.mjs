import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {mediaCommand} from './canvas-full-video.mjs';
import {prepareReference} from './video-reference.mjs';
import {inspectH3TimeReference,h3EncoderOverrun} from '../../workers/auth/src/lib/h3-reference-metadata.js';
export async function testVideoReferences() {
  const dir=await mkdtemp(path.join(tmpdir(),'bitbi-reference-test-'));
  try {
    const fixture=async(name,frames)=>{
      const file=path.join(dir,name+'.mp4');
      await mediaCommand('ffmpeg',['-y','-v','error','-f','lavfi','-i','testsrc2=size=320x320:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
        '-frames:v',String(frames),'-t',String(frames/24),'-c:v','libx264','-threads','2','-c:a','aac','-pix_fmt','yuv420p','-movflags','+faststart',file]);
      return file;
    };
    for(const frames of [336,360,362,366]) {
      const file=await fixture('frames-'+frames,frames),original=await readFile(file);
      const raw=inspectH3TimeReference(original,'video','video/mp4',{inspectOverrun:true});
      assert.equal(raw.frames,frames);
      if(frames<=360)assert.ok(inspectH3TimeReference(original,'video','video/mp4').duration<=15);
      else assert.throws(()=>inspectH3TimeReference(original,'video','video/mp4'),{code:'h3_reference_file_duration'});
      if(frames===362) {
        assert.equal(h3EncoderOverrun(raw,15),true);assert.equal(h3EncoderOverrun(raw,16),false);
        const {output,result}=await prepareReference(file,dir);
        const derived=inspectH3TimeReference(await readFile(output),'video','video/mp4');
        assert.ok(derived.duration<=15);assert.equal(derived.frames,360);assert.ok(derived.audioDuration>14.9);assert.ok(result.audio);
        assert.deepEqual(await readFile(file),original,'original including audio stays unchanged');
      } else await assert.rejects(prepareReference(file,dir));
    }
    assert.throws(()=>inspectH3TimeReference(new Uint8Array([1,2,3]),'video','video/mp4'),{code:'h3_reference_metadata_invalid'});
    console.log('Private video reference FFmpeg: exact/below/362-frame/excessive/invalid, original/audio preservation passed.');
  } finally {await rm(dir,{recursive:true,force:true});}
}
