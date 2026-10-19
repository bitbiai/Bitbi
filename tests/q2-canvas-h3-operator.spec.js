const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('H3 operator rejects malformed scope and public evidence before credential access',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'h3-operator-'));
 try{
  const input=path.join(directory,'input.json'),output=path.join(directory,'output.json');
  const invoke=args=>{const result=spawnSync(process.execPath,['scripts/canvas-h3-recovery.mjs',...args],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:directory},timeout:15000});expect(result.status).toBe(1);expect(result.stdout).toBe('');return JSON.parse(result.stderr.trim()).code;};
  expect(invoke([])).toBe('canvas_recovery_private_path_required');
  fs.writeFileSync(input,JSON.stringify({runId:'synthetic',projectId:'synthetic',userId:'synthetic',expectedSource:'0'.repeat(40),projectCapCredits:3000,sql:'UPDATE anything'}),{mode:0o600});
  expect(invoke(['--input',input,'--output',output])).toBe('canvas_recovery_input_invalid');
  expect(invoke(['--input',input,'--output',path.join(process.cwd(),'private-recovery.json')])).toBe('canvas_recovery_private_path_required');
  fs.chmodSync(input,0o644);expect(invoke(['--input',input,'--output',output])).toBe('canvas_recovery_private_input_invalid');
  expect(fs.existsSync(output)).toBe(false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
