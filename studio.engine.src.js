/* ===== SHEREHE STUDIO engine: real pixel processing (no CSS filters) ===== */
(function(g){
'use strict';
const clamp=(x,a,b)=>x<a?a:x>b?b:x;
const S2L=new Float32Array(256); for(let i=0;i<256;i++){const c=i/255; S2L[i]=c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
const L2S_N=4096, L2S=new Float32Array(L2S_N+1); for(let i=0;i<=L2S_N;i++){const v=i/L2S_N; L2S[i]=v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055;}
const l2s=v=>L2S[(v<0?0:v>1?4095.99:v*L2S_N)|0];
const BANDS=['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta'];
const BAND_H=[0,30,60,120,180,240,275,320];
function defaults(){return{exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,temp:0,tint:0,vibrance:0,saturation:0,clarity:0,sharpness:0,
 hsl:{h:Array(8).fill(0),s:Array(8).fill(0),l:Array(8).fill(0)},curve:null,
 grade:{sh:{h:0,s:0},mid:{h:0,s:0},hi:{h:0,s:0},balance:0},lut:null,lutAmt:100,skinProtect:true};}
const clone=o=>JSON.parse(JSON.stringify(o,(k,v)=>k==='lut'&&v?{name:v.name,size:v.size,data:Array.from(v.data)}:v));
function reviveLut(P){ if(P&&P.lut&&!(P.lut.data instanceof Float32Array)) P.lut.data=Float32Array.from(P.lut.data); return P; }
const NUMK=['exposure','contrast','highlights','shadows','whites','blacks','temp','tint','vibrance','saturation','clarity','sharpness'];
function addDelta(P,D,k){ /* P += D*k (numeric fields, hsl, grade) */
  k=k==null?1:k; NUMK.forEach(n=>{ if(D[n]) P[n]+=D[n]*k; });
  if(D.hsl) ['h','s','l'].forEach(c=>{ if(D.hsl[c]) for(let i=0;i<8;i++) P.hsl[c][i]+=(D.hsl[c][i]||0)*k; });
  if(D.grade){ ['sh','mid','hi'].forEach(z=>{ const d=D.grade[z]; if(d&&d.s){ const t=P.grade[z]; if(!t.s){t.h=d.h;t.s=d.s*k;} else {t.s=clamp(t.s+d.s*k,0,100);} } }); if(D.grade.balance) P.grade.balance+=D.grade.balance*k; }
  return P;}
function sanitize(P){ const L={exposure:[-5,5],contrast:[-100,100],highlights:[-100,100],shadows:[-100,100],whites:[-100,100],blacks:[-100,100],temp:[-100,100],tint:[-100,100],vibrance:[-100,100],saturation:[-100,100],clarity:[-100,100],sharpness:[0,100]};
  NUMK.forEach(n=>{P[n]=clamp(+P[n]||0,L[n][0],L[n][1]);}); ['h','s','l'].forEach(c=>{for(let i=0;i<8;i++)P.hsl[c][i]=clamp(+P.hsl[c][i]||0,-100,100);}); return P;}
/* ---- curves ---- */
function curveLut(pts){ const a=[[0,0]].concat((pts||[]).filter(p=>p[0]>0&&p[0]<255)).concat([[255,255]]); if(pts&&pts.length){ const f=pts.find(p=>p[0]<=0), l=pts.find(p=>p[0]>=255); if(f) a[0]=[0,f[1]]; if(l) a[a.length-1]=[255,l[1]]; }
  a.sort((p,q)=>p[0]-q[0]); const n=a.length, xs=a.map(p=>p[0]), ys=a.map(p=>p[1]), d=new Array(n).fill(0), m=[];
  for(let i=0;i<n-1;i++) m[i]=(ys[i+1]-ys[i])/((xs[i+1]-xs[i])||1);
  d[0]=m[0]; d[n-1]=m[n-2]; for(let i=1;i<n-1;i++) d[i]=(m[i-1]*m[i]<=0)?0:(m[i-1]+m[i])/2;
  for(let i=0;i<n-1;i++){ if(m[i]===0){d[i]=0;d[i+1]=0;continue;} const a1=d[i]/m[i], b1=d[i+1]/m[i], s=a1*a1+b1*b1; if(s>9){const t=3/Math.sqrt(s); d[i]=t*a1*m[i]; d[i+1]=t*b1*m[i];} }
  const lut=new Float32Array(256); let j=0;
  for(let x=0;x<256;x++){ while(j<n-2&&x>xs[j+1]) j++; const h=(xs[j+1]-xs[j])||1, t=(x-xs[j])/h, t2=t*t, t3=t2*t;
    const v=(2*t3-3*t2+1)*ys[j]+(t3-2*t2+t)*h*d[j]+(-2*t3+3*t2)*ys[j+1]+(t3-t2)*h*d[j+1]; lut[x]=clamp(v/255,0,1); }
  return lut;}
/* ---- colour helpers ---- */
function rgb2hsl(r,g,b){ const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2; let h=0,s=0; const d=mx-mn;
  if(d>1e-6){ s=l>0.5?d/(2-mx-mn):d/(mx+mn); if(mx===r) h=((g-b)/d+(g<b?6:0)); else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; } return [h,s,l];}
function hue2rgb(p,q,t){ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p;}
function hsl2rgb(h,s,l){ h=((h%360)+360)%360/360; if(s<=1e-6) return [l,l,l]; const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q; return [hue2rgb(p,q,h+1/3),hue2rgb(p,q,h),hue2rgb(p,q,h-1/3)];}
function hueColor(h){ return hsl2rgb(h,1,0.5); }
/* ---- 3D LUT (.cube) ---- */
function lutSample(L,r,g,b,out){ const n=L.size, m=n-1, d=L.data; r=clamp(r,0,1)*m; g=clamp(g,0,1)*m; b=clamp(b,0,1)*m;
  const r0=r|0,g0=g|0,b0=b|0, r1=Math.min(r0+1,m),g1=Math.min(g0+1,m),b1=Math.min(b0+1,m), fr=r-r0,fg=g-g0,fb=b-b0;
  const idx=(R,G,B)=>((B*n+G)*n+R)*3;
  for(let c=0;c<3;c++){ const c000=d[idx(r0,g0,b0)+c],c100=d[idx(r1,g0,b0)+c],c010=d[idx(r0,g1,b0)+c],c110=d[idx(r1,g1,b0)+c],c001=d[idx(r0,g0,b1)+c],c101=d[idx(r1,g0,b1)+c],c011=d[idx(r0,g1,b1)+c],c111=d[idx(r1,g1,b1)+c];
    const c00=c000+(c100-c000)*fr,c10=c010+(c110-c010)*fr,c01=c001+(c101-c001)*fr,c11=c011+(c111-c011)*fr; const c0=c00+(c10-c00)*fg,c1=c01+(c11-c01)*fg; out[c]=c0+(c1-c0)*fb; } }
/* ---- blur (3x box ≈ gaussian) on a float plane ---- */
function boxBlur(src,w,h,r){ const tmp=new Float32Array(w*h), out=new Float32Array(w*h); r=Math.max(1,r|0);
  for(let y=0;y<h;y++){ let acc=0; const o=y*w; for(let x=-r;x<=r;x++) acc+=src[o+clamp(x,0,w-1)]; for(let x=0;x<w;x++){ tmp[o+x]=acc/(2*r+1); acc+=src[o+Math.min(x+r+1,w-1)]-src[o+Math.max(x-r,0)]; } }
  for(let x=0;x<w;x++){ let acc=0; for(let y=-r;y<=r;y++) acc+=tmp[clamp(y,0,h-1)*w+x]; for(let y=0;y<h;y++){ out[y*w+x]=acc/(2*r+1); acc+=tmp[Math.min(y+r+1,h-1)*w+x]-tmp[Math.max(y-r,0)*w+x]; } }
  return out;}
function gauss(src,w,h,r){ let a=boxBlur(src,w,h,r); a=boxBlur(a,w,h,r); return boxBlur(a,w,h,r); }
/* ---- main pipeline ---- */
function process(img,P,opt){
  P=sanitize(reviveLut(P)); const w=img.width,h=img.height,src=img.data, out=new Uint8ClampedArray(src.length), N=w*h;
  const ev=Math.pow(2,P.exposure), rm=(1+0.0035*P.temp)*ev, bm=(1-0.0035*P.temp)*ev, gm=(1-0.003*P.tint)*ev;
  const sh=P.shadows/100, hi=P.highlights/100, wh=P.whites/100, bl=P.blacks/100, ct=P.contrast/100;
  const sat=P.saturation/100, vib=P.vibrance/100;
  const hasHsl=['h','s','l'].some(c=>P.hsl[c].some(v=>v)), hasGrade=['sh','mid','hi'].some(z=>P.grade[z].s>0);
  const cm=P.curve&&P.curve.rgb&&P.curve.rgb.length?curveLut(P.curve.rgb):null, cr=P.curve&&P.curve.r&&P.curve.r.length?curveLut(P.curve.r):null, cg=P.curve&&P.curve.g&&P.curve.g.length?curveLut(P.curve.g):null, cb=P.curve&&P.curve.b&&P.curve.b.length?curveLut(P.curve.b):null;
  const gc={}; ['sh','mid','hi'].forEach(z=>{ const c=hueColor(P.grade[z].h); gc[z]=[c[0]-0.5,c[1]-0.5,c[2]-0.5]; });
  const lut=P.lut&&P.lutAmt>0?P.lut:null, la=P.lutAmt/100, lo=[0,0,0];
  const needDetail=P.clarity||P.sharpness; const luma=needDetail?new Float32Array(N):null;
  for(let i=0,p=0;i<N;i++,p+=4){
    let r=l2s(S2L[src[p]]*rm), g=l2s(S2L[src[p+1]]*gm), b=l2s(S2L[src[p+2]]*bm);
    let Y=0.2126*r+0.7152*g+0.0722*b;
    if(sh||hi||wh||bl){ const w1=1-Y; let gain=1+sh*0.7*w1*w1*w1+hi*0.5*Y*Y*Y; if(wh) gain+=wh*0.3*Y*Y*Y*Y; if(gain<0.05)gain=0.05; r*=gain;g*=gain;b*=gain; if(bl){ const lift=bl*0.12*w1*w1*w1*w1; r+=lift;g+=lift;b+=lift; } }
    if(ct){ const k=ct*1.15; r+=k*(r*r*(3-2*r)-r); g+=k*(g*g*(3-2*g)-g); b+=k*(b*b*(3-2*b)-b); }
    r=r<0?0:r>1?1:r; g=g<0?0:g>1?1:g; b=b<0?0:b>1?1:b;
    if(cm||cr||cg||cb){ let ri=(r*255+.5)|0, gi=(g*255+.5)|0, bi=(b*255+.5)|0; if(cm){ r=cm[ri]; g=cm[gi]; b=cm[bi]; ri=(r*255+.5)|0; gi=(g*255+.5)|0; bi=(b*255+.5)|0; } if(cr) r=cr[ri]; if(cg) g=cg[gi]; if(cb) b=cb[bi]; }
    if(sat||vib||hasHsl){
      const hsl=rgb2hsl(r,g,b); let H=hsl[0],S=hsl[1],Lm=hsl[2];
      if(S>0.001){
        let sk=0; if(P.skinProtect&&H>=5&&H<=50) sk=1-Math.abs(H-27)/23;
        if(hasHsl){ let dh=0,ds=0,dl=0; for(let k=0;k<8;k++){ let d=Math.abs(H-BAND_H[k]); if(d>180)d=360-d; const wgt=d<40?1-d/40:0; if(wgt>0){ dh+=wgt*P.hsl.h[k]; ds+=wgt*P.hsl.s[k]; dl+=wgt*P.hsl.l[k]; } } H+=dh*0.3; S=clamp(S*(1+ds/100),0,1); Lm=clamp(Lm+dl/100*0.25*S,0,1); }
        let sf=1+sat; if(vib){ const vv=vib>=0?vib*(1-S)*(1-0.6*sk):vib*S; sf+=vv*1.2; } S=clamp(S*sf,0,1);
        const c=hsl2rgb(H,S,Lm); r=c[0];g=c[1];b=c[2];
      }
    }
    if(hasGrade){ Y=0.2126*r+0.7152*g+0.0722*b; const bal=P.grade.balance/200; let ws=clamp(1-(Y+bal)*1.6,0,1), wi=clamp((Y+bal)*1.6-0.6,0,1), wm=clamp(1-ws-wi,0,1)*0.9;
      const a=0.18; ['sh','mid','hi'].forEach(z=>{ const s=P.grade[z].s/100; if(!s) return; const wz=z==='sh'?ws:z==='hi'?wi:wm, q=a*s*wz; r+=gc[z][0]*q; g+=gc[z][1]*q; b+=gc[z][2]*q; }); }
    if(lut){ lutSample(lut,r,g,b,lo); r+=(lo[0]-r)*la; g+=(lo[1]-g)*la; b+=(lo[2]-b)*la; }
    if(luma) luma[i]=0.2126*r+0.7152*g+0.0722*b;
    out[p]=r*255+.5; out[p+1]=g*255+.5; out[p+2]=b*255+.5; out[p+3]=src[p+3];
  }
  if(needDetail){ const rad=Math.max(2,Math.round(Math.max(w,h)/300));
    const edit=(amt,radius)=>{ const bl2=gauss(luma,w,h,radius); for(let i=0,p=0;i<N;i++,p+=4){ const d=(luma[i]-bl2[i])*amt*255; out[p]+=d; out[p+1]+=d; out[p+2]+=d; } };
    if(P.clarity) edit(P.clarity/100*0.9,rad*6); if(P.sharpness){ edit(P.sharpness/100*1.2,Math.max(1,Math.round(rad/2.5))); } }
  return {width:w,height:h,data:out};
}
/* ---- analysis + automatic parameters ---- */
function analyze(img){ const w=img.width,h=img.height,d=img.data, N=w*h, step=Math.max(1,Math.floor(N/120000)); const hist=new Float64Array(256);
  let n=0,mr=0,mg=0,mb=0,nm=0,skin=0,sumS=0,clipHi=0,clipLo=0;
  for(let i=0;i<N;i+=step){ const p=i*4, r=d[p]/255,g=d[p+1]/255,b=d[p+2]/255, Y=0.2126*r+0.7152*g+0.0722*b; hist[Math.min(255,(Y*255)|0)]++; n++;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), s=mx>0?(mx-mn)/mx:0; sumS+=s; if(Y>0.985) clipHi++; if(Y<0.015) clipLo++;
    if(Y>0.2&&Y<0.8&&s<0.4){ mr+=r;mg+=g;mb+=b;nm++; }
    const hh=rgb2hsl(r,g,b)[0]; if(mx>0.18&&s>0.18&&s<0.75&&hh>=5&&hh<=45&&r>g&&g>b*0.9) skin++; }
  const pct=q=>{ let a=0; for(let i=0;i<256;i++){ a+=hist[i]; if(a>=q*n) return i/255; } return 1; };
  return {p1:pct(.01),p5:pct(.05),p10:pct(.10),p50:pct(.5),p90:pct(.9),p95:pct(.95),p99:pct(.99),mean:{r:nm?mr/nm:0.5,g:nm?mg/nm:0.5,b:nm?mb/nm:0.5},neutralN:nm/Math.max(1,n),skin:skin/Math.max(1,n),sat:sumS/Math.max(1,n),clipHi:clipHi/Math.max(1,n),clipLo:clipLo/Math.max(1,n)};}
const STYLES={
 natural:{name:'Natural (Asili)',d:{}},
 wedding_clean:{name:'Harusi safi (Clean luxury)',d:{contrast:8,highlights:-10,shadows:12,vibrance:8,temp:2,clarity:4}},
 warm_wedding:{name:'Harusi joto (Warm editorial)',d:{temp:10,tint:2,contrast:10,shadows:10,saturation:-4,grade:{sh:{h:30,s:12},mid:{h:0,s:0},hi:{h:42,s:18}}}},
 bright_airy:{name:'Angavu (Bright & airy)',d:{exposure:0.25,contrast:-10,highlights:-15,shadows:25,blacks:25,saturation:-6,vibrance:8}},
 moody:{name:'Cinematic ya giza (Moody)',d:{exposure:-0.15,contrast:22,highlights:-20,blacks:-10,saturation:-8,clarity:12,grade:{sh:{h:200,s:25},mid:{h:0,s:0},hi:{h:35,s:18}}}},
 african_skin:{name:'Ngozi nyeusi (African skin optimised)',d:{contrast:8,shadows:14,vibrance:5,hsl:{h:[0,0,0,0,0,0,0,0],s:[4,6,-10,0,0,0,0,0],l:[0,4,0,0,0,0,0,0]},grade:{sh:{h:0,s:0},mid:{h:25,s:6},hi:{h:0,s:0}}}},
 fashion:{name:'Fashion / Beauty',d:{contrast:18,highlights:-8,blacks:-6,vibrance:12,clarity:15,grade:{sh:{h:0,s:0},mid:{h:0,s:0},hi:{h:50,s:6}}}},
 corporate:{name:'Corporate portrait',d:{contrast:6,shadows:10,saturation:-6,clarity:8,sharpness:10}},
 event_church:{name:'Tukio / Kanisa (Event)',d:{exposure:0.15,highlights:-20,shadows:25,vibrance:10,temp:-3}},
 documentary:{name:'Documentary (asili)',d:{contrast:12,saturation:-10,clarity:10}}
};
function pickStyle(st){ if(st.skin>0.06) return 'wedding_clean'; if(st.p50<0.25) return 'event_church'; if(st.p50>0.62) return 'bright_airy'; return 'natural'; }
function autoParams(st,styleKey,strength){
  const P=defaults(); strength=strength==null?1:strength; const skinImg=st.skin>0.06;
  const target=skinImg&&st.p50<0.3?0.40:0.46; const medLin=S2L[Math.round(clamp(st.p50,0.01,1)*255)], tgtLin=S2L[Math.round(target*255)];
  let ev=Math.log2(tgtLin/Math.max(medLin,1e-4))*0.8; P.exposure=clamp(ev,-1.5,skinImg?1:1.5);
  const R=st.mean.r,G=st.mean.g,B=st.mean.b, lim=skinImg?15:25;
  if(st.neutralN>0.05&&R>0&&B>0){ const rb=(R-B)/(R+B); P.temp=clamp(-rb*2/0.007*0.4,-lim,lim); const gd=(G-(R+B)/2)/Math.max(G,1e-3); P.tint=clamp(gd/0.003*0.4,-20,20); }
  if(st.p1>0.05) P.blacks=-clamp((st.p1-0.02)*220,0,40);
  if(st.p99<0.93) P.whites=clamp((0.96-st.p99)*220,0,30);
  if(st.clipHi>0.02) P.highlights-=clamp(30+st.clipHi*600,0,60);
  if(st.p95>0.9) P.highlights-=clamp((st.p95-0.88)*400,0,50);
  if(st.p10<0.15) P.shadows=clamp((0.2-st.p10)*260,0,55);
  const range=st.p99-st.p1; if(range<0.75) P.contrast=clamp((0.8-range)*90,0,28); else if(range>0.97) P.contrast=-6;
  P.vibrance=skinImg?8:14; P.clarity=10; P.sharpness=25;
  const key=styleKey&&styleKey!=='auto'?styleKey:pickStyle(st); const S=STYLES[key]||STYLES.natural; addDelta(P,S.d,strength);
  P.__style=key; return sanitize(P);}
/* ---- preset importers ---- */
const LR_MAP={Exposure2012:'exposure',Exposure:'exposure',Contrast2012:'contrast',Contrast:'contrast',Highlights2012:'highlights',Shadows2012:'shadows',Whites2012:'whites',Blacks2012:'blacks',Vibrance:'vibrance',Saturation:'saturation',Clarity2012:'clarity',Clarity:'clarity'};
function wbFrom(v){ v=parseFloat(v); if(isNaN(v)) return null; return Math.abs(v)>=1500?clamp((v-5500)/40,-100,100):v; }
function parseLR(text){ const P={},ign=[],ok=[]; const kv={}; let m; const re=/crs:(\w+)\s*=\s*"([^"]*)"/g; while((m=re.exec(text))) kv[m[1]]=m[2];
  const re2=/<crs:(\w+)>([^<]+)<\/crs:\1>/g; while((m=re2.exec(text))) if(!(m[1] in kv)) kv[m[1]]=m[2].trim();
  const re3=/(?:^|[\s,{])(\w+)\s*=\s*(-?[\d.]+|"[^"]*")\s*,/g; if(!Object.keys(kv).length){ while((m=re3.exec(text))) kv[m[1]]=m[2].replace(/"/g,''); }
  const num=k=>parseFloat(kv[k]);
  Object.keys(LR_MAP).forEach(k=>{ if(k in kv){ const v=num(k); if(!isNaN(v)){ P[LR_MAP[k]]=v; ok.push(k);} } });
  if('Temperature' in kv && (kv.WhiteBalance||'Custom')!=='As Shot'){ const t=wbFrom(kv.Temperature); if(t!=null){P.temp=t;ok.push('Temperature');} }
  if('Tint' in kv){ const t=num('Tint'); if(!isNaN(t)){P.tint=t;ok.push('Tint');} }
  if('Sharpness' in kv){ const s=num('Sharpness'); if(!isNaN(s)){P.sharpness=clamp(s/150*100,0,100);ok.push('Sharpness');} }
  const hsl={h:Array(8).fill(0),s:Array(8).fill(0),l:Array(8).fill(0)}; let anyH=false;
  BANDS.forEach((b,i)=>{ [['h','HueAdjustment'],['s','SaturationAdjustment'],['l','LuminanceAdjustment']].forEach(([c,pre])=>{ const k=pre+b; if(k in kv){ const v=num(k); if(!isNaN(v)){hsl[c][i]=v;anyH=true;ok.push(k);} } }); }); if(anyH) P.hsl=hsl;
  const gr={sh:{h:0,s:0},mid:{h:0,s:0},hi:{h:0,s:0},balance:0}; let anyG=false;
  [['sh','SplitToningShadow','ColorGradeShadow'],['hi','SplitToningHighlight','ColorGradeHighlight'],['mid',null,'ColorGradeMidtone']].forEach(([z,a,b2])=>{ [a,b2].forEach(pre=>{ if(!pre) return; const H=num(pre+'Hue'),S=num(pre+'Saturation'); if(!isNaN(H)&&!isNaN(S)&&S>0){ gr[z]={h:H,s:S}; anyG=true; ok.push(pre+'Hue',pre+'Saturation'); } }); });
  if('SplitToningBalance' in kv){ const b3=num('SplitToningBalance'); if(!isNaN(b3)){gr.balance=b3;anyG=true;} } if(anyG) P.grade=gr;
  const curve={}; [['rgb','ToneCurvePV2012'],['r','ToneCurvePV2012Red'],['g','ToneCurvePV2012Green'],['b','ToneCurvePV2012Blue']].forEach(([ch,key])=>{ let pts=[]; const rx=new RegExp('<crs:'+key+'>([\\s\\S]*?)</crs:'+key+'>'); const mm=text.match(rx);
      if(mm){ const re4=/<rdf:li>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*<\/rdf:li>/g; let q; while((q=re4.exec(mm[1]))) pts.push([+q[1],+q[2]]); }
      else { const lm=text.match(new RegExp(key+'\\s*=\\s*\\{([^}]*)\\}')); if(lm){ const nums=lm[1].match(/-?[\d.]+/g)||[]; for(let i=0;i+1<nums.length;i+=2) pts.push([+nums[i],+nums[i+1]]); } }
      if(pts.length>=2&&!(pts.length===2&&pts[0][0]===0&&pts[0][1]===0&&pts[1][0]===255&&pts[1][1]===255)){ curve[ch]=pts; ok.push(key); } });
  if(Object.keys(curve).length) P.curve=Object.assign({rgb:[],r:[],g:[],b:[]},curve);
  const skip=/^(Version|ProcessVersion|CameraProfile|Name|Group|UUID|ToneCurveName|WhiteBalance|HasSettings|Look|Texture|Dehaze|Grain|Vignette|Convert|Camera|Lens|Parametric|Auto|Crop|Orientation|About|Description|Supports|Cluster|Preset|RedHue|RedSaturation|Green|Blue|Calibration|Sharpen|Luminance|ColorNoise|Defringe|Perspective|Local|Mask|Circular|Gradient|Paint|Correction|Enable|Override|ToneCurve)/;
  Object.keys(kv).forEach(k=>{ if(!ok.includes(k)&&!skip.test(k)&&!/^(xmlns|rdf)/.test(k)) ign.push(k); });
  return {kind:'lightroom',P,ok:ok.length,ignored:ign};}
function parseCOStyle(text){ const P={},ok=[],ign=[]; let doc=null; try{ doc=new DOMParser().parseFromString(text,'text/xml'); }catch(e){}
  const pairs=[]; if(doc){ doc.querySelectorAll('E').forEach(e=>{ const k=e.getAttribute('K'), v=e.getAttribute('V'); if(k!=null&&v!=null) pairs.push([k,v]); }); }
  if(!pairs.length){ let m; const re=/<E\s+K="([^"]+)"\s+V="([^"]*)"/g; while((m=re.exec(text))) pairs.push([m[1],m[2]]); }
  const MAP={exposure:'exposure',exposurevalue:'exposure',contrast:'contrast',saturation:'saturation',vibrance:'vibrance',highlight:'highlights',highlights:'highlights',highlightrecovery:'highlights',shadow:'shadows',shadows:'shadows',shadowrecovery:'shadows',whiteslevel:'whites',blackslevel:'blacks',clarity:'clarity',clarityamount:'clarity',structure:'clarity',sharpeningamount:'sharpness',tint:'tint',whitebalancetint:'tint'};
  pairs.forEach(([k,v])=>{ const kk=k.toLowerCase().replace(/[^a-z]/g,''); const val=parseFloat(v); if(isNaN(val)){ ign.push(k); return; }
    if(MAP[kk]){ P[MAP[kk]]=(MAP[kk]==='sharpness')?clamp(val,0,100):val; ok.push(k); }
    else if(/kelvin|temperature/.test(kk)){ const t=wbFrom(val); if(t!=null){P.temp=t;ok.push(k);} }
    else if(kk==='brightness'){ P.exposure=(P.exposure||0)+val/100*0.8; ok.push(k); } else ign.push(k); });
  return {kind:'captureone',P,ok:ok.length,ignored:[...new Set(ign)].slice(0,40),note:'Capture One: vigezo vya msingi pekee vinasomwa (Color Editor, Curves na Layers havisomwi bado).'};}
function parseCube(text){ const lines=text.split(/\r?\n/); let size=0,dim=3,mn=[0,0,0],mx=[1,1,1],title='LUT',data=[];
  for(const ln of lines){ const t=ln.trim(); if(!t||t[0]==='#') continue; let m;
    if((m=t.match(/^TITLE\s+"?(.*?)"?$/i))){ title=m[1]; continue; } if((m=t.match(/^LUT_3D_SIZE\s+(\d+)/i))){ size=+m[1]; dim=3; continue; } if((m=t.match(/^LUT_1D_SIZE\s+(\d+)/i))){ size=+m[1]; dim=1; continue; }
    if((m=t.match(/^DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)/i))){ mn=[+m[1],+m[2],+m[3]]; continue; } if((m=t.match(/^DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)/i))){ mx=[+m[1],+m[2],+m[3]]; continue; }
    if(/^[-\d.]/.test(t)){ const p=t.split(/\s+/).map(Number); if(p.length>=3&&!p.some(isNaN)) data.push((p[0]-mn[0])/(mx[0]-mn[0]||1),(p[1]-mn[1])/(mx[1]-mn[1]||1),(p[2]-mn[2])/(mx[2]-mn[2]||1)); } }
  if(!size) throw new Error('Faili la .cube halina LUT_3D_SIZE.');
  if(dim===1){ const n=size,d3=[]; const S=33; for(let b=0;b<S;b++)for(let g2=0;g2<S;g2++)for(let r=0;r<S;r++){ const f=v=>{const x=v/(S-1)*(n-1),i0=Math.floor(x),i1=Math.min(i0+1,n-1),t=x-i0; return [0,1,2].map(c=>data[i0*3+c]*(1-t)+data[i1*3+c]*t); }; const R=f(r),G=f(g2),B=f(b); d3.push(R[0],G[1],B[2]); } return {kind:'lut',lut:{name:title,size:S,data:Float32Array.from(d3)}}; }
  if(data.length!==size*size*size*3) throw new Error('Idadi ya mistari ya LUT hailingani na ukubwa ('+(data.length/3)+' ≠ '+size*size*size+').');
  return {kind:'lut',lut:{name:title,size,data:Float32Array.from(data)}};}
function parseACV(buf){ const dv=new DataView(buf); let o=0; const ver=dv.getUint16(o);o+=2; const cnt=dv.getUint16(o);o+=2; const names=['rgb','r','g','b']; const cur={rgb:[],r:[],g:[],b:[]};
  for(let c=0;c<cnt;c++){ const n=dv.getUint16(o);o+=2; const pts=[]; for(let i=0;i<n;i++){ const y=dv.getUint16(o), x=dv.getUint16(o+2); o+=4; pts.push([x,y]); } if(c<4&&pts.length>=2&&!(pts.length===2&&pts[0][0]===0&&pts[0][1]===0&&pts[1][0]===255&&pts[1][1]===255)) cur[names[c]]=pts; }
  return {kind:'photoshop-curves',P:{curve:cur},ok:1,ignored:[]};}
function applyPreset(P,pre,mode){ const N=P; if(!pre) return N; const Q=pre.P||{};
  if(pre.kind==='lut'){ N.lut=pre.lut; N.lutAmt=100; return N; }
  NUMK.forEach(k=>{ if(k in Q) N[k]=Q[k]; }); const cp=o=>o==null?o:JSON.parse(JSON.stringify(o)); if(Q.hsl) N.hsl=cp(Q.hsl); if(Q.grade) N.grade=cp(Q.grade); if(Q.curve) N.curve=cp(Q.curve); if(Q.lut) { N.lut=Q.lut; N.lutAmt=Q.lutAmt==null?100:Q.lutAmt; }
  return sanitize(N);}
g.StudioEngine={defaults,clone,reviveLut,process,analyze,autoParams,STYLES,pickStyle,parseLR,parseCOStyle,parseCube,parseACV,applyPreset,addDelta,sanitize,curveLut,BANDS,rgb2hsl,hsl2rgb};
})(typeof window!=='undefined'?window:globalThis);
