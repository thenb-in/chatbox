/**
 * Compact country dial-code picker.
 *
 *   var picker = NTDialPicker.create({ selected: '+91', onChange: fn, ariaLabel: '...' });
 *   parent.appendChild(picker.element);
 *   picker.getValue();          // -> '+91'
 *   picker.setValue('+44');     // programmatic update
 *
 * Renders as a small button (showing just the dial code, e.g. "+91 ▾") so
 * the phone number field next to it can use the rest of the row. Clicking
 * the button opens a searchable popover anchored via position:fixed so it
 * isn't clipped by the chat panel's overflow:hidden.
 *
 * Depends on window.NTIPLocation (for getAllDialCodes + getDialCode).
 */
(function () {
  'use strict';

  if (window.NTDialPicker) return;

  var STYLE_ID = 'nt-dial-picker-styles';
  var CSS = [
    '.nt-dial-picker{position:relative;display:inline-flex;flex:0 0 auto;}',
    '.nt-dial-picker-btn{display:inline-flex;align-items:center;gap:6px;',
      'padding:10px 10px;border:1.5px solid #e2e8f0;border-radius:10px;',
      'background:#fff;font-family:inherit;font-size:14px;color:#0f172a;',
      'cursor:pointer;line-height:1.2;transition:border-color .15s ease;',
      'min-width:74px;justify-content:center;}',
    '.nt-dial-picker-btn:hover{border-color:#cbd5e1;}',
    '.nt-dial-picker-btn[aria-expanded="true"]{border-color:#2f5597;}',
    '.nt-dial-picker-val{font-weight:600;letter-spacing:.2px;}',
    '.nt-dial-picker-caret{color:#64748b;font-size:10px;line-height:1;}',
    '.nt-dial-picker-pop{position:fixed;z-index:1000000;background:#fff;',
      'border:1px solid #e2e8f0;border-radius:10px;',
      'box-shadow:0 12px 32px rgba(15,23,42,.18);width:280px;max-width:92vw;',
      'max-height:320px;display:flex;flex-direction:column;overflow:hidden;',
      'font-family:inherit;}',
    '.nt-dial-picker-pop[hidden]{display:none;}',
    '.nt-dial-picker-search{border:none;border-bottom:1px solid #e2e8f0;',
      'padding:10px 12px;font:inherit;font-size:13px;outline:none;color:#0f172a;',
      'background:#f8fafc;}',
    '.nt-dial-picker-search:focus{background:#fff;}',
    '.nt-dial-picker-list{overflow-y:auto;padding:4px 0;flex:1 1 auto;min-height:0;}',
    '.nt-dial-picker-row{display:flex;justify-content:space-between;align-items:center;',
      'padding:8px 12px;font-size:13px;color:#0f172a;cursor:pointer;gap:12px;}',
    '.nt-dial-picker-row:hover,.nt-dial-picker-row.is-active{background:#f1f5f9;}',
    '.nt-dial-picker-row.is-selected{background:#eff6ff;font-weight:600;}',
    '.nt-dial-picker-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.nt-dial-picker-dial{color:#64748b;flex-shrink:0;}',
    '.nt-dial-picker-empty{padding:14px;text-align:center;color:#94a3b8;font-size:13px;}'
  ].join('');

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getList() {
    return (window.NTIPLocation && window.NTIPLocation.getAllDialCodes)
      ? window.NTIPLocation.getAllDialCodes() : [];
  }
  function getIpDial() {
    return (window.NTIPLocation && window.NTIPLocation.getDialCode)
      ? window.NTIPLocation.getDialCode() : null;
  }

  function findEntry(dial) {
    var list = getList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].dial === dial) return list[i];
    }
    return null;
  }

  function create(opts) {
    opts = opts || {};
    injectStyles();

    var current = opts.selected || getIpDial() || '+91';
    var currentEntry = findEntry(current);

    var container = document.createElement('div');
    container.className = 'nt-dial-picker';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nt-dial-picker-btn';
    btn.setAttribute('aria-label', opts.ariaLabel || 'Country code');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    var btnVal = document.createElement('span');
    btnVal.className = 'nt-dial-picker-val';
    btnVal.textContent = current;

    var caret = document.createElement('span');
    caret.className = 'nt-dial-picker-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾'; // ▾

    btn.appendChild(btnVal);
    btn.appendChild(caret);
    if (currentEntry) btn.title = currentEntry.name + ' (' + currentEntry.dial + ')';

    var pop = document.createElement('div');
    pop.className = 'nt-dial-picker-pop';
    pop.setAttribute('role', 'dialog');
    pop.hidden = true;

    var search = document.createElement('input');
    search.type = 'text';
    search.className = 'nt-dial-picker-search';
    search.placeholder = 'Search country or code…';
    search.setAttribute('aria-label', 'Search country');
    search.autocomplete = 'off';
    search.autocapitalize = 'none';

    var listEl = document.createElement('div');
    listEl.className = 'nt-dial-picker-list';
    listEl.setAttribute('role', 'listbox');

    pop.appendChild(search);
    pop.appendChild(listEl);
    container.appendChild(btn);

    var activeIdx = -1;
    var rendered = [];

    function renderList(filter) {
      var q = (filter || '').toLowerCase().trim();
      // Allow searching with or without the leading '+'
      var qDial = q.replace(/^\+?/, '');
      var list = getList();
      rendered = q ? list.filter(function (c) {
        return c.name.toLowerCase().indexOf(q) !== -1 ||
               c.iso.toLowerCase().indexOf(q) !== -1 ||
               c.dial.indexOf(qDial) !== -1;
      }) : list;

      var html = rendered.map(function (c) {
        var sel = c.dial === current ? ' is-selected' : '';
        return '<div class="nt-dial-picker-row' + sel + '" role="option"' +
               ' data-dial="' + esc(c.dial) + '" data-iso="' + esc(c.iso) + '">' +
                 '<span class="nt-dial-picker-name">' + esc(c.name) + '</span>' +
                 '<span class="nt-dial-picker-dial">' + esc(c.dial) + '</span>' +
               '</div>';
      }).join('');
      listEl.innerHTML = html ||
        '<div class="nt-dial-picker-empty">No matches</div>';
      activeIdx = rendered.length > 0 ? 0 : -1;
      updateActive();
      // Keep the selected row in view on first render
      if (!filter) {
        var sel = listEl.querySelector('.nt-dial-picker-row.is-selected');
        if (sel && sel.scrollIntoView) {
          sel.scrollIntoView({ block: 'nearest' });
        }
      }
    }

    function updateActive() {
      var rows = listEl.querySelectorAll('.nt-dial-picker-row');
      for (var i = 0; i < rows.length; i++) {
        rows[i].classList.toggle('is-active', i === activeIdx);
      }
      if (activeIdx >= 0 && rows[activeIdx] && rows[activeIdx].scrollIntoView) {
        rows[activeIdx].scrollIntoView({ block: 'nearest' });
      }
    }

    function positionPop() {
      var rect = btn.getBoundingClientRect();
      var popW = 280;
      var vw = window.innerWidth;
      var left = Math.max(8, Math.min(rect.left, vw - popW - 8));
      pop.style.left = left + 'px';

      var spaceBelow = window.innerHeight - rect.bottom;
      var popMaxH = 320;
      if (spaceBelow < 220 && rect.top > spaceBelow) {
        // Flip upward when there's clearly more space above the button.
        pop.style.top = '';
        pop.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
      } else {
        pop.style.bottom = '';
        pop.style.top = (rect.bottom + 6) + 'px';
      }
      // Constrain popover height to whichever side it's anchored to.
      var availableH = pop.style.bottom
        ? rect.top - 16
        : (window.innerHeight - rect.bottom - 16);
      pop.style.maxHeight = Math.max(180, Math.min(popMaxH, availableH)) + 'px';
    }

    function openPop() {
      if (!pop.hidden) return;
      if (!pop.parentNode) document.body.appendChild(pop);
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      search.value = '';
      renderList('');
      positionPop();
      setTimeout(function () { try { search.focus(); } catch (e) {} }, 0);
      document.addEventListener('mousedown', onDocClick, true);
      document.addEventListener('keydown',  onKeyDown);
      window.addEventListener('resize',     positionPop);
      window.addEventListener('scroll',     positionPop, true);
    }
    function closePop() {
      if (pop.hidden) return;
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocClick, true);
      document.removeEventListener('keydown',  onKeyDown);
      window.removeEventListener('resize',     positionPop);
      window.removeEventListener('scroll',     positionPop, true);
    }

    function pick(entry) {
      current = entry.dial;
      btnVal.textContent = entry.dial;
      btn.title = entry.name + ' (' + entry.dial + ')';
      closePop();
      if (typeof opts.onChange === 'function') {
        try { opts.onChange(entry.dial, entry.iso, entry.name); } catch (e) {}
      }
    }

    function onDocClick(e) {
      if (container.contains(e.target) || pop.contains(e.target)) return;
      closePop();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); closePop(); btn.focus(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (rendered.length > 0) {
          activeIdx = (activeIdx + 1) % rendered.length;
          updateActive();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (rendered.length > 0) {
          activeIdx = (activeIdx - 1 + rendered.length) % rendered.length;
          updateActive();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0 && rendered[activeIdx]) pick(rendered[activeIdx]);
        return;
      }
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      pop.hidden ? openPop() : closePop();
    });
    search.addEventListener('input', function () { renderList(search.value); });
    listEl.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.nt-dial-picker-row') : null;
      if (!row) return;
      var dial = row.getAttribute('data-dial');
      var entry = findEntry(dial);
      if (entry) pick(entry);
    });

    return {
      element: container,
      getValue: function () { return current; },
      setValue: function (dial) {
        var e = findEntry(dial);
        if (e) {
          current = e.dial;
          btnVal.textContent = e.dial;
          btn.title = e.name + ' (' + e.dial + ')';
        }
      },
      dispose: function () {
        closePop();
        if (pop.parentNode) pop.parentNode.removeChild(pop);
      }
    };
  }

  window.NTDialPicker = { create: create };
})();
