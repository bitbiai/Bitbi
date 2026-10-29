import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
import {ensureConversation} from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import {grantMemberCredits} from '../../workers/auth/src/lib/billing.js';
import {getModelTariff} from '../../workers/auth/src/lib/model-tariffs.js';

export async function seedCanvasVoiceOwner(env,{name='normal',credits=1000,locale='de'}={}){
 if(!/^[a-z0-9-]{1,32}$/.test(name))throw new Error('Invalid synthetic Voice case');
 if(![1000,10000].includes(credits))throw new Error('Invalid isolated fixture funding');
 if(!['en','de'].includes(locale))throw new Error('Invalid fixture locale');
 const userId='voice-native-owner-'+name,projectId=(await sha256Hex(userId)).slice(0,32),sessionId=(await sha256Hex(userId+'-voice')).slice(0,32),
  now=new Date().toISOString(),expiry=new Date(Date.now()+600000).toISOString();
 for(const user of [userId,'voice-native-other-'+name]){
  await env.DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)")
   .bind(user,user+'@example.invalid','synthetic',now,now).run();
  await env.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
   .bind(user,user,await sha256Hex(`${user}:${env.SESSION_HASH_SECRET}`),now,expiry,now).run();
 }
 await env.DB.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Voice native fixture',?,?,?)").bind(projectId,userId,locale,now,now).run();
 await ensureConversation(env,projectId,userId);
 await grantMemberCredits({env,userId,amount:credits,idempotencyKey:'native-voice-synthetic-funding-'+name,source:'synthetic_fixture'});
 const tariff=await getModelTariff(env);
 await env.DB.prepare('UPDATE canvas_agent_conversations SET allowance_credits=100,allowance_tariff=? WHERE project_id=?').bind(tariff.revision,projectId).run();
 return {userId,projectId,sessionId};
}
