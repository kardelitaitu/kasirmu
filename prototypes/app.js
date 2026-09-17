/* Design Language interactivity */
  /* ── Theme toggle ─────────────────────────────── */
  const toggle = document.getElementById('theme-toggle');
  const label = document.getElementById('theme-label');
  const iconSun = toggle.querySelector('.icon-sun');
  const iconMoon = toggle.querySelector('.icon-moon');

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (theme === 'dark') {
      iconSun.style.display = 'none';
      iconMoon.style.display = '';
      label.textContent = 'Light';
    } else {
      iconSun.style.display = '';
      iconMoon.style.display = 'none';
      label.textContent = 'Dark';
    }
  }

  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  /* ── Range slider live fill + value sync ──────── */
  const sliderLabels = {
    'dl-slider-sound':   { el: 'dl-slider-sound-val',   suffix: '%' },
    'dl-slider-yellow':  { el: 'dl-slider-yellow-val',  suffix: ' min' },
    'dl-slider-red':     { el: 'dl-slider-red-val',     suffix: ' min' },
  };
  function syncSliderFill(slider) {
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--fill) ${pct}%, var(--chip-bg) ${pct}%)`;
    const lbl = sliderLabels[slider.id];
    if (lbl) {
      const span = document.getElementById(lbl.el);
      if (span) span.textContent = slider.value + lbl.suffix;
    }
  }
  document.querySelectorAll('input[type=range]').forEach(s => {
    syncSliderFill(s);
    s.addEventListener('input', () => syncSliderFill(s));
  });

  /* ── Menu sliders (interactive) ─────────── */
  // Store state per track so we can re-position after tab switch
  var msStates = [];
  function initMenuSliders() {
    document.querySelectorAll('.ms-track').forEach(function(track, ti) {
      var btns = track.querySelectorAll('button');
      var indicator = track.querySelector('.ms-indicator');
      var colors = track.dataset.colors ? track.dataset.colors.split(',') : null;
      // Only create state once
      if (!msStates[ti]) {
        msStates[ti] = {
          track: track,
          btns: btns,
          indicator: indicator,
          colors: colors,
          active: parseInt(track.dataset.active || '0', 10)
        };
        // Attach click handlers once
        btns.forEach(function(btn, i) {
          btn.addEventListener('click', function() {
            msStates[ti].active = i;
            positionIndicator(msStates[ti]);
          });
        });
      }
    });
  }
  function positionIndicator(state) {
    var btn = state.btns[state.active];
    if (!btn || !btn.offsetWidth) return; // panel hidden, skip
    state.indicator.style.left = btn.offsetLeft + 'px';
    state.indicator.style.width = btn.offsetWidth + 'px';
    if (state.colors && state.colors[state.active]) {
      state.indicator.style.background = state.colors[state.active];
    }
    state.btns.forEach(function(b, i) {
      if (i === state.active) {
        b.style.color = '#fff';
        b.style.opacity = '1';
      } else {
        b.style.color = '';
        b.style.opacity = '0.5';
      }
    });
  }
  function positionAllSliders() {
    msStates.forEach(function(s) { positionIndicator(s); });
  }
  // Set up click handlers (can run even if hidden)
  initMenuSliders();

  /* ── Tab switching ────────────────────────────── */
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  const validTabs = [...tabs].map(t => t.dataset.tab);

  // Add ARIA attributes on init
  tabs.forEach(t => {
    t.id = 'tab-' + t.dataset.tab;
    t.setAttribute('aria-selected', t.classList.contains('active') ? 'true' : 'false');
    t.setAttribute('aria-controls', 'panel-' + t.dataset.tab);
  });
  panels.forEach(p => {
    const tabName = p.id.replace('panel-', '');
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', 'tab-' + tabName);
    p.setAttribute('aria-hidden', p.classList.contains('active') ? 'false' : 'true');
  });

  function activateTab(name, scroll) {
    if (!validTabs.includes(name)) return;
    tabs.forEach(t => {
      const isActive = t.dataset.tab === name;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach(p => {
      const isActive = p.id === 'panel-' + name;
      p.classList.toggle('active', isActive);
      p.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });
    if (scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Deep link — #forms opens the Forms tab
  function tabFromHash() {
    const h = window.location.hash.replace(/^#/, '');
    return validTabs.includes(h) ? h : null;
  }

  function activateTabAndHash(name, opts) {
    activateTab(name, opts && opts.scroll === false ? false : undefined);
    history.replaceState(null, '', '#' + name);
    if (name === 'buttons') requestAnimationFrame(positionAllSliders);
  }

  const initial = tabFromHash();
  if (initial) {
    activateTab(initial, false); // no scroll on initial load
    if (initial === 'buttons') requestAnimationFrame(positionAllSliders);
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activateTabAndHash(tab.dataset.tab);
    });
  });

  // Keyboard navigation per WAI-ARIA tabs pattern
  const tabList = document.querySelector('.tabbar-inner');
  if (tabList) {
    tabList.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        next = (idx + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        next = (idx - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        next = 0;
      } else if (e.key === 'End') {
        next = tabs.length - 1;
      }
      if (next !== -1) {
        e.preventDefault();
        tabs[next].focus();
        activateTabAndHash(tabs[next].dataset.tab);
      }
    });
  }

  window.addEventListener('hashchange', () => {
    const h = tabFromHash();
    if (h) {
      activateTabAndHash(h);
    }
  });
  window.addEventListener('resize', positionAllSliders);

  /* Menu slider button transitions */
  document.querySelectorAll('.ms-track button').forEach(function(b) {
    b.style.transition = 'color 0.28s cubic-bezier(0.33,1,0.68,1), opacity 0.28s cubic-bezier(0.33,1,0.68,1)';
  });

  /* ── Motion & Feedback demos ──────────────────── */
  const ICON_BUSY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>';
  const ICON_DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  // Busy → Done
  const saveBtn = document.getElementById('demo-save');
  const saveHint = document.getElementById('demo-save-hint');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (saveBtn.dataset.state === 'busy') return;
      saveBtn.dataset.state = 'busy';
      saveBtn.classList.add('is-busy');
      saveBtn.querySelector('.fb-icon').innerHTML = ICON_BUSY;
      saveBtn.querySelector('.fb-icon').classList.add('kds-spin');
      saveBtn.querySelector('.fb-label').textContent = 'Saving';
      saveHint.textContent = 'Feedback: spinner starts instantly, work happens behind it…';
      setTimeout(() => {
        saveBtn.classList.remove('is-busy');
        saveBtn.classList.add('is-done');
        saveBtn.querySelector('.fb-icon').innerHTML = ICON_DONE;
        saveBtn.querySelector('.fb-icon').classList.remove('kds-spin');
        saveBtn.querySelector('.fb-icon').classList.add('kds-pop');
        saveBtn.querySelector('.fb-label').textContent = 'Saved';
        saveHint.textContent = 'After: green confirmation. The action is confirmed by visuals alone.';
        setTimeout(() => {
          saveBtn.classList.remove('is-done');
          saveBtn.querySelector('.fb-icon').innerHTML = '';
          saveBtn.querySelector('.fb-icon').classList.remove('kds-pop');
          saveBtn.querySelector('.fb-label').textContent = 'Save';
          saveHint.textContent = 'Click to run the full before → feedback → after cycle.';
          saveBtn.dataset.state = 'idle';
        }, 2000);
      }, 1200);
    });
  }

  // Error shake
  const errInput = document.getElementById('demo-error-input');
  const errBtn = document.getElementById('demo-error-btn');
  if (errBtn && errInput) {
    const shake = () => {
      errInput.classList.remove('kds-shake');
      void errInput.offsetWidth; // restart animation
      errInput.classList.add('kds-shake');
      errInput.style.border = '2px solid var(--danger)';
    };
    errBtn.addEventListener('click', () => {
      const ok = errInput.value.trim().toLowerCase() === 'ok';
      if (ok) {
        errInput.style.border = '2px solid var(--success)';
        errBtn.textContent = 'Valid';
        setTimeout(() => {
          errInput.style.border = '1px solid var(--border)';
          errBtn.textContent = 'Validate';
        }, 1600);
      } else {
        shake();
        errBtn.textContent = 'Invalid';
        setTimeout(() => { errBtn.textContent = 'Validate'; }, 1000);
      }
    });
  }

  // Easing comparison
  const easePlay = document.getElementById('ease-play');
  const easeDots = document.querySelectorAll('.ease-dot');
  if (easePlay) {
    easePlay.addEventListener('click', () => {
      const track = document.querySelector('.ease-track');
      const travel = (track ? track.clientWidth : 300) - 24;
      easeDots.forEach(d => {
        d.classList.remove('running');
        d.style.left = '8px';
      });
      void document.body.offsetWidth; // reflow before animating
      easeDots.forEach(d => {
        d.classList.add('running');
        d.style.left = travel + 'px';
      });
    });
  }

  /* ── Floating scrollbar ────────────────────────── */
  const scrollIndicator = document.getElementById('scroll-indicator');
  const scrollThumb = document.getElementById('scroll-thumb');
  let scrollHideTimer = null;

  function updateScrollIndicator() {
    if (!scrollIndicator || !scrollThumb) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) {
      scrollIndicator.classList.remove('visible');
      return;
    }
    const ratio = window.innerHeight / document.documentElement.scrollHeight;
    const thumbH = Math.max(36, Math.round(window.innerHeight * ratio));
    const travel = window.innerHeight - thumbH;
    const y = Math.round((window.scrollY / max) * travel);
    scrollThumb.style.height = thumbH + 'px';
    scrollThumb.style.top = y + 'px';
    scrollIndicator.classList.add('visible');
    clearTimeout(scrollHideTimer);
    scrollHideTimer = setTimeout(() => {
      scrollIndicator.classList.remove('visible');
    }, 900);
  }

  window.addEventListener('scroll', updateScrollIndicator, { passive: true });
  window.addEventListener('resize', updateScrollIndicator);
  window.addEventListener('load', updateScrollIndicator);
  updateScrollIndicator();

  /* ── Scroll-to-top button ──────────────────────── */
  const scrollTopBtn = document.createElement('button');
  scrollTopBtn.className = 'scroll-top';
  scrollTopBtn.type = 'button';
  scrollTopBtn.setAttribute('aria-label', 'Scroll to top');
  scrollTopBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
  document.body.appendChild(scrollTopBtn);

  scrollTopBtn.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function updateScrollTopBtn() {
    if (window.scrollY > 400) {
      scrollTopBtn.classList.add('is-visible');
    } else {
      scrollTopBtn.classList.remove('is-visible');
    }
  }
  window.addEventListener('scroll', updateScrollTopBtn, { passive: true });

  /* ── Email validation icon ─────────────────────── */
  const emailInput = document.getElementById('dl-input-email');
  if (emailInput) {
    const emailWrap = emailInput.closest('.input-valid-wrap');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function validateEmail() {
      const valid = emailRegex.test(emailInput.value);
      emailWrap.classList.toggle('is-valid', valid);
    }
    emailInput.addEventListener('input', validateEmail);
    validateEmail(); // check initial value
  }

  /* ── Audit demos ────────────────────────────────── */
  // Example 1 — Start order (data-testid="dl-comp-start-order")
  const auditStart = document.getElementById('audit-start');
  if (auditStart) {
    auditStart.addEventListener('click', () => {
      if (auditStart.dataset.state === 'done') return;
      auditStart.dataset.state = 'done';
      auditStart.classList.add('is-done');
      auditStart.disabled = true;
      auditStart.textContent = 'Started ✓';
    });
  }

  // Example 3 — Filter tabs
  const auditFilters = document.querySelectorAll('.audit-filter');
  auditFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      auditFilters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  /* ── Code block copy-to-clipboard ──────────────── */
  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  document.querySelectorAll('pre.codeblock, pre.snippet-block').forEach(function(pre) {
    // Wrap in a container
    const wrap = document.createElement('div');
    wrap.className = 'codeblock-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    // Create copy button
    const btn = document.createElement('button');
    btn.className = 'codeblock-copy';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Copy code to clipboard');
    btn.innerHTML = COPY_ICON + '<span>Copy</span>';
    wrap.appendChild(btn);

    // Click handler
    btn.addEventListener('click', function() {
      const code = pre.querySelector('code');
      const text = stripHtml(code.innerHTML);
      navigator.clipboard.writeText(text).then(function() {
        btn.innerHTML = CHECK_ICON + '<span>Copied!</span>';
        btn.classList.add('is-copied');
        setTimeout(function() {
          btn.innerHTML = COPY_ICON + '<span>Copy</span>';
          btn.classList.remove('is-copied');
        }, 1500);
      }).catch(function() {
        // Fallback: select text
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    });
  });
