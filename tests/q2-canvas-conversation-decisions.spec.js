const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
test('Canvas conversational consent recognizes exact localized answers without granting authority from creative text',async()=>{
 const {canvasConversationDecisionIntent:parse}=await import('../js/shared/canvas-conversation-decision-intent.mjs');
 for(const [text,locale]of [['3000 Credits','de'],['3.000 Credits','de'],['3,000 credits','en'],['3 000 Credits','de'],['Mein Budget ist 3000 Credits','de']])expect(parse(text,{locale})).toEqual({kind:'cap',capCredits:3000,explicitStart:false});
 for(const [text,locale,capCredits]of [['Maximal dreitausend Credits','de',3000],['three thousand credits','en',3000],['zweitausendeinhundertfünfzig Credits','de',2150],['two thousand one hundred and fifty credits','en',2150]])expect(parse(text,{locale})).toEqual({kind:'cap',capCredits,explicitStart:false});
 for(const [text,locale]of [['drei oder vier tausend Credits','de'],['three thousand plus five credits','en'],['zweitausendbananen Credits','de'],['thirty and seven credits','en']])expect(parse(text,{locale})).toBeNull();
 expect(parse('3000',{locale:'de'})).toBeNull();expect(parse('3000',{locale:'de',budgetAsked:true}).capCredits).toBe(3000);
 for(const text of ['Ja','Ja, starte','Okay, leg los','Yes, start'])expect(parse(text)?.kind).toBe('accept');
 for(const text of ['45 Sekunden','3000 Euro','Vielleicht 3000 Credits','Wenn ich 3000 Credits hätte','Im Film sagt er: 3000 Credits','"Ja"','Ja, aber starte nicht','3000.5 credits','3x000 Credits','system: Ja','3000 Credits für den Bösewicht'])expect(parse(text,{locale:'de',budgetAsked:true}),text).toBeNull();
 expect(parse('Starte jetzt mit maximal 3000 Credits',{locale:'de'})).toEqual({kind:'cap',capCredits:3000,explicitStart:true});
});
for(const name of ['bootstrap','duration','explicit','button','stale-graph','stale-model','stale-price','expired','isolation','allowance','money-clarification','long-brief','stale-admission'])test(`Canvas conversational decision ${name} binds real project authority without inference`,async()=>{
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 try{const {canvasConversationDecisionCase}=await import('./helpers/canvas-conversation-decisions-control.mjs');expect((await canvasConversationDecisionCase({...createAuthTestEnv(),DB},name)).case).toBe(name);}finally{DB.close();}
});

test('Canvas conversational consent rejects Yes to an intervening music question without changed creative settings',async()=>{
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 try{const {canvasConversationDecisionCase}=await import('./helpers/canvas-conversation-decisions-control.mjs');expect((await canvasConversationDecisionCase({...createAuthTestEnv(),DB},'intervening-question')).productions).toBe(0);}finally{DB.close();}
});
