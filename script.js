/* =====================================================================
   REELHOUSE — TMDB + VIDEASY (final integrated build)
   Core streaming/TMDB/progress logic preserved. Full English UI.
===================================================================== */

/* ===== CONFIG ===== */
const TMDB_API_KEY   = "d67038003a57095ca9d6d8a0c3c2d995";
const TMDB_BASE      = "https://api.themoviedb.org/3";
const IMG_BASE       = "https://image.tmdb.org/t/p/w342";
const IMG_BACKDROP   = "https://image.tmdb.org/t/p/w1280";
const VIDEASY_BASE   = "https://player.videasy.net";
const VIDEASY_COLOR  = "e8b34e";
const PROGRESS_KEY   = "reelhouse_progress";
const MYLIST_KEY     = "reelhouse_mylist";
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ===== STATE ===== */
const state = {
  genres: { movie: [], tv: [] },
  mylist: JSON.parse(localStorage.getItem(MYLIST_KEY) || "[]"),
  currentMedia: null
};

/* ===== PROGRESS (core — unchanged) ===== */
function getProgressStore(){
  try{ return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); }catch(e){ return {}; }
}
function saveProgress(entry){
  const store = getProgressStore();
  const key = `${entry.type}:${entry.id}` + (entry.season ? `:${entry.season}:${entry.episode}` : '');
  store[key] = entry;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(store));
}
function getSavedProgress(type, id, season, episode){
  const store = getProgressStore();
  const key = `${type}:${id}` + (season ? `:${season}:${episode}` : '');
  return store[key];
}
window.addEventListener('message', function(event){
  if (typeof event.data !== 'string') return;
  let data;
  try{ data = JSON.parse(event.data); }catch(e){ return; }
  if (data && data.progress !== undefined && data.id){
    saveProgress(data);
    if(location.hash.indexOf('#/watch') === -1) renderContinueWatching();
  }
});

/* ===== MY LIST (core — unchanged) ===== */
function updateBadge(){ document.getElementById('listCount').textContent = state.mylist.length; }
function inList(type, id){ return state.mylist.some(x => x.type === type && x.id == id); }
function toggleList(item){
  if(inList(item.type, item.id)){
    state.mylist = state.mylist.filter(x => !(x.type === item.type && x.id == item.id));
    toast('Removed from My List');
  } else {
    state.mylist.push(item);
    toast('Added to My List ✓');
  }
  localStorage.setItem(MYLIST_KEY, JSON.stringify(state.mylist));
  updateBadge();
}

/* ===== HELPERS ===== */
const app = document.getElementById('app');
const heroShell = document.getElementById('heroShell');
let heroTimer = null; // tracks the hero auto-rotate interval so it can be cleared on navigation

function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._x); t._x=setTimeout(()=>t.classList.remove('show'),2200); }
function keyMissing(){ return !TMDB_API_KEY || TMDB_API_KEY === "YOUR_TMDB_API_KEY_HERE"; }
function showKeyBanner(){
  const b = document.getElementById('keyBanner');
  b.innerHTML = `<b>⚠ TMDB API key is not set.</b> Sign up at <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org/settings/api</a> and grab the "API Key (v3 auth)".`;
  b.classList.add('show');
}
async function tmdb(endpoint, params={}){
  const p = new URLSearchParams({ api_key: TMDB_API_KEY, language: "en-US", ...params });
  const res = await fetch(`${TMDB_BASE}${endpoint}?${p.toString()}`);
  if(!res.ok) throw new Error('TMDB error');
  return res.json();
}
async function fetchGenres(type){
  if(state.genres[type].length) return state.genres[type];
  try{
    const data = await tmdb(`/genre/${type}/list`);
    state.genres[type] = data.genres || [];
    return state.genres[type];
  }catch(e){ console.error(e); return []; }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ===== CARD BUILDER (uniform sizing — opens detail modal) ===== */
function cardHTML(item, type, rank){
  const title  = item.title || item.name || "Untitled";
  const date   = item.release_date || item.first_air_date || "";
  const year   = date ? date.slice(0,4) : "—";
  const poster = item.poster_path ? IMG_BASE + item.poster_path : "";
  const rating = item.vote_average ? item.vote_average.toFixed(1) : "N/A";
  const mt = type || (item.media_type || (item.first_air_date ? 'tv' : 'movie'));
  return `<div class="card${rank ? ' ranked' : ''}" data-id="${item.id}" data-type="${mt}">
    ${rank ? `<span class="rank-num">${rank}</span>` : ''}
    <div class="poster-wrap">
      ${poster ? `<img src="${poster}" alt="${esc(title)}" loading="lazy">` : `<div class="noimg">NO IMAGE</div>`}
      <div class="stub">★ ${rating}</div>
      <div class="play-overlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></div>
    </div>
    <div class="card-info">
      <div class="card-title">${esc(title)}</div>
      <div class="card-year">${year} · ${mt === 'tv' ? 'SERIES' : 'MOVIE'}</div>
    </div>
  </div>`;
}
function bindCards(container){
  if(!container) return;
  container.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.type, card.dataset.id));
  });
}

/* Solid at the very start/end of a scroll row; fades in smoothly the moment there's
   more content to reveal in that direction — no more hard "wall" cut on the edges. */
function initEdgeFade(scrollEl){
  if(!scrollEl || scrollEl.dataset.edgeFadeInit) return;
  scrollEl.dataset.edgeFadeInit = '1';
  const parent = scrollEl.parentElement;
  if(!parent) return;
  if(getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const l = document.createElement('div'); l.className = 'edge-fade edge-fade-l';
  const r = document.createElement('div'); r.className = 'edge-fade edge-fade-r';
  parent.appendChild(l); parent.appendChild(r);
  const position = () => {
    // Scope the fade strictly to the row's own box (top/height AND left/right),
    // so it always hugs the row's real edges instead of the parent's edges.
    // Sections like .block carry their own 44px side padding, so a static
    // left:0/right:0 landed at the section wall instead of where the row
    // actually starts — that's what threw the fade off on the homepage rows.
    l.style.top = r.style.top = scrollEl.offsetTop + 'px';
    l.style.height = r.style.height = scrollEl.offsetHeight + 'px';
    l.style.left = scrollEl.offsetLeft + 'px';
    r.style.right = (parent.clientWidth - scrollEl.offsetLeft - scrollEl.offsetWidth) + 'px';
  };
  const update = () => {
    position();
    const max = scrollEl.scrollWidth - scrollEl.clientWidth;
    l.classList.toggle('show', scrollEl.scrollLeft > 4);
    r.classList.toggle('show', max > 4 && scrollEl.scrollLeft < max - 4);
  };
  scrollEl.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

/* ===== HOME ===== */
async function pageHome(){
  document.title = 'REELHOUSE — Stream Movies & Series';
  if(keyMissing()){
    heroShell.innerHTML = '';
    app.innerHTML = `<div class="page-banner"><h1>REEL<b>HOUSE</b></h1></div><div class="empty"><div class="big">API KEY REQUIRED</div>Check the red banner at the bottom of your screen.</div>`;
    showKeyBanner();
    return;
  }
  heroShell.innerHTML = `<div class="loader" style="padding-top:46vh">LOADING FEATURED...</div>`;
  app.innerHTML = `
    <section class="block">
      <div class="sec-head"><span class="scene">SCENE 01</span><h2>TRENDING THIS WEEK</h2><span class="sec-count" id="trendingCount">—</span>
        <div class="row-nav"><button data-dir="-1" data-row="r1">←</button><button data-dir="1" data-row="r1">→</button></div></div>
      <div class="row row-ranked" id="r1"><div class="loader">LOADING TMDB...</div></div>
    </section>
    <section class="block" id="contSection" style="display:none">
      <div class="sec-head"><span class="scene">SCENE 02</span><h2>CONTINUE WATCHING</h2><span class="sec-count" id="contCount">—</span></div>
      <div class="row" id="contRow"></div>
    </section>
    <section class="block">
      <div class="sec-head"><span class="scene">SCENE 03</span><h2>POPULAR MOVIES</h2><span class="sec-count" id="popCount">—</span>
        <div class="row-nav"><button data-dir="-1" data-row="r2">←</button><button data-dir="1" data-row="r2">→</button></div></div>
      <div class="row" id="r2"><div class="loader">LOADING...</div></div>
    </section>
    <section class="block">
      <div class="sec-head"><span class="scene">SCENE 04</span><h2>TOP RATED</h2><span class="sec-count" id="topCount">—</span>
        <div class="row-nav"><button data-dir="-1" data-row="r3">←</button><button data-dir="1" data-row="r3">→</button></div></div>
      <div class="row" id="r3"><div class="loader">LOADING...</div></div>
    </section>
    <section class="block">
      <div class="sec-head"><span class="scene">SCENE 05</span><h2>POPULAR TV SERIES</h2><span class="sec-count" id="tvCount">—</span>
        <div class="row-nav"><button data-dir="-1" data-row="r4">←</button><button data-dir="1" data-row="r4">→</button></div></div>
      <div class="row" id="r4"><div class="loader">LOADING...</div></div>
    </section>`;

  app.querySelectorAll('.row-nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(btn.dataset.row);
      if(row) row.scrollBy({ left: +btn.dataset.dir * row.clientWidth * 0.8, behavior: RM ? 'auto' : 'smooth' });
    });
  });

  try{
    const [trending, popular, top, tvPop] = await Promise.all([
      tmdb('/trending/all/week', { page: 1 }),
      tmdb('/movie/popular', { page: 1 }),
      tmdb('/movie/top_rated', { page: 1 }),
      tmdb('/tv/popular', { page: 1 })
    ]);

    renderHero(trending.results.slice(0, 8));

    const r1 = document.getElementById('r1');
    r1.innerHTML = trending.results.slice(0, 16).map((x, i) => cardHTML(x, x.media_type, i+1)).join('');
    bindCards(r1); initEdgeFade(r1);
    document.getElementById('trendingCount').textContent = `TOP ${Math.min(16, trending.results.length)}`;

    const r2 = document.getElementById('r2');
    r2.innerHTML = popular.results.slice(0, 16).map(x => cardHTML(x, 'movie')).join('');
    bindCards(r2); initEdgeFade(r2);
    document.getElementById('popCount').textContent = `${Math.min(16, popular.results.length)} TITLES`;

    const r3 = document.getElementById('r3');
    r3.innerHTML = top.results.slice(0, 16).map(x => cardHTML(x, 'movie')).join('');
    bindCards(r3); initEdgeFade(r3);
    document.getElementById('topCount').textContent = `${Math.min(16, top.results.length)} TITLES`;

    const r4 = document.getElementById('r4');
    r4.innerHTML = tvPop.results.slice(0, 16).map(x => cardHTML(x, 'tv')).join('');
    bindCards(r4); initEdgeFade(r4);
    document.getElementById('tvCount').textContent = `${Math.min(16, tvPop.results.length)} TITLES`;

    renderContinueWatching();
  }catch(e){
    console.error(e);
    heroShell.innerHTML = '';
    app.innerHTML = `<div class="empty" style="padding-top:200px"><div class="big">ERROR</div>${esc(e.message)}</div>`;
  }
}

/* ---------- CINEMATIC HERO (backdrop image only — no trailer embed) ---------- */
async function renderHero(items){
  if(!items.length){ heroShell.innerHTML = ''; return; }
  const pick = it => ({
    type: it.media_type || (it.first_air_date ? 'tv' : 'movie'),
    title: it.title || it.name || 'Untitled',
    year: (it.release_date || it.first_air_date || '').slice(0,4) || '—',
    rating: it.vote_average ? it.vote_average.toFixed(1) : 'N/A',
    overview: it.overview || 'No synopsis available yet.',
    backdrop: it.backdrop_path ? IMG_BACKDROP + it.backdrop_path : ''
  });
  const slides = items.map(pick);

  heroShell.innerHTML = `
  <section class="hero">
    <div class="hero-media">
      <img id="heroImg" src="" alt="">
    </div>
    <div class="hero-fade"></div>
    <div class="rec"><i></i>REC</div>
    <div class="hero-inner">
      <div class="hero-tag">NOW STREAMING ON REELHOUSE</div>
      <h1 class="hero-title" id="heroTitle">—</h1>
      <div class="hero-meta" id="heroMeta"></div>
      <p class="hero-desc" id="heroDesc"></p>
      <div class="hero-btns">
        <button class="btn btn-play" id="heroPlay"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M8 5v14l11-7z" fill="currentColor"/></svg> PLAY NOW</button>
        <button class="btn btn-ghost" id="heroInfo">ⓘ MORE INFO</button>
        <button class="btn btn-ghost" id="heroList">+ MY LIST</button>
      </div>
    </div>
    <div class="hero-side">
      <button class="hero-fab" id="heroFull" title="Play now">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
      </button>
      <div class="hero-dots" id="heroDots"></div>
    </div>
  </section>`;

  const imgEl = document.getElementById('heroImg');
  clearInterval(heroTimer); // stop any previous rotation before starting a new one
  let idx = 0;

  const setSlide = i => {
    idx = i;
    const s = slides[i];
    const textEls = [document.getElementById('heroTitle'), document.getElementById('heroMeta'), document.getElementById('heroDesc')];

    const applyContent = () => {
      imgEl.src = s.backdrop;
      document.getElementById('heroTitle').textContent = s.title.toUpperCase();
      document.getElementById('heroMeta').innerHTML =
        `<span class="chip gold">★ ${s.rating}</span><span class="chip">${s.year}</span>` +
        `<span class="chip">${s.type === 'tv' ? 'SERIES' : 'MOVIE'}</span><span class="chip">HD · 4K</span>`;
      document.getElementById('heroDesc').textContent = s.overview;
      const lb2 = document.getElementById('heroList');
      lb2.classList.toggle('on', inList(s.type, items[i].id));
      document.querySelectorAll('#heroDots button').forEach((d, di) => d.classList.toggle('on', di === i));
    };

    // Crossfade: fade current image + text out, swap once the next image is ready, fade back in.
    imgEl.classList.add('fading');
    textEls.forEach(el => el && el.classList.add('hero-fade-text', 'fading'));

    const next = new Image();
    next.src = s.backdrop;
    const swap = () => {
      applyContent();
      requestAnimationFrame(() => {
        imgEl.classList.remove('fading');
        textEls.forEach(el => el && el.classList.remove('fading'));
      });
    };
    if(next.complete) setTimeout(swap, 500);
    else { next.onload = () => setTimeout(swap, 500); next.onerror = () => setTimeout(swap, 500); }
  };

  document.getElementById('heroDots').innerHTML =
    slides.map((_, i) => `<button data-i="${i}" ${i===0?'class="on"':''} aria-label="Featured ${i+1}"></button>`).join('');
  document.querySelectorAll('#heroDots button').forEach(d => {
    d.addEventListener('click', () => { setSlide(+d.dataset.i); restartAuto(); });
  });

  // Play just opens the watch page — no auto fullscreen
  const goWatch = () => {
    const s = slides[idx];
    location.hash = `#/watch/${s.type}/${items[idx].id}`;
  };
  document.getElementById('heroPlay').addEventListener('click', goWatch);
  document.getElementById('heroFull').addEventListener('click', goWatch);
  document.getElementById('heroInfo').addEventListener('click', () => openDetail(slides[idx].type, items[idx].id));
  document.getElementById('heroList').addEventListener('click', function(){
    const s = slides[idx];
    toggleList({ type: s.type, id: items[idx].id, title: s.title,
      poster: items[idx].poster_path, year: s.year, rating: s.rating, overview: s.overview });
    this.classList.toggle('on', inList(s.type, items[idx].id));
  });

  setSlide(0);
  const restartAuto = () => {
    clearInterval(heroTimer);
    if(RM) return;
    heroTimer = setInterval(() => { setSlide((idx + 1) % slides.length); }, 12000);
  };
  restartAuto();
}

/* ---------- DETAIL MODAL (description + "More Like This" slider) ---------- */
async function openDetail(type, id){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop"></div><div class="modal"><div class="loader">LOADING...</div></div>`;
  root.classList.add('open');
  document.body.style.overflow = 'hidden';
  root.querySelector('.modal-backdrop').addEventListener('click', closeDetail);

  try{
    const d = await tmdb(`/${type}/${id}`, { append_to_response: 'similar,videos' });
    const title  = d.title || d.name || 'Untitled';
    const year   = (d.release_date || d.first_air_date || '').slice(0,4) || '—';
    const rating = d.vote_average ? d.vote_average.toFixed(1) : 'N/A';
    const backdrop = d.backdrop_path ? IMG_BACKDROP + d.backdrop_path : '';
    const genres = (d.genres || []).map(g => `<span class="chip">${esc(g.name)}</span>`).join('');
    const dur = type === 'movie'
      ? (d.runtime ? `${Math.floor(d.runtime/60)}h ${d.runtime%60}m` : '—')
      : `${d.number_of_seasons || '?'} Season${(d.number_of_seasons||0) > 1 ? 's' : ''}`;
    const runtimeChip = type === 'movie' && d.runtime ? `<span class="chip">${dur}</span>` : '';
    const overview = d.overview || 'No synopsis available yet.';
    const similar = (d.similar && d.similar.results)
      ? d.similar.results.filter(x => x.backdrop_path || x.poster_path).slice(0, 12) : [];
    const item = { type, id, title, poster: d.poster_path, year, rating, overview };
    const saved = getSavedProgress(type, id);
    const resumeTxt = (saved && saved.progress > 30)
      ? `RESUME · ${Math.round(saved.progress/60)} MIN` : 'PLAY NOW';

    root.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal">
      <button class="modal-close" id="modalClose">✕</button>
      <div class="modal-hero">
        ${backdrop ? `<img src="${backdrop}" alt="">` : ''}
        <div class="modal-hero-fade"></div>
        <div class="modal-hero-info">
          <h2>${esc(title).toUpperCase()}</h2>
          <div class="hero-meta">
            <span class="chip gold">★ ${rating}</span><span class="chip">${year}</span>
            ${runtimeChip}<span class="chip">${type === 'tv' ? 'SERIES' : 'MOVIE'}</span>
          </div>
        </div>
      </div>
      <div class="modal-body">
        <div class="modal-actions">
          <button class="btn btn-play" id="mPlay">▶ ${resumeTxt}</button>
          <button class="btn btn-ghost" id="mList">+ MY LIST</button>
        </div>
        <div class="modal-desc">
          <h4>STORYLINE</h4>
          <p>${esc(overview)}</p>
          <div class="modal-genres">${genres}</div>
          <div class="modal-meta-line">STATUS <b style="color:var(--gold)">● Available via Videasy</b></div>
        </div>
        <div class="modal-similar">
          <div class="ms-head"><h4>MORE LIKE THIS</h4>
            <div class="ms-nav"><button id="msPrev">←</button><button id="msNext">→</button></div>
          </div>
          <div class="ms-row">${similar.length ? similar.map(x => cardHTML(x, type)).join('') : '<p style="color:var(--ink-dim)">No suggestions yet.</p>'}</div>
        </div>
      </div>
    </div>`;

    root.querySelector('.modal-backdrop').addEventListener('click', closeDetail);
    root.querySelector('#modalClose').addEventListener('click', closeDetail);
    root.querySelector('#mPlay').addEventListener('click', () => {
      location.hash = `#/watch/${type}/${id}`;
    });
    const ml = root.querySelector('#mList');
    const syncML = () => {
      const on = inList(type, id);
      ml.classList.toggle('on', on);
      ml.innerHTML = on ? '✓ IN MY LIST' : '+ MY LIST';
    };
    ml.addEventListener('click', () => { toggleList(item); syncML(); });
    syncML();

    const msRow = root.querySelector('.ms-row');
    root.querySelector('#msPrev').addEventListener('click', () => msRow.scrollBy({ left: -msRow.clientWidth * 0.8, behavior: RM ? 'auto' : 'smooth' }));
    root.querySelector('#msNext').addEventListener('click', () => msRow.scrollBy({ left:  msRow.clientWidth * 0.8, behavior: RM ? 'auto' : 'smooth' }));

    msRow.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.type, card.dataset.id));
    });
    initEdgeFade(msRow);
  }catch(e){
    root.innerHTML = `<div class="modal-backdrop"></div><div class="modal"><div class="empty"><div class="big">ERROR</div>${esc(e.message)}</div></div>`;
    root.querySelector('.modal-backdrop').addEventListener('click', closeDetail);
  }
}
function closeDetail(){
  const root = document.getElementById('modalRoot');
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.style.overflow = '';
}

/* ---------- CONTINUE WATCHING (core — unchanged) ---------- */
function renderContinueWatching(){
  const store = getProgressStore();
  const items = Object.values(store).filter(x => x.progress > 30).sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 10);
  const section = document.getElementById('contSection');
  if(!section) return;
  if(!items.length){ section.style.display = 'none'; return; }
  section.style.display = '';
  const row = document.getElementById('contRow');
  row.innerHTML = items.map(p => {
    const poster = p.poster_path ? IMG_BASE + p.poster_path : '';
    const pct = p.duration ? Math.min(99, Math.round(p.progress / p.duration * 100)) : 0;
    const mm = Math.floor(p.progress / 60);
    return `<div class="cw-card" data-id="${p.id}" data-type="${p.type}">
      <div class="im">${poster ? `<img src="${poster}" alt="">` : `<div class="noimg">${esc(p.title || '')}</div>`}</div>
      <div class="cw-meta">
        <h3>${esc(p.title || 'Untitled')}</h3>
        <div class="prog"><i style="width:${pct}%"></i></div>
        <small>${mm} MIN WATCHED · ${pct}%${p.season ? ` · S${p.season}E${p.episode}` : ''}</small>
      </div>
    </div>`;
  }).join('');
  document.getElementById('contCount').textContent = `${items.length} TITLES`;
  row.querySelectorAll('.cw-card').forEach(c => {
    c.addEventListener('click', () => location.hash = `#/watch/${c.dataset.type}/${c.dataset.id}`);
  });
  initEdgeFade(row);
}

/* ---------- LIBRARY PAGE (movies / series) ---------- */
async function pageList(type){
  const isM = type === 'movie';
  document.title = (isM ? 'Movies' : 'TV Series') + ' — REELHOUSE';
  heroShell.innerHTML = '';
  app.innerHTML = `
    <div class="page-banner"><h1>${isM ? 'MOVIES' : 'TV <b>SERIES</b>'}</h1>
      <p>// FULL ${isM ? 'MOVIE' : 'TV SERIES'} LIBRARY · POWERED BY TMDB + VIDEASY</p></div>
    <div class="toolbar">
      <input type="text" id="searchField" placeholder="🔍 Search ${isM ? 'movies' : 'series'}...">
      <select id="genreSelect"><option value="">ALL GENRES</option></select>
      <select id="sortSelect">
        <option value="popularity.desc">MOST POPULAR</option>
        <option value="vote_average.desc">TOP RATED</option>
        <option value="primary_release_date.desc">NEWEST</option>
      </select>
    </div>
    <div class="status" id="status">Loading...</div>
    <div class="grid" id="grid"><div class="loader">LOADING...</div></div>
    <div class="pagination" id="pagination"></div>`;

  const ls = { mediaType: type, page: 1, totalPages: 1, query: "", genre: "", sort: "popularity.desc" };
  const grid = document.getElementById('grid');
  const statusEl = document.getElementById('status');
  const paginationEl = document.getElementById('pagination');
  const searchInput = document.getElementById('searchField');
  const genreSelect = document.getElementById('genreSelect');
  const sortSelect = document.getElementById('sortSelect');

  try{
    const genres = await fetchGenres(type);
    genreSelect.innerHTML = '<option value="">ALL GENRES</option>' + genres.map(g => `<option value="${g.id}">${g.name.toUpperCase()}</option>`).join('');
  }catch(e){}

  function buildUrl(){
    const p = new URLSearchParams({ api_key: TMDB_API_KEY, language: "en-US", page: ls.page, include_adult: "false" });
    if(ls.query.trim()){
      p.set('query', ls.query.trim());
      return `${TMDB_BASE}/search/${ls.mediaType}?${p.toString()}`;
    }
    p.set('sort_by', ls.sort);
    if(ls.genre) p.set('with_genres', ls.genre);
    return `${TMDB_BASE}/discover/${ls.mediaType}?${p.toString()}`;
  }
  async function loadResults(){
    statusEl.textContent = "Loading...";
    grid.innerHTML = '<div class="loader">LOADING...</div>';
    try{
      const res = await fetch(buildUrl());
      const data = await res.json();
      if(!data.results || data.results.length === 0){
        grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">NO RESULTS</div>Try another keyword or filter.</div>`;
        statusEl.textContent = "";
        paginationEl.innerHTML = "";
        return;
      }
      ls.totalPages = Math.min(data.total_pages || 1, 500);
      grid.innerHTML = data.results.map(x => cardHTML(x, type)).join('');
      bindCards(grid);
      renderPagination();
      statusEl.textContent = `${data.total_results.toLocaleString()} titles found — page ${ls.page} / ${ls.totalPages}`;
    }catch(e){
      console.error(e);
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">ERROR</div>${esc(e.message)}</div>`;
      statusEl.textContent = "";
    }
  }
  function renderPagination(){
    const cur = ls.page, total = ls.totalPages;
    let pages = [];
    pages.push(1);
    for(let i = cur-2; i <= cur+2; i++){ if(i > 1 && i < total) pages.push(i); }
    if(total > 1) pages.push(total);
    pages = [...new Set(pages)].sort((a,b) => a-b);
    let html = `<button class="pg-btn" id="prevBtn" ${cur<=1?'disabled':''}>‹ PREV</button>`;
    let last = 0;
    pages.forEach(p => {
      if(last && p - last > 1) html += `<span style="color:var(--ink-dim);padding:0 4px;">…</span>`;
      html += `<button class="pg-btn ${p===cur?'active':''}" data-page="${p}">${p}</button>`;
      last = p;
    });
    html += `<button class="pg-btn" id="nextBtn" ${cur>=total?'disabled':''}>NEXT ›</button>`;
    paginationEl.innerHTML = html;
    paginationEl.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => { ls.page = parseInt(btn.dataset.page); loadResults(); window.scrollTo({top:0, behavior:'smooth'}); });
    });
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if(prevBtn) prevBtn.addEventListener('click', () => { if(ls.page > 1){ ls.page--; loadResults(); window.scrollTo({top:0, behavior:'smooth'}); } });
    if(nextBtn) nextBtn.addEventListener('click', () => { if(ls.page < ls.totalPages){ ls.page++; loadResults(); window.scrollTo({top:0, behavior:'smooth'}); } });
  }
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { ls.query = searchInput.value; ls.page = 1; loadResults(); }, 450);
  });
  genreSelect.addEventListener('change', () => { ls.genre = genreSelect.value; ls.page = 1; loadResults(); });
  sortSelect.addEventListener('change', () => { ls.sort = sortSelect.value; ls.page = 1; loadResults(); });
  loadResults();
}

/* ---------- MY LIST ---------- */
function pageMyList(){
  document.title = 'My List — REELHOUSE';
  heroShell.innerHTML = '';
  const items = state.mylist;
  app.innerHTML = `
    <div class="page-banner"><h1>MY <b>LIST</b></h1><p>// TITLES SAVED IN YOUR BROWSER</p></div>
    <div class="status">${items.length} TITLES SAVED</div>
    <div class="grid">${items.length
      ? items.map(x => cardHTML({ ...x, poster_path: x.poster, release_date: (x.year||'') + '-01-01', vote_average: parseFloat(x.rating) || 0, title: x.title }, x.type)).join('')
      : `<div class="empty" style="grid-column:1/-1"><div class="big">YOUR LIST IS EMPTY</div>Press the <b style="color:var(--gold)">+ MY LIST</b> button on any title to save it here.</div>`}</div>`;
  bindCards(app.querySelector('.grid'));
}

/* ---------- WATCH PAGE (Videasy core — untouched) ---------- */
async function pageWatch(type, id){
  document.title = 'Loading... — REELHOUSE';
  heroShell.innerHTML = '';
  app.innerHTML = `<div class="watch-wrap"><div class="loader">LOADING FROM TMDB...</div></div>`;
  try{
    const detail = await tmdb(`/${type}/${id}`, { append_to_response: "credits,similar,videos" });
    const title = detail.title || detail.name || 'Untitled';
    const year = (detail.release_date || detail.first_air_date || '').slice(0,4);
    const rating = detail.vote_average ? detail.vote_average.toFixed(1) : 'N/A';
    const backdrop = detail.backdrop_path ? IMG_BACKDROP + detail.backdrop_path : '';
    const dur = type === 'movie' ? (detail.runtime ? `${Math.floor(detail.runtime/60)}h ${detail.runtime%60}m` : '—') : `${detail.number_of_seasons || '?'} Seasons`;
    const genres = (detail.genres || []).map(g => g.name).join(' · ') || '—';
    const overview = detail.overview || 'No synopsis available.';
    const similar = (detail.similar && detail.similar.results) ? detail.similar.results.slice(0,8) : [];
    document.title = title + ' — REELHOUSE';
    const saved = type === 'movie' ? getSavedProgress('movie', id) : null;
    const resumeChip = (saved && saved.progress > 30) ? `<span class="resume-chip">⏵ RESUME ${Math.round((saved.progress||0)/60)} MIN</span>` : '';
    const isSeries = type === 'tv';
    const seasons = isSeries ? (detail.seasons || []).filter(s => s.season_number > 0) : [];
    app.innerHTML = `
      <div class="watch-wrap">
        <div class="watch-top">
          <a class="back" href="javascript:history.back()">← BACK</a>
          <button class="fs-out" id="cFull" title="Toggle fullscreen">⤢ &nbsp;FULLSCREEN</button>
        </div>
        <div class="player" id="player">
          ${backdrop ? `<img class="poster" src="${backdrop}" alt="" id="poster">` : ''}
          <span class="src-badge">SOURCE: <b>VIDEASY</b> · THIRD-PARTY</span>
          ${resumeChip}
          <iframe id="playerFrame" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe>
        </div>
        ${isSeries ? `
          <div class="ep-picker" id="epPicker">
            <div class="ep-pick-group">
              <label>SEASON</label>
              <select id="seasonSelect">${seasons.map(s => `<option value="${s.season_number}" data-episodes="${s.episode_count}">SEASON ${s.season_number} (${s.episode_count} EP)</option>`).join('')}</select>
            </div>
            <div class="ep-pick-group">
              <label>EPISODE</label>
              <select id="episodeSelect"></select>
            </div>
          </div>
        ` : ''}
        <div class="watch-title">
          <h1>${esc(title).toUpperCase()}</h1>
          <div class="hero-meta" style="margin:0 0 8px">
            <span class="chip gold">★ ${rating}</span><span class="chip">${year}</span>
            <span class="chip">${dur}</span><span class="chip">${isSeries ? 'SERIES' : 'MOVIE'}</span>
            <button class="btn btn-ghost" id="wList" style="padding:10px 18px;font-size:13px">+ &nbsp;MY LIST</button>
          </div>
        </div>
        <div class="watch-info">
          <div class="wsec">
            <h4>STORYLINE</h4><p>${esc(overview)}</p>
            <dl class="wdetail">
              <dt>TITLE</dt><dd>${esc(title)}</dd>
              <dt>GENRE</dt><dd>${esc(genres)}</dd>
              <dt>${isSeries ? 'SEASONS' : 'RUNTIME'}</dt><dd>${dur}</dd>
              <dt>STATUS</dt><dd style="color:var(--gold)">● Available via Videasy</dd>
              <dt>SCORE</dt><dd>★ ${rating} / 10</dd>
            </dl>
          </div>
          <div class="wsec">
            <h4>MORE LIKE THIS</h4>
            <div class="row">${similar.length ? similar.map(r => cardHTML(r, type)).join('') : '<p style="color:var(--ink-dim)">No suggestions.</p>'}</div>
          </div>
        </div>
      </div>`;

    const wl = document.getElementById('wList');
    const syncL = () => { const on = inList(type, id); wl.classList.toggle('on', on); wl.innerHTML = on ? '✓ &nbsp;IN MY LIST' : '+ &nbsp;MY LIST'; };
    wl.addEventListener('click', () => { toggleList({ type, id, title, poster: detail.poster_path, year, rating, overview }); syncL(); });
    syncL();
    bindCards(app.querySelector('.wsec:last-child .row'));
    initEdgeFade(app.querySelector('.wsec:last-child .row'));

    /* ===== Player logic (core — unchanged) ===== */
    const player = document.getElementById('player');
    const playerFrame = document.getElementById('playerFrame');
    const posterImg = document.getElementById('poster');

    // Fullscreen the wrapper div itself (not the iframe) — sidesteps
    // Videasy's own nested-iframe permissions-policy issue entirely.
    function goFS(){
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if(fsEl){
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        (player.requestFullscreen || player.webkitRequestFullscreen).call(player);
      }
    }
    document.getElementById('cFull').addEventListener('click', goFS);

    // Force landscape on phones via CSS rotation instead of the Screen
    // Orientation Lock API — that API is unreliable (not supported on iOS,
    // flaky on Android especially with a cross-origin iframe inside), and
    // it's easy for it to end up "stuck". This just checks the actual
    // viewport dimensions every time fullscreen state or size changes, so
    // it always self-corrects instead of getting stuck one way.
    function syncForcedLandscape(){
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      const isPortrait = window.innerWidth < window.innerHeight;
      player.classList.toggle('force-landscape', !!fsEl && isPortrait);
    }
    document.addEventListener('fullscreenchange', syncForcedLandscape);
    document.addEventListener('webkitfullscreenchange', syncForcedLandscape);
    window.addEventListener('resize', syncForcedLandscape);

    function loadEmbed(){
      if(type === 'movie'){
        const saved = getSavedProgress('movie', id);
        const params = new URLSearchParams({ color: VIDEASY_COLOR, overlay: 'true' });
        if(saved && saved.progress) params.set('progress', Math.floor(saved.progress));
        playerFrame.src = `${VIDEASY_BASE}/movie/${id}?${params.toString()}`;
      } else {
        loadTvEmbed();
      }
      if(posterImg) posterImg.style.opacity = 0.08;
    }
    function loadTvEmbed(){
      const season = document.getElementById('seasonSelect').value || 1;
      const episode = document.getElementById('episodeSelect').value || 1;
      const saved = getSavedProgress('tv', id, season, episode);
      const params = new URLSearchParams({ color: VIDEASY_COLOR, overlay: 'true', episodeSelector: 'true', nextEpisode: 'true', autoplayNextEpisode: 'true' });
      if(saved && saved.progress) params.set('progress', Math.floor(saved.progress));
      playerFrame.src = `${VIDEASY_BASE}/tv/${id}/${season}/${episode}?${params.toString()}`;
    }
    function populateEpisodes(){
      const epCount = parseInt(document.getElementById('seasonSelect').selectedOptions[0]?.dataset.episodes || 1);
      const epSel = document.getElementById('episodeSelect');
      epSel.innerHTML = Array.from({length: epCount}, (_, i) => `<option value="${i+1}">EPISODE ${i+1}</option>`).join('');
    }
    if(isSeries){
      populateEpisodes();
      document.getElementById('seasonSelect').addEventListener('change', () => { populateEpisodes(); loadTvEmbed(); });
      document.getElementById('episodeSelect').addEventListener('change', loadTvEmbed);
    }
    loadEmbed();
  }catch(e){
    console.error(e);
    app.innerHTML = `<div class="watch-wrap"><div class="empty"><div class="big">ERROR</div>${esc(e.message)}. <a href="#/" style="color:var(--gold)">Back to Home</a></div></div>`;
  }
}

/* ===== ROUTER (unchanged) ===== */
function route(){
  closeDetail();
  clearInterval(heroTimer); // stop hero auto-rotate before the page (and its DOM) changes
  const h = location.hash.replace(/^#\/?/, '');
  const [path] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.r === (seg[0] || 'home')));
  if(!seg.length) pageHome();
  else if(seg[0] === 'filem') pageList('movie');
  else if(seg[0] === 'siri') pageList('tv');
  else if(seg[0] === 'mylist') pageMyList();
  else if(seg[0] === 'watch' && seg[1] && seg[2]) pageWatch(seg[1], seg[2]);
  else pageHome();
}
window.addEventListener('hashchange', route);

/* ===== GLOBAL ===== */
window.addEventListener('scroll', () => document.getElementById('hdr').classList.toggle('scrolled', scrollY > 40), { passive: true });

/* Cross-origin iframes (Videasy) swallow keyboard events while they hold focus.
   The moment the pointer leaves the player area, pull focus back to the page
   so ESC (and other shortcuts) work again. */
document.addEventListener('mousemove', () => {
  const el = document.activeElement;
  if(el && el.tagName === 'IFRAME'){ el.blur(); window.focus(); }
}, { passive: true });

const sl = document.getElementById('searchLayer');
const si = document.getElementById('searchInput');
const sr = document.getElementById('searchResults');

async function doSearch(q){
  if(!q){ sr.innerHTML = ''; return; }
  sr.innerHTML = '<div class="loader" style="grid-column:1/-1">SEARCHING...</div>';
  try{
    const [mRes, tRes] = await Promise.all([
      tmdb('/search/movie', { query: q, page: 1 }),
      tmdb('/search/tv', { query: q, page: 1 })
    ]);
    const all = [
      ...mRes.results.map(x => ({...x, media_type:'movie'})),
      ...tRes.results.map(x => ({...x, media_type:'tv'}))
    ].sort((a,b) => (b.popularity||0) - (a.popularity||0));
    if(!all.length){ sr.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">NO RESULTS</div>Try another keyword.</div>`; return; }
    sr.innerHTML = all.slice(0, 30).map(x => cardHTML(x, x.media_type)).join('');
    bindCards(sr);
  }catch(e){
    sr.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">ERROR</div>${esc(e.message)}</div>`;
  }
}
function openSearch(){ sl.classList.add('open'); si.value = ''; sr.innerHTML = ''; setTimeout(() => si.focus(), 50); }
function closeSearch(){ sl.classList.remove('open'); }

document.getElementById('searchBtn').addEventListener('click', openSearch);
document.getElementById('searchClose').addEventListener('click', closeSearch);

/* ===== MOBILE NAV (off-canvas menu for tablet/phone) ===== */
const menuBtn = document.getElementById('menuBtn');
const siteNav = document.getElementById('siteNav');
const navBackdrop = document.getElementById('navBackdrop');
function openNav(){
  siteNav.classList.add('open');
  navBackdrop.classList.add('show');
  menuBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('nav-lock');
}
function closeNav(){
  siteNav.classList.remove('open');
  navBackdrop.classList.remove('show');
  menuBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('nav-lock');
}
if(menuBtn){
  menuBtn.addEventListener('click', () => {
    siteNav.classList.contains('open') ? closeNav() : openNav();
  });
}
if(navBackdrop) navBackdrop.addEventListener('click', closeNav);
if(siteNav) siteNav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeNav));
window.addEventListener('hashchange', closeNav);
window.addEventListener('resize', () => { if(innerWidth > 860) closeNav(); });
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && siteNav && siteNav.classList.contains('open')) closeNav();
});
let searchTimer;
si.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => doSearch(si.value.trim()), 400);
});

/* ESC order: close search → close modal → stop stream & go back */
document.addEventListener('keydown', e => {
  const typing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  if(e.key === 'Escape'){
    if(sl.classList.contains('open')){ closeSearch(); return; }
    if(document.getElementById('modalRoot').classList.contains('open')){ closeDetail(); return; }
    if(location.hash.indexOf('#/watch') === 0){
      if(document.fullscreenElement || document.webkitFullscreenElement) return;
      const f = document.getElementById('playerFrame');
      if(f) f.src = 'about:blank';
      if(history.length > 1) history.back();
      else location.hash = '#/';
      return;
    }
  }
  if(!typing && e.key === '/'){ e.preventDefault(); openSearch(); }
});

/* ===== INIT ===== */
if(keyMissing()) showKeyBanner();
updateBadge();
fetchGenres('movie');
fetchGenres('tv');
route();