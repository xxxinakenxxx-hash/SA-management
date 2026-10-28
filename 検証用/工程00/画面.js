// 工程00 試験画面（管理者が1回開くと全試験を順に実行し、結果をSA管理表の「試験ログ」にも残す）
function pageHtml_() {
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:14px/1.6 sans-serif;margin:16px}pre{background:#f4f4f4;padding:8px;white-space:pre-wrap;word-break:break-all}.ok{color:#0a7a2f}.ng{color:#b00020}</style></head><body>' +
    '<h3>工程00 技術検証（件数・判定結果のみ表示）</h3><div id="log"></div><script>' + PAGE_JS_ + '</script></body></html>';
}

var PAGE_JS_ = [
  "var summary = {};",
  "function say(t, cls){ var d=document.createElement('div'); d.className=cls||''; d.textContent=t; document.getElementById('log').appendChild(d); }",
  "function srv(fn){ var a=Array.prototype.slice.call(arguments,1); return new Promise(function(res){ google.script.run.withSuccessHandler(function(v){res({ok:true,v:v});}).withFailureHandler(function(e){res({ok:false,e:String(e&&e.message||e)});})[fn].apply(null,a); }); }",
  "async function step(name, fn){ say('実行中: '+name); var t=Date.now(); try{ var r=await fn(); summary[name]=r; say('完了: '+name+' ('+(Date.now()-t)+'ms)', 'ok'); return r; }catch(e){ summary[name]={error:String(e)}; say('失敗: '+name+' '+e, 'ng'); } }",
  "(async function(){",
  " await step('t2_本人判定', async function(){ return await srv('t2Judge'); });",
  " await step('t3_拒否判定', async function(){ return await srv('t3Gate'); });",
  " await step('t3_ブラウザ通信', async function(){",
  "   var u=await srv('getExecUrl'); if(!u.ok) return u; var out={};",
  "   async function tryFetch(label, opt){ try{ var r=await fetch(u.v+'?action=whoami', opt); var t=await r.text(); var j=null; try{j=JSON.parse(t);}catch(e){} out[label]={status:r.status,type:r.type,redirected:r.redirected,json:!!j,allowed:j&&j.allowed,role:j&&j.role,head:j?'':t.slice(0,60)}; }catch(e){ out[label]={error:String(e&&e.message||e)}; } }",
  "   await tryFetch('credentials_include',{credentials:'include'});",
  "   await tryFetch('credentials_omit',{credentials:'omit'});",
  "   return out; });",
  " await step('t4_直列と途中失敗', async function(){ return await srv('t4Serial'); });",
  " await step('t4_同時引受', async function(){",
  "   var ps=[srv('claim','R4','userA',1,3000,false), srv('claim','R4','userB',1,0,false), srv('claim','R4','userC',1,0,false)];",
  "   var rs=await Promise.all(ps); var st=await srv('t4Read'); return {results:rs.map(function(x){return x.ok?x.v:x;}), finalState:st.v}; });",
  " await step('t5_Drive', async function(){ return await srv('t5Drive'); });",
  " var models=await step('t6_モデル一覧', async function(){ return await srv('t6Models'); });",
  " var list=(models&&models.v&&models.v.gptLike)||[]; var pref=['gpt-4o-mini','gpt-4.1-mini','gpt-5-mini','gpt-4.1-nano','gpt-5-nano','gpt-4o']; var model=pref.filter(function(m){return list.indexOf(m)>=0;})[0]||(list.filter(function(m){return /mini/.test(m);})[0])||list[0];",
  " summary.model=model; say('使うモデル: '+model);",
  " if(model){ await step('t6_5項目抽出(架空)', async function(){ return await srv('t6Extract', model); }); }",
  " await step('t6_再試行', async function(){ return await srv('t6BadRequest'); });",
  " await srv('savePage', summary);",
  " say('全試験が終わりました。この画面を閉じて構いません。','ok');",
  " var pre=document.createElement('pre'); pre.textContent=JSON.stringify(summary,null,1).slice(0,6000); document.getElementById('log').appendChild(pre);",
  "})();"
].join('\n');
