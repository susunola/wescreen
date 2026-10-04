const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../telegram.js'),'utf8');
const ctx={URL,E:(zh,en)=>en,L:()=> 'Invalid link'};vm.runInNewContext(code.slice(code.indexOf('function safePart'),code.indexOf('async function refreshTelegramProfiles')),ctx);
test('Telegram message identity distinguishes channels and normalizes public aliases',()=>{
 assert.equal(ctx.telegramMessage('https://telegram.me/MyChannel/123?single').key,'public:mychannel');
 assert.equal(ctx.telegramMessage('t.me/mychannel/123').messageId,'123');
 assert.equal(ctx.telegramMessage('t.me/c/1234567890/123').key,'private:1234567890');
 assert.notEqual(ctx.telegramMessage('t.me/channelA/123').key,ctx.telegramMessage('t.me/channelB/123').key);
 assert.equal(ctx.telegramProfileKey({url:'https://t.me/MyChannel'}),'public:mychannel');
 for(const link of ['https://example.com/channel/123','https://t.me/+invite','https://t.me/channel','https://t.me/c/not-number/123'])assert.throws(()=>ctx.telegramMessage(link));
});
