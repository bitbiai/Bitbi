import { nowIso, randomTokenHex, sha256Hex } from './tokens.js';
import { prepareTransactionalMessage } from './transactional-messages.js';

export class ConsumerDeclarationError extends Error {
  constructor(code,status=400) { super(code); this.code=code; this.status=status; }
}
const fail=code=>{ throw new ConsumerDeclarationError(code); };
const text=(value,max,required=true,multiline=false)=>{
  if(value==null&&!required)return '';
  if(typeof value!=='string'||value.length>max)fail('consumer_field_invalid');
  const normalized=multiline?value.replaceAll('\r\n','\n'):value;
  if((multiline?/[\u0000-\u0008\u000b-\u001f\u007f<>]/u:/[\u0000-\u001f\u007f<>]/u).test(normalized))fail('consumer_field_invalid');
  const clean=normalized.trim();if(required&&!clean)fail('consumer_field_required');return clean;
};
export function validateConsumerDeclaration(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('consumer_input_invalid');
  const allowed=new Set(['requestId','kind','locale','name','email','contractReference','scope','endRequest','requestedEndDate','cancellationType','reason']);
  if(Object.keys(input).some(key=>!allowed.has(key)))fail('consumer_field_unknown');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId||''))fail('consumer_request_id_invalid');
  if(!['withdrawal','cancellation'].includes(input.kind)||!['en','de'].includes(input.locale))fail('consumer_input_invalid');
  const email=text(input.email,254).toLowerCase();
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))fail('consumer_email_invalid');
  const value={requestId:input.requestId.toLowerCase(),kind:input.kind,locale:input.locale,name:text(input.name,160),email,
    contractReference:text(input.contractReference,300,true,true),scope:text(input.scope,1000,false,true)};
  if(value.kind==='cancellation') {
    value.endRequest=input.endRequest||'earliest';value.cancellationType=input.cancellationType||'ordinary';
    if(!['earliest','date'].includes(value.endRequest)||!['ordinary','extraordinary'].includes(value.cancellationType))fail('consumer_cancellation_invalid');
    value.requestedEndDate=value.endRequest==='date'?text(input.requestedEndDate,10):null;
    if(value.requestedEndDate) {
      const date=new Date(value.requestedEndDate+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value.requestedEndDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value.requestedEndDate)fail('consumer_date_invalid');
    }
    value.reason=text(input.reason,1000,false,true);
  } else if(input.endRequest||input.requestedEndDate||input.cancellationType||input.reason)fail('consumer_withdrawal_fields_invalid');
  return value;
}

export function declarationReceipt(value,id,receivedAt) {
  const de=value.locale==='de',withdrawal=value.kind==='withdrawal';
  return [de?'BITBI – Eingangsbestätigung':'BITBI — Acknowledgement of receipt',
    `${de?'Referenz':'Reference'}: ${id}`,`${de?'Eingang (UTC)':'Received (UTC)'}: ${receivedAt}`,
    `${de?'Erklärung':'Declaration'}: ${withdrawal?(de?'Widerruf':'Withdrawal'):(de?'Kündigung':'Cancellation')}`,
    `${de?'Name':'Name'}: ${value.name}`,`${de?'Elektronischer Kontakt':'Electronic contact'}: ${value.email}`,
    `${de?'Vertrag / betroffener Teil':'Contract / relevant part'}: ${value.contractReference}`,
    value.scope?`${de?'Umfang':'Scope'}: ${value.scope}`:null,
    !withdrawal?`${de?'Gewünschtes Ende':'Requested end'}: ${value.endRequest==='date'?value.requestedEndDate:(de?'frühestmöglicher Zeitpunkt':'earliest possible date')}`:null,
    !withdrawal?`${de?'Art':'Type'}: ${value.cancellationType==='extraordinary'?(de?'außerordentlich':'extraordinary'):(de?'ordentlich':'ordinary')}`:null,
    value.reason?`${de?'Begründung':'Reason'}: ${value.reason}`:null,'',
    de?'Die Erklärung ist eingegangen. Vertragszuordnung und Rechtsfolgen werden geprüft. Diese Bestätigung bestätigt weder eine Erstattung noch eine bereits ausgeführte Änderung des Abonnements oder einen bestimmten Beendigungszeitpunkt.':'Your declaration has been received. Contract association and its consequences will be reviewed. This acknowledgement does not confirm a refund, an executed subscription change or a particular effective end date.',
    de?'Der Eingangszeitpunkt bleibt auch bei einer verzögerten E-Mail unverändert. Bewahre diese Bestätigung auf.':'The receipt time remains unchanged if email delivery is delayed. Retain this acknowledgement.',
    'BITBI · Stefan van Ark · Schwarzwaldstraße 20 · 78647 Trossingen · Germany · bit@bitbi.ai',
  ].filter(v=>v!==null).join('\n');
}

export async function declarationIdentity(value) {
  return {requestHash:await sha256Hex(`consumer-declaration:${value.requestId}`),inputHash:await sha256Hex(JSON.stringify(value))};
}
export async function findConsumerDeclaration(env,identity) {
  const row=await env.DB.prepare('SELECT * FROM consumer_declarations WHERE request_hash=?').bind(identity.requestHash).first();
  if(row&&row.input_hash!==identity.inputHash)throw new ConsumerDeclarationError('consumer_request_conflict',409);
  return row;
}
export async function receiveConsumerDeclaration(env,value,{userId=null,now=nowIso()}={}) {
  const identity=await declarationIdentity(value),existing=await findConsumerDeclaration(env,identity);
  if(existing)return {row:existing,reused:true};
  const id=`cd_${randomTokenHex(16)}`,receipt=declarationReceipt(value,id,now);
  const message=await prepareTransactionalMessage(env,{id:`declaration:${identity.requestHash}`,sourceId:id,
    kind:value.kind==='withdrawal'?'withdrawal_acknowledgement':'cancellation_acknowledgement',recipientEmail:value.email,
    subject:value.locale==='de'?'BITBI – Eingang deiner Vertragserklärung':'BITBI — Your contract declaration was received',text:receipt,now});
  // Receipt and acknowledgement intent commit together. No order lookup or paid mutation.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO consumer_declarations
      (id,request_hash,input_hash,kind,locale,user_id,name,email,contract_reference,declaration_json,receipt_text,received_at,review_due_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_hash) DO NOTHING`)
      .bind(id,identity.requestHash,identity.inputHash,value.kind,value.locale,userId,value.name,value.email,value.contractReference,
        JSON.stringify(value),receipt,now,new Date(Date.parse(now)+24*60*60_000).toISOString(),now),
    // Atomic batch + one request-derived mail identity retains the first receipt
    // even when two requests raced before either insert committed.
    message.statement,
  ]);
  const row=await findConsumerDeclaration(env,identity);
  return {row,reused:row.id!==id};
}
export async function consumerDeclarationView(env,row) {
  const mail=await env.DB.prepare('SELECT state,error_code FROM transactional_messages WHERE source_id=? ORDER BY created_at LIMIT 1').bind(row.id).first();
  return {ok:true,id:row.id,receivedAt:row.received_at,status:'received',acknowledgement:{state:mail?.state||'review_required'},
    receipt:{...JSON.parse(row.declaration_json),id:row.id,receivedAt:row.received_at,text:row.receipt_text}};
}
