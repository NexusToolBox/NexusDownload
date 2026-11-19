// 公共脚本：手机菜单、进入视口淡入、站内搜索、文档目录
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- 导航：手机菜单 + 滚动后加阴影
  const nav = $('[data-nav]');
  const toggle = nav?.querySelector('.nav__toggle');
  toggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  const onScroll = () => nav?.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- 动效开关：记住选择，刷新后生效
  $$('[data-motion-toggle]').forEach((b) => {
    const rm = document.documentElement.classList.contains('rm');
    b.setAttribute('aria-pressed', String(!rm));
    b.addEventListener('click', () => {
      try { localStorage.setItem('nx-motion', rm ? 'full' : 'reduce'); } catch (e) {}
      const u = new URL(location.href);
      u.searchParams.delete('motion');
      location.replace(u.href);
    });
  });

  // ---------- 进入视口淡入：给元素加 class="reveal" 即可
  const items = $$('.reveal');
  if ('IntersectionObserver' in window && items.length) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  } else items.forEach((el) => el.classList.add('is-in'));

  // ---------- 站内搜索（Ctrl K / ⌘K / “/”）
  const tpl = $('#search-tpl');
  let box = null, index = null, results = [], active = 0, lastFocus = null;
  const lang = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  async function loadIndex() {
    if (!index) index = fetch(`/assets/search/${lang}.json`).then((r) => r.json()).catch(() => []);
    return index;
  }
  function snippet(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text.slice(0, 90)) + '…';
    const a = Math.max(0, i - 28), b = Math.min(text.length, i + q.length + 60);
    return (a ? '…' : '') + esc(text.slice(a, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, b)) + (b < text.length ? '…' : '');
  }
  async function run(qRaw) {
    const q = qRaw.trim().toLowerCase();
    const list = $('.search__results', box), hint = $('.search__hint', box);
    if (!q) { list.innerHTML = ''; results = []; hint.textContent = hint.dataset.hint; hint.hidden = false; return; }
    const data = await loadIndex();
    results = data
      .map((d) => {
        let score = 0;
        if (d.t.toLowerCase().includes(q)) score += 10;
        const h = d.h.find((x) => x.toLowerCase().includes(q));
        if (h) score += 5;
        if (d.x.toLowerCase().includes(q)) score += 1;
        return { d, h, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    active = 0;
    hint.hidden = results.length > 0;
    hint.textContent = hint.dataset.empty;
    list.innerHTML = results
      .map((r, i) => `<a class="search__item" role="option" href="${r.d.u}" data-i="${i}"${i === 0 ? ' aria-selected="true"' : ''}>
        <small>${esc(r.d.s)}${r.h ? ' / ' + esc(r.h) : ''}</small><b>${esc(r.d.t)}</b><span>${snippet(r.d.x, q)}</span></a>`)
      .join('');
  }
  function select(i) {
    const els = $$('.search__item', box);
    if (!els.length) return;
    active = (i + els.length) % els.length;
    els.forEach((el, j) => el.toggleAttribute('aria-selected', j === active));
    els[active].scrollIntoView({ block: 'nearest' });
  }
  function openSearch() {
    if (!tpl) return;
    if (!box) {
      box = tpl.content.firstElementChild.cloneNode(true);
      document.body.appendChild(box);
      const input = $('input', box);
      input.addEventListener('input', () => run(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); select(active + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1); }
        else if (e.key === 'Enter') { const a = $$('.search__item', box)[active]; if (a) location.href = a.href; }
      });
      box.addEventListener('click', (e) => { if (e.target.closest('[data-search-close]')) closeSearch(); });
      box.addEventListener('mousemove', (e) => { const it = e.target.closest('.search__item'); if (it) select(+it.dataset.i); });
      loadIndex();
    }
    lastFocus = document.activeElement;
    box.classList.add('is-open');
    document.documentElement.classList.add('is-locked');
    requestAnimationFrame(() => $('input', box).focus());
  }
  function closeSearch() {
    box?.classList.remove('is-open');
    document.documentElement.classList.remove('is-locked');
    lastFocus?.focus?.();
  }
  $$('[data-search-open]').forEach((b) => b.addEventListener('click', openSearch));
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); box?.classList.contains('is-open') ? closeSearch() : openSearch(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); openSearch(); }
    else if (e.key === 'Escape') {
      if (box?.classList.contains('is-open')) closeSearch();
      else if (nav?.classList.contains('is-open')) { nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); }
    }
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) $$('kbd').forEach((k) => { if (k.textContent === 'Ctrl K') k.textContent = '⌘K'; });

  // ---------- 文档页：标题锚点、“本页内容”、当前小节高亮
  const toc = $('[data-toc]');
  if (toc) {
    const heads = $$('.prose h2');
    heads.forEach((h, i) => {
      if (!h.id) h.id = 's' + (i + 1);
      const a = document.createElement('a');
      a.className = 'anchor'; a.href = '#' + h.id; a.setAttribute('aria-label', h.textContent); a.textContent = '#';
      h.appendChild(a);
      const li = document.createElement('li');
      li.innerHTML = `<a href="#${h.id}">${esc(h.firstChild.textContent)}</a>`;
      toc.appendChild(li);
    });
    if (heads.length < 2) toc.closest('.docs__toc')?.classList.add('is-empty');
    const links = $$('a', toc);
    const spy = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        links.forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + en.target.id));
      }
    }, { rootMargin: '-15% 0px -70% 0px' });
    heads.forEach((h) => spy.observe(h));
  }

  // 文档页：手机上的目录折叠
  const sideToggle = $('.docs__side-toggle');
  sideToggle?.addEventListener('click', () => {
    const side = sideToggle.closest('.docs__side');
    const open = side.classList.toggle('is-open');
    sideToggle.setAttribute('aria-expanded', String(open));
  });
})();
