import {processTransactionalMessages} from '../../../workers/auth/src/lib/transactional-messages.js';
import {CANVAS_MEDIA_ACTION_POLICY_CASES,canvasMediaActionPolicyCase} from '../canvas-agent-media-action-policy-control.mjs';
import {CANVAS_MEDIA_POLICY_CASES,canvasMediaPolicyCase} from '../canvas-agent-media-policy-control.mjs';
import {MEDIA_COMPLETION_CASES,canvasMediaCompletionCase} from '../canvas-agent-media-completion-control.mjs';
import {CANVAS_LOCAL_RECOVERY_CASES,canvasLocalRecoveryCase} from '../canvas-agent-model-operation-cases.mjs';
import {seedCanvasAssistantMigration,verifyCanvasAssistantMigration} from '../canvas-assistant-migration-control.mjs';
import {canvasProjectLifecycleCase} from '../canvas-project-lifecycle-control.mjs';
import {canvasNotificationsCase,seedCanvasNotificationsMigration,verifyCanvasNotificationsMigration} from '../canvas-notifications-control.mjs';
import {canvasExplanationCase} from '../canvas-agent-explanation-control.mjs';
import {CANVAS_INCIDENT_CASES,canvasIncidentCase} from '../canvas-incident-control.mjs';
import {canvasPlanInterpretationCase} from '../canvas-agent-plan-interpretation-control.mjs';
import {canvasPlanCorrectionReviewCase} from '../canvas-agent-plan-correction-review-control.mjs';
import {canvasAgentPreflightCase} from '../canvas-agent-preflight-control.mjs';
import {seedCanvasConversationMigration,verifyCanvasConversationMigration,CANVAS_CONVERSATION_CASES,canvasConversationCase} from '../canvas-agent-conversation-control.mjs';
import {canvasAssistantModelSwitchCase,canvasAssistantProductionCase} from '../canvas-assistant-model-control.mjs';
import {CANVAS_CONVERSATION_RECOVERY_CASES,canvasConversationRecoveryCase} from '../canvas-agent-conversation-recovery-control.mjs';
import {seedCanvasNaturalChatMigration,verifyCanvasNaturalChatMigration,CANVAS_NATURAL_CASES,canvasNaturalCase,CANVAS_ACTION_CASES,canvasActionCase} from '../canvas-agent-natural-control.mjs';
import {CANVAS_ACTION_RECOVERY_CASES,canvasActionRecoveryCase} from '../canvas-agent-action-recovery-control.mjs';
import {CANVAS_AGENT_AUTONOMY_CASES,canvasAgentAutonomyCase} from '../canvas-agent-autonomy-control.mjs';
import {canvasWorkspaceTransitionCase} from '../canvas-workspace-transition-control.mjs';
import {CANVAS_MODEL_CASES,canvasModelOperationCase} from '../canvas-agent-model-operation-cases.mjs';
import {CANVAS_SETTLEMENT_CASES,canvasPlanningSettlementCase} from '../canvas-agent-settlement-review-control.mjs';
import {CANVAS_IMAGE_SCHEDULING_CASES,canvasImageSchedulingCase} from '../canvas-image-scheduling-control.mjs';
import {H3_RECOVERY_CASES,canvasH3RecoveryCase} from '../canvas-agent-h3-recovery-control.mjs';
import {READINESS_CASES,canvasAgentReadinessCase} from '../canvas-agent-readiness-control.mjs';
import {CANVAS_CONVERSATION_DECISION_CASES,canvasConversationDecisionCase} from '../canvas-conversation-decisions-control.mjs';
import { canvasAgentAuthorityCase, canvasAgentApiCase, canvasAgentDispatchCase, canvasAgentCapabilityCase, canvasAgentNativeDurationCase, canvasAgentLateCompletionCase,canvasAgentUnknownProviderCase, canvasAgentManualTakeoverCase } from '../canvas-agent-control.mjs';
import { canvasAssemblyCase, canvasInspectionCase, canvasAssemblyRetentionCase, seedCanvasAssemblyRetentionMigration, verifyCanvasAssemblyRetentionMigration } from '../canvas-assembly-control.mjs';
import {memberGenerationCase} from '../member-generation-control.mjs';
import { modelPricingCase } from '../model-pricing-control.mjs';
import { image25Output } from '../../../workers/shared/gpt-image-25.mjs';
import { cleanupExpiredMemberAiUsageAttempts } from '../../../workers/auth/src/lib/member-ai-usage-attempts.js';
import worker from '../../../workers/auth/src/index.js';
import { privateMediaCase,privateMediaSmokeCase } from '../private-media-control.mjs';
import { canvasProcessingCase } from '../canvas-processing-control.mjs';
import { canvasCompletionCase } from '../canvas-completion-control.mjs';
import { canvasAudioCase, canvasAudioInputsCase, seedCanvasAudioMigration, verifyCanvasAudioMigration } from '../canvas-audio-control.mjs';
import {canvasSmoothCase} from '../canvas-smooth-control.mjs';
import { canvasMusicCase } from '../canvas-music-control.mjs';
import { elevenLabsMemberCase } from '../elevenlabs-member-control.mjs';
import { canvasContributorsCase } from '../canvas-contributors-control.mjs';
import { canvasVideoCase, adminPixverseCase } from '../canvas-video-control.mjs';
// Native-runtime test control; never part of a deploy artifact.
// Only synthetic fixtures. Normal API calls go to the separate byte-identical B worker.
import { createSession } from '../../../workers/auth/src/lib/session.js';
import { SECURE_SESSION_COOKIE_NAME } from '../../../workers/auth/src/lib/cookies.js';
import { generateTotpCode } from '../../../workers/auth/src/lib/admin-mfa.js';
import { hashPassword } from '../../../workers/auth/src/lib/passwords.js';
import { deleteUserAiImage } from '../../../workers/auth/src/routes/ai/lifecycle.js';
import { putNewManagedR2Object } from '../../../workers/auth/src/lib/r2-cleanup.js';
import { AuthPublicRateLimiterDurableObject } from '../../../workers/auth/src/lib/public-rate-limiter-do.js';
const nativeRateFixtureNow=Date.now.bind(Date);
// Only the isolated native rate fixture owns this binding. Normal /limit
// requests use the production handler and real Durable Object storage.
export class CanvasImageRateTestDurableObject extends AuthPublicRateLimiterDurableObject {
  async fetch(request){
    if(new URL(request.url).pathname!=='/q2-expire-image-window')return super.fetch(request);
    const body=await request.json(),storage=this.state.storage;
    const windowStart=await storage.get('window_start_ms'),count=await storage.get('count'),expires=await storage.get('expires_at_ms');
    if(request.method!=='POST'||Object.keys(body).sort().join(',')!=='count,windowStart'
      ||!Number.isSafeInteger(count)||count<21||count!==body.count||windowStart!==body.windowStart
      ||expires!==windowStart+3600000)throw new Error('Synthetic image limiter expiry identity changed');
    const now=nativeRateFixtureNow(),previous=now-now%3600000-3600000;
    // Model an expired persisted counter, without changing the DO clock,
    // shortening its hourly window, or replacing its object identity.
    await storage.put({window_start_ms:previous,expires_at_ms:previous+3600000});
    return Response.json({expired:true,count,windowStart:previous,expiresAt:previous+3600000});
  }
}
const ADMIN='q2-workerd-admin';
const MEMBER='q2-workerd-member';
export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || request.headers.get('x-q2-control') !== env.Q2_CONTROL_TOKEN) return new Response(null,{status:403});
    const path=new URL(request.url).pathname;
    const body=await request.json();
    if(path==='/consumer-mail')return Response.json(await processTransactionalMessages(env));
    if(path==='/canvas-project-lifecycle')return Response.json(await canvasProjectLifecycleCase(env));
    if(path==='/canvas-notifications')return Response.json(await canvasNotificationsCase(env));
    if(path==='/canvas-notifications-migration-seed')return Response.json(await seedCanvasNotificationsMigration(env));
    if(path==='/canvas-notifications-migration-verify')return Response.json(await verifyCanvasNotificationsMigration(env,body));
    if(path==='/canvas-explanation'&&['evidence','quoted','budget-scope'].includes(body.name))return Response.json(await canvasExplanationCase(env,body.name));
    if(path==='/canvas-media-action-policy'&&CANVAS_MEDIA_ACTION_POLICY_CASES.includes(body.name))return Response.json(await canvasMediaActionPolicyCase(env,body.name));
    if(path==='/canvas-media-policy'&&CANVAS_MEDIA_POLICY_CASES.includes(body.name))return Response.json(await canvasMediaPolicyCase(env,body.name));
    if(path==='/canvas-local-planning-recovery'&&CANVAS_LOCAL_RECOVERY_CASES.includes(body.name))return Response.json(await canvasLocalRecoveryCase(env,body.name));
    if(path==='/canvas-incident'&&CANVAS_INCIDENT_CASES.includes(body.name))return Response.json(await canvasIncidentCase(env,body.name));
    if(path==='/canvas-agent-plan-interpretation'&&['recover','guards','crash','active','preflight'].includes(body.name))return Response.json(await canvasPlanInterpretationCase(env,body.name));
    if(path==='/canvas-agent-plan-correction-review'&&['recover','guards','race','format'].includes(body.name))return Response.json(await canvasPlanCorrectionReviewCase(env,body.name));
    if(path==='/canvas-assistant-migration-seed')return Response.json(await seedCanvasAssistantMigration(env));
    if(path==='/canvas-assistant-migration-verify')return Response.json(await verifyCanvasAssistantMigration(env,body));
    if(path==='/canvas-agent-preflight')return Response.json(await canvasAgentPreflightCase(env,body));
    if(path==='/canvas-conversation-migration-seed')return Response.json(await seedCanvasConversationMigration(env));
    if(path==='/canvas-conversation-migration-verify')return Response.json(await verifyCanvasConversationMigration(env,body));
    if(path==='/canvas-natural-migration-seed')return Response.json(await seedCanvasNaturalChatMigration(env));
    if(path==='/canvas-natural-migration-verify')return Response.json(await verifyCanvasNaturalChatMigration(env,body));
    if(path==='/canvas-natural-chat'&&CANVAS_NATURAL_CASES.includes(body.name))return Response.json(await canvasNaturalCase(env,body.name));
    if(path==='/canvas-conversation-actions'&&CANVAS_ACTION_CASES.includes(body.name))return Response.json(await canvasActionCase(env,body));
    if(path==='/canvas-conversation-action-recovery'&&CANVAS_ACTION_RECOVERY_CASES.includes(body.name))return Response.json(await canvasActionRecoveryCase(env,body.name));
    if(path==='/canvas-assistant-model-switch')return Response.json(await canvasAssistantModelSwitchCase(env));
    if(path==='/canvas-assistant-production')return Response.json(await canvasAssistantProductionCase(env));
    if(path==='/canvas-conversation'&&CANVAS_CONVERSATION_CASES.includes(body.name))return Response.json(await canvasConversationCase(env,body.name));
    if(path==='/canvas-conversation-recovery'&&CANVAS_CONVERSATION_RECOVERY_CASES.includes(body.name))return Response.json(await canvasConversationRecoveryCase(env,body.name));
    if(path==='/canvas-agent-autonomy'&&CANVAS_AGENT_AUTONOMY_CASES.includes(body.name))return Response.json(await canvasAgentAutonomyCase(env,body.name));
    if(path==='/canvas-agent-model-operation'&&CANVAS_MODEL_CASES.includes(body.name))return Response.json(await canvasModelOperationCase(env,body.name));
    if(path==='/canvas-agent-settlement-review'&&CANVAS_SETTLEMENT_CASES.includes(body.name))return Response.json(await canvasPlanningSettlementCase(env,body.name));
    if(path==='/canvas-image-scheduling'&&CANVAS_IMAGE_SCHEDULING_CASES.includes(body.name)){
      if(!env.CANVAS_IMAGE_TEST_DB)throw new Error('Native image scheduling requires its isolated D1 fixture');
      const scoped={...env,DB:env.CANVAS_IMAGE_TEST_DB};
      if(body.name==='rate-admission'){
        if(!env.CANVAS_IMAGE_RATE_TEST)throw new Error('Native rate fixture requires its real clock-independent Durable Object');
        scoped.PUBLIC_RATE_LIMITER=env.CANVAS_IMAGE_RATE_TEST;
        scoped.__TEST_EXPIRE_IMAGE_RATE=async(key,expected)=>{
          const stub=env.CANVAS_IMAGE_RATE_TEST.get(env.CANVAS_IMAGE_RATE_TEST.idFromName(key));
          const response=await stub.fetch('https://rate-limit.internal/q2-expire-image-window',{method:'POST',body:JSON.stringify(expected)});
          if(!response.ok)throw new Error('Synthetic owned rate counter expiry failed');
          return response.json();
        };
      }
      return Response.json(await canvasImageSchedulingCase(scoped,body));
    }
    if(path==='/canvas-agent-media-completion'&&MEDIA_COMPLETION_CASES.includes(body.name))return Response.json(await canvasMediaCompletionCase(env,body.name,body));
    if(path==='/canvas-agent-h3-recovery'&&H3_RECOVERY_CASES.includes(body.name))return Response.json(await canvasH3RecoveryCase(env,body.name,body));
    if(path==='/canvas-agent-readiness'&&READINESS_CASES.includes(body.name))return Response.json(await canvasAgentReadinessCase(env,body.name,body));
    if(path==='/canvas-conversation-decision'&&CANVAS_CONVERSATION_DECISION_CASES.includes(body.name))return Response.json(await canvasConversationDecisionCase(env,body.name));
    if (path === '/canvas-agent-authority') return Response.json(await canvasAgentAuthorityCase(env));
    if (path === '/canvas-agent-api') return Response.json(await canvasAgentApiCase(env));
    if (path === '/canvas-agent-dispatch') return Response.json(await canvasAgentDispatchCase(env,body));
    if (path === '/canvas-agent-capabilities') return Response.json(await canvasAgentCapabilityCase(env));
    if (path === '/canvas-agent-native-duration') return Response.json(await canvasAgentNativeDurationCase(env));
    if (path === '/canvas-agent-late-completion') return Response.json(await canvasAgentLateCompletionCase(env,body));
    if (path === '/canvas-agent-unknown-provider') return Response.json(await canvasAgentUnknownProviderCase(env,body));
    if (path === '/canvas-agent-manual-takeover') return Response.json(await canvasAgentManualTakeoverCase(env,body));
    if (path === '/canvas-assembly') return Response.json(await canvasAssemblyCase(env,body));
    if (path === '/canvas-assembly-retention') return Response.json(await canvasAssemblyRetentionCase(env,body));
    if (path === '/canvas-retention-migration-seed') return Response.json(await seedCanvasAssemblyRetentionMigration(env));
    if (path === '/canvas-retention-migration-verify') return Response.json(await verifyCanvasAssemblyRetentionMigration(env,body));
    if (path === '/canvas-inspection') return Response.json(await canvasInspectionCase(env,body));
    if(path==='/model-area-generation'&&['area-queued','area-running'].includes(body.name))return Response.json(await memberGenerationCase(env,body.name,body));
    if(path==='/image25-queue') {
      const job=await env.DB.prepare('SELECT id FROM member_generation_jobs WHERE id=? AND user_id=?').bind(body.id,MEMBER).first();
      if(!job)return new Response(null,{status:404});
      if(body.expire)return Response.json(await cleanupExpiredMemberAiUsageAttempts({env,dryRun:false}));
      const result={ack:0,retry:0};
      await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:{type:'member_generation.process',job_id:job.id},attempts:1,
        ack(){result.ack++;},retry(){result.retry++;}}]},env,{waitUntil(){throw new Error('No browser/detached work');}});
      return Response.json(result);
    }
    if (path==='/image25-output') {
      let rejected=false;
      try { await globalThis.fetch('https://image25-output.example/original.png',{redirect:'error'}); }
      catch(error) {rejected=error instanceof TypeError && error.message.includes('Invalid redirect value');}
      if(!rejected)throw new Error('Old redirect contract no longer reproduces; review native expectation');
      try { return Response.json({ok:true,output:await image25Output({state:'Completed',result:{image:'https://image25-output.example/original.png'}},{fetcher:globalThis.fetch,outputFormat:'png'})}); }
      catch(error) {return Response.json({code:error.code,diagnostic:error.providerDiagnostic},{status:502});}
    }
    if (path==='/model-pricing') {
      try { return Response.json(await modelPricingCase(env,body)); }
      catch(error) { return Response.json({code:error.code||null,message:error.message},{status:error.status||500}); }
    }
    if (path==='/admin-pixverse' && ['success','failure','unknown','grok-base','grok-preview','h3'].includes(body.name)) return Response.json(await adminPixverseCase(env, body.name, body));
    if (path==='/private-media-smoke') return Response.json(await privateMediaSmokeCase(env,body));
    if (path==='/private-media') return Response.json(await privateMediaCase(env,body));
    if (path==='/canvas-processing') return Response.json(await canvasProcessingCase(env,body));
    if (path==='/canvas-audio-inputs') return Response.json(await canvasAudioInputsCase(env,body));
    if(path==='/canvas-transitions') return Response.json(await canvasWorkspaceTransitionCase(env,body));
    if (path==='/canvas-audio') return Response.json(await canvasAudioCase(env,body));
    if (path==='/canvas-smooth') return Response.json(await canvasSmoothCase(env,body));
    if (path==='/canvas-audio-migration-seed') return Response.json(await seedCanvasAudioMigration(env.DB));
    if (path==='/canvas-audio-migration-verify') return Response.json(await verifyCanvasAudioMigration(env.DB,body));
    if (path==='/canvas-completion') return Response.json(await canvasCompletionCase(env,body));
    if (path==='/canvas-music') return Response.json(await canvasMusicCase(env,body.name,body.role,body.imageBase64));
    if (path==='/elevenlabs-member') return Response.json(await elevenLabsMemberCase(env, body.name, body.role, body.media));
    if (path==='/canvas-contributors') return Response.json(await canvasContributorsCase(env));
    if (path==='/canvas-video' && ['seedance-edit','omni','h3','h3-overrun','h3-overrun-failure','h3-last-frame','h3-stale','h3-deleted','h3-foreign','first','success','last-frame','foreign','changed','blocked','blocked-admin','provider-interrupted','receipt-write'].includes(body.name)) return Response.json(await canvasVideoCase(env, body.name, body));
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
