// Native-runtime test control; never part of a deploy artifact.
// Only synthetic fixtures. Normal API calls go to the separate byte-identical B worker.
import { createSession } from '../../../workers/auth/src/lib/session.js';
import { SECURE_SESSION_COOKIE_NAME } from '../../../workers/auth/src/lib/cookies.js';
import { generateTotpCode } from '../../../workers/auth/src/lib/admin-mfa.js';
import { hashPassword } from '../../../workers/auth/src/lib/passwords.js';
import { deleteUserAiImage } from '../../../workers/auth/src/routes/ai/lifecycle.js';
import { putNewManagedR2Object } from '../../../workers/auth/src/lib/r2-cleanup.js';
const ADMIN='q2-workerd-admin';
const MEMBER='q2-workerd-member';
export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || request.headers.get('x-q2-control') !== env.Q2_CONTROL_TOKEN) return new Response(null,{status:403});
    const path=new URL(request.url).pathname;
    const body=await request.json();
    if (path==='/session' && [ADMIN,MEMBER].includes(body.userId)) {
      const session=await createSession(env,body.userId);
      return Response.json({cookie:`${SECURE_SESSION_COOKIE_NAME}=${session.sessionToken}`});
    }
    if (path==='/password' && body.userId===ADMIN && typeof body.password==='string') {
      await env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(body.password,env),ADMIN).run();
      return Response.json({ok:true});
    }
    if (path==='/totp' && typeof body.secret==='string') return Response.json({code:await generateTotpCode(body.secret)});
    if (path==='/delete-image' && body.imageId==='q2-workerd-atomic-image') {
      try { await deleteUserAiImage({env,userId:MEMBER,imageId:body.imageId}); return Response.json({ok:true}); }
      catch(error) {
        // Only a fixed synthetic fault marker escapes this external control.
        const causes=[error,error?.cause,error?.cause?.cause].map(item=>String(item?.message||'')).join('\n');
        const causeMarker=causes.includes('synthetic native source failure')?'synthetic_native_source_failure':null;
        return Response.json({ok:false,code:error.code||null,causeMarker},{status:error.status||500});
      }
    }
    if (path==='/managed-put' && body.key==='users/q2-workerd-member/native-create-only.webp') {
      try { await putNewManagedR2Object(env,body.key,new Uint8Array([9,8,7])); return Response.json({ok:true}); }
      catch(error) {
        if (error?.message !== 'Object key already exists.') throw error;
        return Response.json({ok:false,code:'object_key_already_exists'},{status:409});
      }
    }
    return new Response(null,{status:404});
  }
};
