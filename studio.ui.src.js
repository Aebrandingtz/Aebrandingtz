/* ===== SHEREHE STUDIO ui (admin-only test phase) ===== */
(function(){
'use strict';
const E=window.StudioEngine; if(!E) return;
const $=id=>document.getElementById(id), esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PREV_EDGE=1400, FULL_EDGE=4096;
const S={items:[],cur:-1,hist:[],hi:-1,cmp:'off',split:50,tab:'auto',band:0,curveCh:'rgb',style:'auto',strength:100,busy:false,open:false,presets:[],report:'',raf:0};
const toast=m=>{ try{ window.toast(m); }catch(e){ console.log(m); } };
const isOwner=()=>{ try{ return typeof isAdmin!=='undefined'&&!!isAdmin; }catch(e){ return false; } };
function loadPresets(){ try{ S.presets=JSON.parse(localStorage.getItem('shStudioPresets')||'[]').map(p=>{ if(p.lut) p.lut.data=Float32Array.from(p.lut.data); return p; }); }catch(e){ S.presets=[]; } }
function savePresets(){ try{ localStorage.setItem('shStudioPresets',JSON.stringify(S.presets.map(p=>p.lut?Object.assign({},p,{lut:{name:p.lut.name,size:p.lut.size,data:Array.from(p.lut.data)}}):p))); }catch(e){ toast('Preset haikuhifadhiwa (nafasi ya kivinjari imejaa). Ifute baadhi.'); } }
const CSS=`#stRoot{position:fixed;inset:0;z-index:100000;background:#101418;color:#e8ecef;display:flex;flex-direction:column;font:14px/1.35 system-ui,sans-serif}
#stRoot *{box-sizing:border-box}#stRoot button,#stRoot select,#stRoot input{font:inherit}
.sx-top{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#171c22;border-bottom:1px solid #26303a;flex-wrap:wrap}
.sx-top b{font-size:15px;color:#fff}.sx-top .sp{flex:1}
.sx-b{background:#26303a;color:#e8ecef;border:1px solid #33414f;border-radius:8px;padding:7px 12px;cursor:pointer;min-height:36px}.sx-b:hover{background:#2e3a46}.sx-b.pri{background:#2f6df6!important;border-color:#2f6df6!important;color:#fff!important;opacity:1}.sx-b:disabled{opacity:.45;cursor:default}
.sx-main{flex:1;display:flex;min-height:0}
.sx-stage{flex:1;display:flex;flex-direction:column;min-width:0}
.sx-view{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding:10px;position:relative;overflow:hidden}
.sx-wrap{position:relative;max-width:100%;max-height:100%;line-height:0}
.sx-wrap canvas{max-width:100%;max-height:calc(100vh - 250px);display:block}
#stOrig{position:absolute;inset:0;width:100%;height:100%}
.sx-strip{display:flex;gap:6px;padding:8px;overflow-x:auto;background:#171c22;border-top:1px solid #26303a;min-height:92px}
.sx-th{position:relative;flex:0 0 auto;width:74px;height:74px;border-radius:6px;overflow:hidden;border:2px solid transparent;cursor:pointer;background:#222}
.sx-th.on{border-color:#2f6df6}.sx-th img{width:100%;height:100%;object-fit:cover}.sx-th input{position:absolute;top:3px;left:3px}.sx-th i{position:absolute;right:3px;bottom:3px;font-style:normal;font-size:10px;background:#0009;border-radius:4px;padding:0 4px}
.sx-side{width:340px;max-width:44vw;background:#171c22;border-left:1px solid #26303a;display:flex;flex-direction:column;min-height:0}
.sx-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px;border-bottom:1px solid #26303a}
.sx-tabs button{background:none;border:0;color:#aab6c0;padding:6px 9px;border-radius:6px;cursor:pointer}.sx-tabs button.on{background:#26303a;color:#fff}
.sx-pane{padding:12px;overflow:auto;flex:1}
.sx-row{margin-bottom:10px}.sx-row label{display:flex;justify-content:space-between;font-size:12.5px;color:#b8c3cc;margin-bottom:2px}
.sx-row input[type=range]{width:100%}.sx-row select,.sx-row input[type=number],.sx-row input[type=text]{width:100%;background:#0f1318;color:#e8ecef;border:1px solid #33414f;border-radius:6px;padding:6px}
.sx-note{font-size:12px;color:#8fa0ad;margin:6px 0}.sx-sw{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.sx-sw button{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer}.sx-sw button.on{border-color:#fff}
.sx-pre{display:flex;gap:6px;align-items:center;margin:4px 0;background:#0f1318;border-radius:6px;padding:4px 6px}.sx-pre span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sx-prog{height:6px;background:#26303a;border-radius:4px;overflow:hidden;margin:6px 0}.sx-prog i{display:block;height:100%;background:#2f6df6;width:0}
.sx-empty{color:#8fa0ad;text-align:center;padding:40px 16px}
@media(max-width:760px){.sx-main{flex-direction:column}.sx-side{width:100%;max-width:none;max-height:46vh;border-left:0;border-top:1px solid #26303a}.sx-wrap canvas{max-height:36vh}}`;
function injectCss(){ if($('stCss')) return; const s=document.createElement('style'); s.id='stCss'; s.textContent=CSS; document.head.appendChild(s); }
/* ---------- helpers ---------- */
const cur=()=>S.items[S.cur]||null;
function imgToCanvas(img,edge){ const w0=img.naturalWidth||img.width,h0=img.naturalHeight||img.height,s=Math.min(1,edge/Math.max(w0,h0)),w=Math.max(1,Math.round(w0*s)),h=Math.max(1,Math.round(h0*s)); const c=document.createElement('canvas'); c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); return c; }
function loadImage(it){ return new Promise((res,rej)=>{ if(it.local){ createImageBitmap(it.local,{imageOrientation:'from-image'}).then(res,()=>{ const u=URL.createObjectURL(it.local),im=new Image(); im.onload=()=>res(im); im.onerror=()=>rej(new Error('Muundo wa picha hauungwi mkono')); im.src=u; }); return; }
  const im=new Image(); im.crossOrigin='anonymous'; im.onload=()=>res(im); im.onerror=()=>rej(new Error('Picha haikupakuliwa')); im.src=it.url; }); }
async function ensure(it){ if(it.prev) return it; const im=await loadImage(it); it.full=imgToCanvas(im,FULL_EDGE); const pc=imgToCanvas(it.full,PREV_EDGE); it.prev=pc.getContext('2d').getImageData(0,0,pc.width,pc.height); it.stats=E.analyze(it.prev); if(!it.P) it.P=E.defaults(); return it; }
function snapshot(){ const it=cur(); if(!it) return; const s=JSON.stringify(E.clone(it.P)); if(S.hist[S.hi]===s) return; S.hist=S.hist.slice(0,S.hi+1); S.hist.push(s); if(S.hist.length>60) S.hist.shift(); S.hi=S.hist.length-1; }
function setP(P){ const it=cur(); it.P=E.reviveLut(P); }
window.StudioUndo=function(d){ const it=cur(); if(!it) return; const n=S.hi+d; if(n<0||n>=S.hist.length) return; S.hi=n; setP(JSON.parse(S.hist[n])); render(); buildPane(); };
/* ---------- rendering ---------- */
function render(){ if(S.raf) return; S.raf=requestAnimationFrame(()=>{ S.raf=0; const it=cur(), cv=$('stCanvas'), og=$('stOrig'); if(!it||!it.prev||!cv) return;
  const o=E.process(it.prev,it.P); cv.width=o.width; cv.height=o.height; cv.getContext('2d').putImageData(new ImageData(o.data,o.width,o.height),0,0);
  og.width=it.prev.width; og.height=it.prev.height; og.getContext('2d').putImageData(it.prev,0,0);
  applyCmp(); const info=$('stInfo'); if(info) info.textContent=it.name+' · '+it.full.width+'×'+it.full.height+(it.P.__style?' · mtindo: '+(E.STYLES[it.P.__style]||{}).name:''); }); }
function applyCmp(){ const og=$('stOrig'); if(!og) return; if(S.cmp==='off'){ og.style.display='none'; } else if(S.cmp==='hold'){ og.style.display='block'; og.style.clipPath='none'; } else { og.style.display='block'; og.style.clipPath='inset(0 '+(100-S.split)+'% 0 0)'; } }
/* ---------- controls ---------- */
const SLIDERS={light:[['exposure','Exposure (EV)',-4,4,0.01],['contrast','Contrast',-100,100,1],['highlights','Highlights',-100,100,1],['shadows','Shadows',-100,100,1],['whites','Whites',-100,100,1],['blacks','Blacks',-100,100,1]],
 color:[['temp','Temperature (baridi ↔ joto)',-100,100,1],['tint','Tint (kijani ↔ pinki)',-100,100,1],['vibrance','Vibrance',-100,100,1],['saturation','Saturation',-100,100,1]],
 detail:[['clarity','Clarity',-100,100,1],['sharpness','Sharpness',0,100,1]]};
function slider(k,l,mn,mx,st,val,cb){ return `<div class="sx-row"><label><span>${l}</span><b data-v="${k}">${Number(val).toFixed(st<1?2:0)}</b></label><input type="range" min="${mn}" max="${mx}" step="${st}" value="${val}" data-k="${k}" ${cb||''}></div>`; }
const BAND_COL=['#e53935','#fb8c00','#fdd835','#43a047','#00acc1','#1e88e5','#8e24aa','#d81b60'];
function paneHtml(){ const it=cur(); if(!it) return '<div class="sx-empty">Chagua picha kutoka chini, au fungua picha kutoka kwenye kifaa chako.</div>'; const P=it.P; const t=S.tab;
  if(t==='auto'){ const opts=['auto'].concat(Object.keys(E.STYLES)); return `<div class="sx-note">AI Auto inapima mwanga, rangi na ngozi ya picha yenyewe, kisha inachagua marekebisho. Hii ni hesabu halisi ya pikseli (si kichujio cha CSS).</div>
    <div class="sx-row"><label>Mtindo</label><select id="stStyle">${opts.map(k=>`<option value="${k}" ${S.style===k?'selected':''}>${k==='auto'?'Chagua kiotomatiki kulingana na picha':E.STYLES[k].name}</option>`).join('')}</select></div>
    <div class="sx-row"><label><span>Nguvu ya mtindo</span><b id="stStrV">${S.strength}%</b></label><input type="range" min="0" max="150" value="${S.strength}" id="stStr"></div>
    <button class="sx-b pri" id="stAutoBtn" style="width:100%">✨ Auto Enhance (mbofyo mmoja)</button>
    <div class="sx-note" id="stStats">${it.stats?`Mwanga wa kati ${(it.stats.p50*100).toFixed(0)}% · ngozi ${(it.stats.skin*100).toFixed(0)}% · mwanga uliozidi ${(it.stats.clipHi*100).toFixed(1)}%`:''}</div>
    <button class="sx-b" id="stResetBtn" style="width:100%;margin-top:6px">Rudisha mipangilio yote (Reset)</button>
    <hr style="border-color:#26303a;margin:12px 0"><div class="sx-note"><b>Batch:</b> weka tiki kwenye picha chini, kisha:</div>
    <button class="sx-b" id="stBatchAuto" style="width:100%">Auto kwa zilizochaguliwa (kila picha kivyake)</button><div class="sx-prog" id="stProg" style="display:none"><i></i></div><div class="sx-note" id="stProgT"></div>`; }
  if(t==='light'||t==='color'||t==='detail') return SLIDERS[t].map(s=>slider(s[0],s[1],s[2],s[3],s[4],P[s[0]])).join('');
  if(t==='hsl'){ const i=S.band; return `<div class="sx-sw">${E.BANDS.map((b,k)=>`<button title="${b}" data-band="${k}" class="${i===k?'on':''}" style="background:${BAND_COL[k]}"></button>`).join('')}</div><div class="sx-note">${E.BANDS[i]}</div>`+
    [['h','Hue'],['s','Saturation'],['l','Luminance']].map(([c,l])=>`<div class="sx-row"><label><span>${l}</span><b data-hv="${c}">${P.hsl[c][i]}</b></label><input type="range" min="-100" max="100" value="${P.hsl[c][i]}" data-hsl="${c}"></div>`).join(''); }
  if(t==='curve'){ return `<div class="sx-sw">${['rgb','r','g','b'].map(c=>`<button data-cc="${c}" class="${S.curveCh===c?'on':''}" style="background:${{rgb:'#ccc',r:'#e53935',g:'#43a047',b:'#1e88e5'}[c]}"></button>`).join('')}</div><canvas id="stCurve" width="260" height="260" style="width:100%;max-width:260px;background:#0f1318;border-radius:6px;touch-action:none"></canvas><div class="sx-note">Gusa kuongeza nukta, buruta kuhamisha, bonyeza mara mbili kufuta.</div><button class="sx-b" id="stCurveReset">Rudisha curve</button>`; }
  if(t==='grade'){ const g=P.grade; return [['sh','Vivuli (Shadows)'],['mid','Kati (Midtones)'],['hi','Mwanga (Highlights)']].map(([z,l])=>`<div class="sx-row"><label><span>${l}</span></label><div style="display:flex;gap:6px;align-items:center"><input type="range" min="0" max="360" value="${g[z].h}" data-g="${z}h" style="flex:1"><span style="width:14px;height:14px;border-radius:50%;background:hsl(${g[z].h},100%,50%)"></span></div><input type="range" min="0" max="100" value="${g[z].s}" data-g="${z}s"></div>`).join('')+slider('gbal','Balance',-100,100,1,g.balance,'data-gb="1"'); }
  if(t==='presets'){ return `<div class="sx-note">Ingiza preset: Lightroom/Photoshop <b>.xmp</b> / <b>.lrtemplate</b>, Capture One <b>.costyle</b>, <b>.cube</b> (LUT), Photoshop curves <b>.acv</b>, au <b>.json</b> ya Studio.</div>
    <input type="file" id="stPreFile" accept=".xmp,.lrtemplate,.costyle,.cube,.acv,.json" multiple style="width:100%;color:#cfd8df">
    ${S.report?`<div class="sx-note" style="color:#cfe3ff">${S.report}</div>`:''}
    ${P.lut?`<div class="sx-row"><label><span>Nguvu ya LUT: ${esc(P.lut.name)}</span><b>${P.lutAmt}%</b></label><input type="range" min="0" max="100" value="${P.lutAmt}" id="stLutAmt"></div><button class="sx-b" id="stLutOff">Ondoa LUT</button>`:''}
    <hr style="border-color:#26303a;margin:10px 0"><div class="sx-note"><b>Presets zilizohifadhiwa</b> (kwenye kivinjari hiki)</div>
    ${S.presets.length?S.presets.map((p,i)=>`<div class="sx-pre"><span>${esc(p.name)} <i style="color:#8fa0ad">${esc(p.kind)}</i></span><button class="sx-b" data-pa="${i}">Tumia</button><button class="sx-b" data-pd="${i}">✕</button></div>`).join(''):'<div class="sx-note">Bado hakuna.</div>'}
    <button class="sx-b" id="stSavePre" style="width:100%;margin-top:8px">Hifadhi mipangilio ya sasa kama preset</button>
    <button class="sx-b" id="stExpPre" style="width:100%;margin-top:6px">Pakua preset ya sasa (.json)</button>`; }
  if(t==='export'){ return `<div class="sx-row"><label>Muundo</label><select id="stFmt"><option value="jpeg">JPEG</option><option value="png">PNG</option></select></div>
    <div class="sx-row"><label>Ubora wa JPEG</label><input type="range" min="60" max="100" value="92" id="stQ"></div>
    <div class="sx-row"><label>Ukubwa (upande mrefu)</label><select id="stSize"><option value="0">Asili (kama ilivyohifadhiwa)</option><option value="3000">3000 px (uchapishaji)</option><option value="2048">2048 px (mtandao wa juu)</option><option value="1080">1080 px (mitandao ya kijamii)</option></select></div>
    <button class="sx-b pri" id="stDl" style="width:100%">Pakua picha hii</button><button class="sx-b" id="stDlSel" style="width:100%;margin-top:6px">Pakua zilizochaguliwa (ZIP)</button><div class="sx-prog" id="stProg2" style="display:none"><i></i></div><div class="sx-note" id="stProgT2"></div>
    <hr style="border-color:#26303a;margin:10px 0"><button class="sx-b" id="stSaveEdit" style="width:100%">Hifadhi mabadiliko ya picha hii (kwenye akaunti)</button>
    <div class="sx-note">Picha ya asili haibadilishwi. Mabadiliko yanahifadhiwa kama maelezo, na unaweza kuendelea baadaye. Picha zilizohifadhiwa kwenye Collections tayari zimepunguzwa hadi 2000px wakati wa kupakia; picha kutoka kifaa chako zinatumika kwa ukubwa kamili (hadi 4096px).</div>`; }
  return ''; }
const TABS=[['auto','AI Auto'],['light','Mwanga'],['color','Rangi'],['hsl','HSL'],['curve','Curve'],['grade','Grade'],['detail','Maelezo'],['presets','Presets'],['export','Pakua']];
function buildPane(){ const side=$('stPane'); if(!side) return; $('stTabs').innerHTML=TABS.map(([k,n])=>`<button data-t="${k}" class="${S.tab===k?'on':''}">${n}</button>`).join(''); side.innerHTML=paneHtml(); wirePane(); if(S.tab==='curve') drawCurve(); }
function wirePane(){ const it=cur(); const side=$('stPane'); if(!it) return;
  side.querySelectorAll('input[data-k]').forEach(el=>{ el.oninput=()=>{ const k=el.dataset.k; it.P[k]=parseFloat(el.value); const b=side.querySelector('[data-v="'+k+'"]'); if(b) b.textContent=Number(el.value).toFixed(parseFloat(el.step)<1?2:0); render(); }; el.onchange=()=>snapshot(); });
  side.querySelectorAll('[data-band]').forEach(b=>b.onclick=()=>{ S.band=+b.dataset.band; buildPane(); });
  side.querySelectorAll('input[data-hsl]').forEach(el=>{ el.oninput=()=>{ const c=el.dataset.hsl; it.P.hsl[c][S.band]=parseFloat(el.value); const b=side.querySelector('[data-hv="'+c+'"]'); if(b) b.textContent=el.value; render(); }; el.onchange=()=>snapshot(); });
  side.querySelectorAll('input[data-g]').forEach(el=>{ el.oninput=()=>{ const z=el.dataset.g.slice(0,-1), c=el.dataset.g.slice(-1); it.P.grade[z][c]=parseFloat(el.value); render(); }; el.onchange=()=>{ snapshot(); if(el.dataset.g.endsWith('h')) buildPane(); }; });
  const gb=side.querySelector('input[data-gb]'); if(gb){ gb.oninput=()=>{ it.P.grade.balance=parseFloat(gb.value); render(); }; gb.onchange=()=>snapshot(); }
  side.querySelectorAll('[data-cc]').forEach(b=>b.onclick=()=>{ S.curveCh=b.dataset.cc; buildPane(); });
  const q=id=>side.querySelector('#'+id);
  if(q('stStyle')) q('stStyle').onchange=e=>{ S.style=e.target.value; };
  if(q('stStr')) q('stStr').oninput=e=>{ S.strength=+e.target.value; q('stStrV').textContent=S.strength+'%'; };
  if(q('stAutoBtn')) q('stAutoBtn').onclick=()=>{ it.P=E.autoParams(it.stats,S.style,S.strength/100); snapshot(); render(); buildPane(); };
  if(q('stResetBtn')) q('stResetBtn').onclick=()=>{ it.P=E.defaults(); snapshot(); render(); buildPane(); };
  if(q('stBatchAuto')) q('stBatchAuto').onclick=batchAuto;
  if(q('stCurveReset')) q('stCurveReset').onclick=()=>{ if(it.P.curve) it.P.curve[S.curveCh]=[]; snapshot(); render(); drawCurve(); };
  if(q('stPreFile')) q('stPreFile').onchange=e=>importPresets([...e.target.files]);
  if(q('stLutAmt')) { q('stLutAmt').oninput=e=>{ it.P.lutAmt=+e.target.value; render(); }; q('stLutAmt').onchange=()=>snapshot(); }
  if(q('stLutOff')) q('stLutOff').onclick=()=>{ it.P.lut=null; snapshot(); render(); buildPane(); };
  side.querySelectorAll('[data-pa]').forEach(b=>b.onclick=()=>{ const p=S.presets[+b.dataset.pa]; E.applyPreset(it.P,p); it.P.__style=null; snapshot(); render(); buildPane(); toast('Preset imetumika: '+p.name); });
  side.querySelectorAll('[data-pd]').forEach(b=>b.onclick=()=>{ S.presets.splice(+b.dataset.pd,1); savePresets(); buildPane(); });
  if(q('stSavePre')) q('stSavePre').onclick=()=>{ const n=prompt('Jina la preset:','My look'); if(!n) return; const P=E.clone(it.P); delete P.__style; if(P.lut){ P.lut.data=Float32Array.from(P.lut.data); } S.presets.push({name:n,kind:'studio',P}); savePresets(); buildPane(); };
  if(q('stExpPre')) q('stExpPre').onclick=()=>{ const P=E.clone(it.P); delete P.__style; dl(new Blob([JSON.stringify({studio:1,name:'Studio preset',P:Object.assign({},P,{lut:null})},null,1)],{type:'application/json'}),'studio-preset.json'); };
  if(q('stDl')) q('stDl').onclick=()=>exportOne();
  if(q('stDlSel')) q('stDlSel').onclick=exportZip;
  if(q('stSaveEdit')) q('stSaveEdit').onclick=saveEdit;
}
/* ---------- curve editor ---------- */
function drawCurve(){ const cv=$('stCurve'); const it=cur(); if(!cv||!it) return; const c=cv.getContext('2d'), W=cv.width; c.clearRect(0,0,W,W); c.strokeStyle='#26303a'; for(let i=1;i<4;i++){ c.beginPath(); c.moveTo(i*W/4,0); c.lineTo(i*W/4,W); c.moveTo(0,i*W/4); c.lineTo(W,i*W/4); c.stroke(); }
  const pts=(it.P.curve&&it.P.curve[S.curveCh])||[]; const lut=E.curveLut(pts); c.strokeStyle={rgb:'#ddd',r:'#e53935',g:'#43a047',b:'#1e88e5'}[S.curveCh]; c.lineWidth=2; c.beginPath(); for(let x=0;x<256;x++){ const px=x/255*W, py=W-lut[x]*W; x?c.lineTo(px,py):c.moveTo(px,py); } c.stroke();
  c.fillStyle='#fff'; pts.forEach(p=>{ c.beginPath(); c.arc(p[0]/255*W,W-p[1]/255*W,5,0,7); c.fill(); });
  if(cv._w) return; cv._w=1; let drag=-1; const pos=e=>{ const r=cv.getBoundingClientRect(); return [Math.round(Math.min(255,Math.max(0,(e.clientX-r.left)/r.width*255))),Math.round(Math.min(255,Math.max(0,255-(e.clientY-r.top)/r.height*255)))]; };
  const arr=()=>{ const P=cur().P; if(!P.curve) P.curve={rgb:[],r:[],g:[],b:[]}; return P.curve[S.curveCh]||(P.curve[S.curveCh]=[]); };
  cv.onpointerdown=e=>{ const p=pos(e), a=arr(); drag=a.findIndex(q=>Math.abs(q[0]-p[0])<10&&Math.abs(q[1]-p[1])<10); if(drag<0){ a.push(p); a.sort((x,y)=>x[0]-y[0]); drag=a.indexOf(p); } cv.setPointerCapture(e.pointerId); drawCurve(); render(); };
  cv.onpointermove=e=>{ if(drag<0) return; const a=arr(), p=pos(e); const lo=drag>0?a[drag-1][0]+1:0, hi2=drag<a.length-1?a[drag+1][0]-1:255; a[drag]=[Math.min(hi2,Math.max(lo,p[0])),p[1]]; drawCurve(); render(); };
  cv.onpointerup=()=>{ if(drag>=0){ drag=-1; snapshot(); } };
  cv.ondblclick=e=>{ const p=pos(e), a=arr(), i=a.findIndex(q=>Math.abs(q[0]-p[0])<10&&Math.abs(q[1]-p[1])<10); if(i>=0){ a.splice(i,1); snapshot(); drawCurve(); render(); } };
}
/* ---------- presets import ---------- */
async function importPresets(files){ const msgs=[]; for(const f of files){ const ext=(f.name.split('.').pop()||'').toLowerCase(); try{
    let res=null; if(ext==='acv') res=E.parseACV(await f.arrayBuffer()); else { const text=await f.text();
      if(ext==='cube') res=E.parseCube(text); else if(ext==='costyle') res=E.parseCOStyle(text); else if(ext==='xmp'||ext==='lrtemplate') res=E.parseLR(text);
      else if(ext==='json'){ const j=JSON.parse(text); if(!j.P) throw new Error('JSON si preset ya Studio'); res={kind:'studio',P:j.P,ok:1,ignored:[]}; } else throw new Error('Aina ya faili haitambuliki'); }
    if(res.kind==='lightroom'&&!res.ok&&!Object.keys(res.P).length) throw new Error('Hakuna mipangilio inayotambulika kwenye faili hili.');
    const name=f.name.replace(/\.[^.]+$/,''); const p=res.kind==='lut'?{name,kind:'lut',lut:res.lut}:{name,kind:res.kind,P:res.P}; S.presets.push(p); savePresets(); const it=cur(); if(it){ E.applyPreset(it.P,p); it.P.__style=null; snapshot(); render(); }
    msgs.push('✓ '+esc(name)+' ('+res.kind+')'+(res.ok!=null?': '+res.ok+' mipangilio imetambuliwa':'')+((res.ignored&&res.ignored.length)?'; imepuuzwa: '+esc(res.ignored.slice(0,12).join(', '))+(res.ignored.length>12?'…':''):'')+(res.note?'<br>'+esc(res.note):''));
  }catch(e){ msgs.push('✗ '+esc(f.name)+': '+esc(e.message||e)); } }
  S.report=msgs.join('<br>'); buildPane(); }
/* ---------- export ---------- */
const dl=(blob,name)=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
function fmtOpts(){ const f=($('stFmt')||{}).value||'jpeg', q=(+($('stQ')||{}).value||92)/100, sz=+(($('stSize')||{}).value||0); return {f,q,sz}; }
async function renderFull(it,sz){ await ensure(it); let c=it.full; if(sz&&Math.max(c.width,c.height)>sz){ const s=sz/Math.max(c.width,c.height); const t=document.createElement('canvas'); t.width=Math.round(c.width*s); t.height=Math.round(c.height*s); const x=t.getContext('2d'); x.imageSmoothingQuality='high'; x.drawImage(c,0,0,t.width,t.height); c=t; }
  const id=c.getContext('2d').getImageData(0,0,c.width,c.height), o=E.process(id,it.P); const out=document.createElement('canvas'); out.width=o.width; out.height=o.height; out.getContext('2d').putImageData(new ImageData(o.data,o.width,o.height),0,0); return out; }
const blobOf=(c,f,q)=>new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('Imeshindwa kutengeneza faili')),f==='png'?'image/png':'image/jpeg',q));
async function exportOne(){ const it=cur(); if(!it) return; const o=fmtOpts(); try{ toast('Naandaa picha…'); const c=await renderFull(it,o.sz); const b=await blobOf(c,o.f,o.q); dl(b,it.name.replace(/\.[^.]+$/,'')+'-studio.'+(o.f==='png'?'png':'jpg')); }catch(e){ toast('Imeshindwa: '+(e.message||e)); } }
async function exportZip(){ const sel=S.items.filter(i=>i.sel); if(!sel.length) return toast('Weka tiki kwenye picha unazotaka.'); if(!window.JSZip) return toast('JSZip haijapakuliwa. Jaribu tena.'); const o=fmtOpts(), zip=new JSZip(); const bar=$('stProg2'),t=$('stProgT2'); if(bar) bar.style.display='block';
  for(let i=0;i<sel.length;i++){ const it=sel[i]; try{ await ensure(it); if(!it.edited&&!it.P.__touched&&it.P.exposure===0&&it.stats){ it.P=E.autoParams(it.stats,S.style,S.strength/100); } const c=await renderFull(it,o.sz); zip.file(String(i+1).padStart(3,'0')+'-'+it.name.replace(/\.[^.]+$/,'')+'.'+(o.f==='png'?'png':'jpg'),await blobOf(c,o.f,o.q)); }catch(e){ console.warn(e); }
    if(bar) bar.firstElementChild.style.width=((i+1)/sel.length*100)+'%'; if(t) t.textContent=(i+1)+' kati ya '+sel.length; await new Promise(r=>setTimeout(r,10)); }
  dl(await zip.generateAsync({type:'blob'}),'studio-picha.zip'); if(t) t.textContent='Imekamilika.'; }
async function batchAuto(){ const sel=S.items.filter(i=>i.sel); if(!sel.length) return toast('Weka tiki kwenye picha kwanza.'); const bar=$('stProg'),t=$('stProgT'); if(bar) bar.style.display='block';
  for(let i=0;i<sel.length;i++){ const it=sel[i]; try{ await ensure(it); it.P=E.autoParams(it.stats,S.style,S.strength/100); it.edited=1; }catch(e){ console.warn(e); } if(bar) bar.firstElementChild.style.width=((i+1)/sel.length*100)+'%'; if(t) t.textContent=(i+1)+' kati ya '+sel.length; await new Promise(r=>setTimeout(r,10)); }
  const c=cur(); if(c&&c.sel){ snapshot(); render(); } if(t) t.textContent='Imekamilika: kila picha imechambuliwa kivyake. Bonyeza picha uone, kisha Export.'; }
/* ---------- DB (admin-only table) ---------- */
function dbParams(P){ const o=E.clone(P); delete o.__style; if(o.lut){ o.lutName=o.lut.name; o.lut=null; } return o; }
async function saveEdit(){ const it=cur(); if(!it||!it.id||it.local) return toast('Hifadhi inafanya kazi kwa picha za Collection pekee.'); try{ const r=await supabaseClient.from('photo_edits').upsert({photo_id:it.id,params:dbParams(it.P),updated_at:new Date().toISOString()}); if(r.error) throw r.error; toast('Mabadiliko yamehifadhiwa.'); }catch(e){ toast('Haikuhifadhiwa: '+(e.message||e)); } }
async function loadEdit(it){ if(!it.id||it.local||it.dbTried) return; it.dbTried=1; try{ const r=await supabaseClient.from('photo_edits').select('params').eq('photo_id',it.id).maybeSingle(); if(r.data&&r.data.params){ const P=Object.assign(E.defaults(),r.data.params); if(P.lutName){ const pr=S.presets.find(p=>p.lut&&p.lut.name===P.lutName); P.lut=pr?pr.lut:null; } it.P=E.sanitize(P); it.edited=1; } }catch(e){} }
/* ---------- open / select ---------- */
async function select(i){ S.cur=i; S.hist=[]; S.hi=-1; const it=cur(); renderStrip(); if(!it) return; $('stView').classList.add('busy'); try{ await ensure(it); await loadEdit(it); }catch(e){ toast('Picha haikufunguka: '+(e.message||e)); return; }
  if(!it.edited&&it.P.exposure===0&&!it.P.contrast&&it.stats&&!it.autoDone){ it.P=E.autoParams(it.stats,S.style,S.strength/100); it.autoDone=1; }
  snapshot(); buildPane(); render(); }
function renderStrip(){ const st=$('stStrip'); if(!st) return; st.innerHTML=S.items.length?S.items.map((it,i)=>`<div class="sx-th ${i===S.cur?'on':''}" data-i="${i}"><img src="${esc(it.thumb||'')}" alt=""><input type="checkbox" data-s="${i}" ${it.sel?'checked':''}>${it.edited?'<i>✓</i>':''}</div>`).join(''):'<div class="sx-note">Hakuna picha. Bonyeza "Fungua picha kutoka kifaa".</div>';
  st.querySelectorAll('.sx-th').forEach(el=>el.onclick=e=>{ if(e.target.tagName==='INPUT'){ S.items[+e.target.dataset.s].sel=e.target.checked; return; } select(+el.dataset.i); }); }

/* ---------- RAW (CR2/NEF/ARW/DNG/...): use the camera's embedded full-size JPEG preview ---------- */
const RAWEXT=/\.(cr2|cr3|nef|nrw|arw|srf|sr2|dng|orf|rw2|raf|pef|srw)$/i;
function tiffPreview(buf){ const dv=new DataView(buf), n=buf.byteLength; if(n<16) return null; const le=dv.getUint16(0)===0x4949; if(!le&&dv.getUint16(0)!==0x4d4d) return null;
  const u16=o=>dv.getUint16(o,le), u32=o=>dv.getUint32(o,le), cand=[]; let orient=1; const seen=new Set();
  const val=(type,cnt,o)=>{ const sz=type===3?2:type===4?4:type===1?1:0; if(!sz) return []; const base=cnt*sz<=4?o+8:u32(o+8), out=[]; for(let i=0;i<Math.min(cnt,16);i++){ const p=(cnt*sz<=4?o+8:base)+i*sz; if(p+sz>n) break; out.push(type===3?u16(p):type===4?u32(p):dv.getUint8(p)); } return out; };
  const walk=(off,first,depth)=>{ if(!off||off+2>n||seen.has(off)||depth>6||seen.size>14) return; seen.add(off); const cnt=u16(off); if(cnt>400) return; const t={}; for(let i=0;i<cnt;i++){ const o=off+2+i*12; if(o+12>n) break; t[u16(o)]=[u16(o+2),u32(o+4),o]; }
    const get=k=>t[k]?val(t[k][0],t[k][1],t[k][2]):[]; if(first&&t[0x112]) orient=get(0x112)[0]||1;
    const comp=(get(0x103)[0]); const so=get(0x111), sb=get(0x117), jo=get(0x201)[0], jl=get(0x202)[0];
    if(jo&&jl) cand.push([jo,jl]); else if((comp===6||comp===7)&&so.length===1&&sb.length===1) cand.push([so[0],sb[0]]);
    get(0x14a).forEach(s=>walk(s,false,depth+1)); get(0x8769).forEach(s=>walk(s,false,depth+1)); const next=u32(off+2+cnt*12); if(next) walk(next,false,depth+1); };
  walk(u32(4),true,0); const ok=cand.filter(([o,l])=>l>5000&&o+l<=n&&dv.getUint8(o)===0xff&&dv.getUint8(o+1)===0xd8).sort((a,b)=>b[1]-a[1]);
  return ok.length?{blob:new Blob([buf.slice(ok[0][0],ok[0][0]+ok[0][1])],{type:'image/jpeg'}),orient}:{blob:null,orient}; }
function scanJpegs(buf){ const u=new Uint8Array(buf), starts=[]; for(let i=0;i<u.length-3;i++){ if(u[i]===0xff&&u[i+1]===0xd8&&u[i+2]===0xff) starts.push(i); } const out=[]; for(let k=0;k<starts.length;k++){ const a=starts[k], b=k+1<starts.length?starts[k+1]:u.length; if(b-a>20000) out.push([a,b-a]); } out.sort((x,y)=>y[1]-x[1]); return out.slice(0,4).map(([a,l])=>new Blob([buf.slice(a,a+l)],{type:'image/jpeg'})); }
async function rawToJpegFile(file){ const buf=await file.arrayBuffer(); let pv=null,orient=1; try{ pv=tiffPreview(buf); orient=pv.orient||1; }catch(e){}
  const blobs=[]; if(pv&&pv.blob) blobs.push(pv.blob); scanJpegs(buf).forEach(b=>blobs.push(b)); let bmp=null;
  for(const b of blobs){ try{ bmp=await createImageBitmap(b,{imageOrientation:'none'}); if(bmp.width>=800) break; }catch(e){ bmp=null; } }
  if(!bmp) throw new Error('Sijapata picha ya onyesho ndani ya faili hili la RAW ('+file.name+').');
  const s=Math.min(1,FULL_EDGE/Math.max(bmp.width,bmp.height)), w=Math.round(bmp.width*s), h=Math.round(bmp.height*s), rot=[5,6,7,8].includes(orient), c=document.createElement('canvas'); c.width=rot?h:w; c.height=rot?w:h; const x=c.getContext('2d');
  const tr={2:[-1,0,0,1,w,0],3:[-1,0,0,-1,w,h],4:[1,0,0,-1,0,h],5:[0,1,1,0,0,0],6:[0,1,-1,0,h,0],7:[0,-1,-1,0,h,w],8:[0,-1,1,0,0,w]}[orient]; if(tr) x.setTransform(...tr); x.drawImage(bmp,0,0,w,h); if(bmp.close) bmp.close();
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.95)); if(!blob) throw new Error('Imeshindwa kubadilisha RAW.');
  const t=document.createElement('canvas'), ts=Math.min(1,160/Math.max(c.width,c.height)); t.width=Math.round(c.width*ts); t.height=Math.round(c.height*ts); t.getContext('2d').drawImage(c,0,0,t.width,t.height);
  return {file:new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}),thumb:t.toDataURL('image/jpeg',0.7),w:c.width,h:c.height}; }
async function addLocal(files){ const list=[...files].filter(f=>/^image\//.test(f.type)||/\.(jpe?g|png|webp)$/i.test(f.name)||RAWEXT.test(f.name)); let first=S.items.length, done=0;
  for(const f of list){ try{ if(RAWEXT.test(f.name)){ toast('RAW '+(++done)+'/'+list.filter(x=>RAWEXT.test(x.name)).length+': '+f.name); const r=await rawToJpegFile(f); S.items.push({id:null,name:f.name.replace(/\.[^.]+$/,'')+'.jpg',local:r.file,thumb:r.thumb,raw:true,P:E.defaults()}); }
      else S.items.push({id:null,name:f.name,local:f,thumb:URL.createObjectURL(f),P:E.defaults()}); }catch(e){ toast(f.name+': '+(e.message||e)); }
    renderStrip(); if(S.cur<0&&S.items.length) select(first); }
  if(list.some(f=>RAWEXT.test(f.name))) toast('RAW imesomwa kupitia picha ya onyesho ya kamera (si RAW kamili).'); }
function build(){ injectCss(); let r=$('stRoot'); if(r) r.remove(); r=document.createElement('div'); r.id='stRoot';
  r.innerHTML=`<div class="sx-top"><b>✨ Studio <small style="color:#8fa0ad;font-weight:400">(majaribio: kwa mmiliki tu)</small></b><span id="stInfo" class="sx-note" style="margin:0"></span><span class="sp"></span>
   <button class="sx-b" onclick="StudioUndo(-1)" title="Undo">↶</button><button class="sx-b" onclick="StudioUndo(1)" title="Redo">↷</button>
   <button class="sx-b" id="stHold">Linganisha (shikilia)</button><button class="sx-b" id="stSplit">Gawanya</button>
   <label class="sx-b" style="display:inline-flex;align-items:center">Fungua picha kutoka kifaa<input type="file" id="stLocal" accept="image/*,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.orf,.rw2,.raf,.pef,.srw" multiple hidden></label>
   <button class="sx-b pri" onclick="Studio.close()">Funga</button></div>
   <div class="sx-main"><div class="sx-stage"><div class="sx-view" id="stView"><div class="sx-wrap"><canvas id="stCanvas" width="2" height="2"></canvas><canvas id="stOrig" width="2" height="2" style="display:none"></canvas></div></div>
   <div class="sx-note" style="padding:0 12px"><input type="range" id="stSplitR" min="0" max="100" value="50" style="width:200px;display:none"></div><div class="sx-strip" id="stStrip"></div></div>
   <div class="sx-side"><div class="sx-tabs" id="stTabs"></div><div class="sx-pane" id="stPane"></div></div></div>`;
  document.body.appendChild(r);
  $('stTabs').onclick=e=>{ const b=e.target.closest('[data-t]'); if(b){ S.tab=b.dataset.t; buildPane(); } };
  const hold=$('stHold'); const on=()=>{ S.cmp='hold'; applyCmp(); }, off=()=>{ S.cmp='off'; applyCmp(); };
  hold.onpointerdown=on; hold.onpointerup=off; hold.onpointerleave=off;
  $('stSplit').onclick=()=>{ S.cmp=S.cmp==='split'?'off':'split'; $('stSplitR').style.display=S.cmp==='split'?'inline-block':'none'; applyCmp(); };
  $('stSplitR').oninput=e=>{ S.split=+e.target.value; applyCmp(); };
  $('stLocal').onchange=e=>{ addLocal(e.target.files); e.target.value=''; };
  document.addEventListener('keydown',keys); }
function keys(e){ if(!S.open) return; if(e.key==='Escape') Studio.close(); if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); StudioUndo(e.shiftKey?1:-1); } }
window.Studio={
  open(){ if(!isOwner()){ toast('Studio ni ya mmiliki tu kwa sasa.'); return; } loadPresets(); S.open=true; S.items=[]; S.cur=-1;
    try{ const ph=(typeof CO!=='undefined'&&CO.photos&&CO.photos[CO.cur])||[]; ph.forEach(p=>S.items.push({id:p.id,name:'photo-'+String(p.id).slice(0,6)+'.jpg',url:p.url,thumb:p.thumb_url||p.url,P:E.defaults()})); }catch(e){}
    build(); renderStrip(); buildPane(); if(S.items.length) select(0); },
  close(){ S.open=false; const r=$('stRoot'); if(r) r.remove(); document.removeEventListener('keydown',keys); },
  _S:S
};
})();
