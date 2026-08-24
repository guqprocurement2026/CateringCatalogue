let DATA={hotels:[],menus:[]};
let activeCategory='';
const $=id=>document.getElementById(id);
const CATEGORY_ORDER=['Coffee Break','Breakfast','Buffet','Canapés','Set Menu','Family Style','Meeting Package','Beverage','Meeting Spaces'];

function bool(v){return v===true||['true','yes','1'].includes(String(v??'').trim().toLowerCase())}
function num(v){const n=Number(String(v??'').replace(/[^0-9.]/g,''));return Number.isFinite(n)?n:0}
function esc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
function attr(s){return esc(s)}
function configUrl(){const v=window.CATALOGUE_CONFIG&&window.CATALOGUE_CONFIG.APPS_SCRIPT_URL;return String(v||'').trim()}
function validApiUrl(url){return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(url)}

async function start(){
  const url=configUrl();
  if(validApiUrl(url)){
    try{DATA=normalize(await loadJsonp(url));setStatus('Live · Google Sheet connected',true);renderAll();return}catch(e){console.warn('Live Sheet connection failed; using packaged preview.',e)}
  }
  try{const r=await fetch('preview_data.json?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);DATA=normalize(await r.json());setStatus(validApiUrl(url)?'Sheet unavailable · preview data shown':'Preview · connect Google Sheet',false);renderAll()}catch(e){setStatus('Catalogue data unavailable',false);$('grid').innerHTML='<div class="empty"><b>Catalogue data could not be loaded.</b></div>'}
}

function loadJsonp(url){
  return new Promise((resolve,reject)=>{
    const cb='guqCatalogueCallback_'+Date.now()+'_'+Math.floor(Math.random()*10000);
    const sep=url.includes('?')?'&':'?';
    const script=document.createElement('script');
    let done=false;
    const timer=setTimeout(()=>finish(new Error('Google Sheet connection timed out.')),12000);
    function finish(err,data){if(done)return;done=true;clearTimeout(timer);try{delete window[cb]}catch(e){};script.remove();err?reject(err):resolve(data)}
    window[cb]=data=>finish(null,data);
    script.onerror=()=>finish(new Error('Could not load Apps Script data.'));
    script.src=url+sep+'callback='+encodeURIComponent(cb)+'&t='+Date.now();
    document.head.appendChild(script);
  });
}

function normalize(raw){
  const hotels=(raw.hotels||[]).filter(h=>bool(h.Active)).map((h,i)=>({name:String(h.Hotel||'').trim(),tier:String(h.Tier||'').trim(),order:i})).filter(h=>h.name);
  const menus=(raw.menus||[]).filter(m=>bool(m.Active)).map((m,i)=>({hotel:String(m.Hotel||'').trim(),category:String(m.Category||'').trim(),price:num(m['Average Price QAR']),link:String(m['Attachment Link']||'').trim(),order:i})).filter(m=>m.hotel&&m.category);
  return {hotels,menus};
}

function setStatus(text,on){$('statusText').textContent=text;$('statusDot').classList.toggle('on',!!on)}
function menuRowsFor(hotel){return DATA.menus.filter(m=>m.hotel===hotel).sort((a,b)=>catRank(a.category)-catRank(b.category)||a.order-b.order)}
function catRank(c){const i=CATEGORY_ORDER.indexOf(c);return i<0?100:i}
function categories(){return [...new Set(DATA.menus.map(m=>m.category))].sort((a,b)=>catRank(a)-catRank(b)||a.localeCompare(b))}
function priceRows(){return DATA.menus.filter(m=>m.category!=='Meeting Spaces'&&m.price>0)}

function renderAll(){
  const ps=priceRows();
  $('statHotels').textContent=DATA.hotels.length;
  $('statCategories').textContent=categories().length;
  $('statAvg').textContent=ps.length?'QAR '+Math.round(ps.reduce((a,b)=>a+b.price,0)/ps.length):'—';
  renderFilters();render();
}

function renderFilters(){
  const all=['',...categories()];
  $('filters').innerHTML=all.map(c=>'<button class="filter-chip '+(activeCategory===c?'active':'')+'" data-cat="'+attr(c)+'">'+(c||'All categories')+'</button>').join('');
  $('filters').querySelectorAll('button').forEach(b=>b.onclick=()=>{activeCategory=b.dataset.cat;renderFilters();render()});
}

function visibleHotels(){
  const q=$('search').value.trim().toLowerCase();
  let hs=DATA.hotels.map(h=>{
    const rows=menuRowsFor(h.name);
    const shown=rows.filter(m=>(!activeCategory||m.category===activeCategory)&&(!q||h.name.toLowerCase().includes(q)||m.category.toLowerCase().includes(q)));
    const hotelMatch=!q||h.name.toLowerCase().includes(q);
    return {...h,rows:activeCategory||q?shown:rows,allRows:rows,hotelMatch};
  }).filter(h=>activeCategory?h.rows.length:(q?(h.hotelMatch||h.rows.length):true));

  if($('sort').value==='price'){
    hs.sort((a,b)=>startingPrice(a.allRows)-startingPrice(b.allRows));
  }
  return hs;
}

function startingPrice(rows){const p=rows.filter(r=>r.category!=='Meeting Spaces'&&r.price>0).map(r=>r.price);return p.length?Math.min(...p):999999}
function render(){
  const hs=visibleHotels();
  $('resultCount').textContent=hs.length+' venue'+(hs.length===1?'':'s')+' shown';
  $('grid').innerHTML=hs.length?hs.map(card).join(''):'<div class="empty"><b>No matching venues.</b><br>Try another hotel name or category.</div>';
}

function card(h){
  const start=startingPrice(h.allRows);
  return '<article class="hotel-card"><div class="hotel-band"></div><div class="hotel-header"><div class="hotel-title"><h3>'+esc(h.name)+'</h3><span class="tier">'+esc(h.tier||'Preferred')+'</span></div><div class="from">Starting catering price<strong>'+(start<999999?'QAR '+start:'Price on request')+'</strong></div></div><div class="category-list">'+h.rows.map(row).join('')+'</div></article>';
}

function row(m){
  const isMeeting=m.category==='Meeting Spaces';
  const price=isMeeting?'':(m.price?'QAR '+Math.round(m.price):'Price on request');
  const sub=isMeeting?'Venue information':(m.price?'average / person':'pricing pending');
  const action=m.link?(isMeeting?'View spaces ↗':'View menu ↗'):'Link not added';
  return '<a class="category-link" href="'+(m.link?attr(m.link):'#')+'" '+(m.link?'target="_blank" rel="noopener"':'onclick="return false"')+'><span class="category-name">'+esc(m.category)+'</span><span class="price-block"><strong>'+esc(price)+'</strong><span>'+esc(sub)+'</span></span><span class="menu-action '+(m.link?'':'missing')+'">'+esc(action)+'</span></a>';
}

$('search').addEventListener('input',render);
$('sort').addEventListener('change',render);
start();
