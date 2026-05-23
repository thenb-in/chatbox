/**
 * @nt/chatbox — embeddable lead-capture chatbox widget.
 *
 * Usage:
 *   <link  rel="stylesheet" href="path/to/chatbox.css">
 *   <script src="path/to/chatbox.js"></script>
 *   <script>
 *     Chatbox.init({
 *       steps: ['phone', 'mail', 'name'],
 *       brand: { name: 'Acme Co', avatarText: 'AC' },
 *       onSubmit: function (payload) { ... },
 *       // ...optional adapters (profile, validators, ipLocation, dialPicker,
 *       //    attribution, googleSignIn, analytics, mailer, ...)
 *     });
 *   </script>
 *
 * Everything is config-driven. The library does NOT read window globals
 * directly — pass everything via `Chatbox.init(config)` so the same code
 * works embedded inside any host page.
 *
 * Public API:
 *   Chatbox.init(config) -> instance
 *   Chatbox.open(opts)
 *   Chatbox.openFocused()
 *   Chatbox.close()
 *   Chatbox.reset()
 *   Chatbox.submitFullLead(data)   // bypass conversation, send final mail
 *   Chatbox.getState()             // read-only snapshot
 *
 * Emits events via config.onEvent(name, payload) — also pushes to
 * window.dataLayer if present (or config.analytics.dataLayer).
 */
(function (global) {
  'use strict';

  if (global.Chatbox && global.Chatbox.__loaded) return;

  /* =================================================================== *
   *  Built-in IPLocation (formerly served as a sibling `ip-location.js`).
   *
   *  Fires one passive IP/geo lookup per visitor lifetime and exposes a
   *  synchronous snapshot + dial-code lookup on window.NTIPLocation. If a
   *  host has already loaded the standalone module, we don't overwrite.
   *  Other consumers on the page (e.g. NT's forms.js) read the same global.
   * =================================================================== */

  (function () {
    if (global.NTIPLocation) return;

    var REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

    function getStored() {
      if (!global.NTVisitorProfile || !global.NTVisitorProfile.get) return null;
      var p = global.NTVisitorProfile.get();
      return (p && p.ip_location) || null;
    }
    function needsRefresh(stored) {
      if (!stored || !stored.fetched_at) return true;
      return Date.now() - stored.fetched_at > REFRESH_AFTER_MS;
    }
    function normaliseIpwho(d) {
      if (!d || d.success === false || !d.ip) return null;
      return {
        ip: d.ip, ip_type: d.type || null,
        city: d.city || null, region: d.region || null,
        country: d.country || null, country_code: d.country_code || null,
        postal: d.postal || null,
        latitude:  d.latitude  != null ? d.latitude  : null,
        longitude: d.longitude != null ? d.longitude : null,
        timezone: (d.timezone && d.timezone.id) || null,
        isp: (d.connection && (d.connection.isp || d.connection.org)) || null,
        asn: (d.connection && d.connection.asn) || null,
        source: 'ipwho.is', fetched_at: Date.now()
      };
    }
    function fetchIpwho() {
      return fetch('https://ipwho.is/', { method: 'GET', mode: 'cors', credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(normaliseIpwho);
    }
    function fetchIpifyFallback() {
      return fetch('https://api.ipify.org?format=json', { method: 'GET', mode: 'cors', credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ip) return null;
          return {
            ip: d.ip, ip_type: null,
            city: null, region: null, country: null, country_code: null, postal: null,
            latitude: null, longitude: null, timezone: null, isp: null, asn: null,
            source: 'ipify.org', fetched_at: Date.now()
          };
        });
    }
    function persist(data) {
      if (!data) return;
      if (global.NTVisitorProfile && global.NTVisitorProfile.setIPLocation) {
        global.NTVisitorProfile.setIPLocation(data);
      }
    }
    // Skip the IP fetch on hosts without NTVisitorProfile (no persistence
    // layer to write into). The dial-picker + getCountryCode are still
    // usable — they just won't auto-prefill the visitor's country.
    function boot(attemptsLeft) {
      if (typeof attemptsLeft !== 'number') attemptsLeft = 20;
      if (!global.NTVisitorProfile) {
        if (attemptsLeft <= 0) return;
        return setTimeout(function () { boot(attemptsLeft - 1); }, 50);
      }
      var stored = getStored();
      if (!needsRefresh(stored)) return;
      fetchIpwho()
        .catch(function () { return null; })
        .then(function (data) { return data || fetchIpifyFallback().catch(function () { return null; }); })
        .then(persist);
    }

    var DIAL_CODES = {
      AF:'+93', AL:'+355', DZ:'+213', AS:'+1684', AD:'+376', AO:'+244', AI:'+1264', AG:'+1268',
      AR:'+54', AM:'+374', AW:'+297', AU:'+61', AT:'+43', AZ:'+994',
      BS:'+1242', BH:'+973', BD:'+880', BB:'+1246', BY:'+375', BE:'+32', BZ:'+501', BJ:'+229',
      BM:'+1441', BT:'+975', BO:'+591', BA:'+387', BW:'+267', BR:'+55', IO:'+246', VG:'+1284',
      BN:'+673', BG:'+359', BF:'+226', BI:'+257',
      KH:'+855', CM:'+237', CA:'+1', CV:'+238', KY:'+1345', CF:'+236', TD:'+235', CL:'+56',
      CN:'+86', CX:'+61', CC:'+61', CO:'+57', KM:'+269', CK:'+682', CR:'+506', HR:'+385',
      CU:'+53', CW:'+599', CY:'+357', CZ:'+420', CD:'+243',
      DK:'+45', DJ:'+253', DM:'+1767', DO:'+1809',
      EC:'+593', EG:'+20', SV:'+503', GQ:'+240', ER:'+291', EE:'+372', SZ:'+268', ET:'+251',
      FK:'+500', FO:'+298', FJ:'+679', FI:'+358', FR:'+33', GF:'+594', PF:'+689',
      GA:'+241', GM:'+220', GE:'+995', DE:'+49', GH:'+233', GI:'+350', GR:'+30', GL:'+299',
      GD:'+1473', GP:'+590', GU:'+1671', GT:'+502', GG:'+44', GN:'+224', GW:'+245', GY:'+592',
      HT:'+509', HN:'+504', HK:'+852', HU:'+36',
      IS:'+354', IN:'+91', ID:'+62', IR:'+98', IQ:'+964', IE:'+353', IM:'+44', IL:'+972', IT:'+39', CI:'+225',
      JM:'+1876', JP:'+81', JE:'+44', JO:'+962',
      KZ:'+7', KE:'+254', KI:'+686', XK:'+383', KW:'+965', KG:'+996',
      LA:'+856', LV:'+371', LB:'+961', LS:'+266', LR:'+231', LY:'+218', LI:'+423', LT:'+370', LU:'+352',
      MO:'+853', MG:'+261', MW:'+265', MY:'+60', MV:'+960', ML:'+223', MT:'+356', MH:'+692', MQ:'+596',
      MR:'+222', MU:'+230', YT:'+262', MX:'+52', FM:'+691', MD:'+373', MC:'+377', MN:'+976', ME:'+382',
      MS:'+1664', MA:'+212', MZ:'+258', MM:'+95',
      NA:'+264', NR:'+674', NP:'+977', NL:'+31', NC:'+687', NZ:'+64', NI:'+505', NE:'+227', NG:'+234',
      NU:'+683', NF:'+672', KP:'+850', MK:'+389', MP:'+1670', NO:'+47',
      OM:'+968',
      PK:'+92', PW:'+680', PS:'+970', PA:'+507', PG:'+675', PY:'+595', PE:'+51', PH:'+63', PN:'+64',
      PL:'+48', PT:'+351', PR:'+1787',
      QA:'+974',
      CG:'+242', RE:'+262', RO:'+40', RU:'+7', RW:'+250',
      BL:'+590', SH:'+290', KN:'+1869', LC:'+1758', MF:'+590', PM:'+508', VC:'+1784',
      WS:'+685', SM:'+378', ST:'+239', SA:'+966', SN:'+221', RS:'+381', SC:'+248', SL:'+232',
      SG:'+65', SX:'+1721', SK:'+421', SI:'+386', SB:'+677', SO:'+252', ZA:'+27', KR:'+82', SS:'+211',
      ES:'+34', LK:'+94', SD:'+249', SR:'+597', SJ:'+47', SE:'+46', CH:'+41', SY:'+963',
      TW:'+886', TJ:'+992', TZ:'+255', TH:'+66', TL:'+670', TG:'+228', TK:'+690', TO:'+676',
      TT:'+1868', TN:'+216', TR:'+90', TM:'+993', TC:'+1649', TV:'+688',
      UG:'+256', UA:'+380', AE:'+971', GB:'+44', US:'+1', UY:'+598', UZ:'+998',
      VU:'+678', VA:'+39', VE:'+58', VN:'+84', VI:'+1340',
      WF:'+681', YE:'+967', ZM:'+260', ZW:'+263'
    };

    function getDialCode() {
      var loc = getStored();
      if (!loc || !loc.country_code) return null;
      return DIAL_CODES[String(loc.country_code).toUpperCase()] || null;
    }

    var _allDialCodes = null;
    function getAllDialCodes() {
      if (_allDialCodes) return _allDialCodes;
      var names = null;
      try {
        if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
          names = new Intl.DisplayNames(['en'], { type: 'region' });
        }
      } catch (e) { names = null; }
      var list = Object.keys(DIAL_CODES).map(function (iso) {
        var name = iso;
        if (names) { try { name = names.of(iso) || iso; } catch (e) {} }
        return { iso: iso, dial: DIAL_CODES[iso], name: name };
      });
      list.sort(function (a, b) { return a.name.localeCompare(b.name); });
      _allDialCodes = list;
      return list;
    }

    global.NTIPLocation = {
      get: getStored,
      getDialCode: getDialCode,
      getCountryCode: function () {
        var loc = getStored();
        return (loc && loc.country_code) ? String(loc.country_code).toUpperCase() : null;
      },
      getAllDialCodes: getAllDialCodes,
      refresh: function () {
        fetchIpwho()
          .catch(function () { return fetchIpifyFallback().catch(function () { return null; }); })
          .then(persist);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { boot(); });
    } else {
      boot();
    }
  })();

  /* =================================================================== *
   *  Built-in DialPicker (formerly served as a sibling `dial-picker.js`).
   *
   *  Compact searchable country-dial-code popover. Depends on
   *  window.NTIPLocation above for the country list. Exposes window.NTDialPicker
   *  for other consumers (e.g. forms.js) — host overwrites are respected.
   * =================================================================== */

  (function () {
    if (global.NTDialPicker) return;

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
    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function getList() {
      return (global.NTIPLocation && global.NTIPLocation.getAllDialCodes)
        ? global.NTIPLocation.getAllDialCodes() : [];
    }
    function getIpDial() {
      return (global.NTIPLocation && global.NTIPLocation.getDialCode)
        ? global.NTIPLocation.getDialCode() : null;
    }
    function findEntry(dial) {
      var list = getList();
      for (var i = 0; i < list.length; i++) if (list[i].dial === dial) return list[i];
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
      caret.textContent = '▾';

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
                 ' data-dial="' + escHtml(c.dial) + '" data-iso="' + escHtml(c.iso) + '">' +
                   '<span class="nt-dial-picker-name">' + escHtml(c.name) + '</span>' +
                   '<span class="nt-dial-picker-dial">' + escHtml(c.dial) + '</span>' +
                 '</div>';
        }).join('');
        listEl.innerHTML = html || '<div class="nt-dial-picker-empty">No matches</div>';
        activeIdx = rendered.length > 0 ? 0 : -1;
        updateActive();
        if (!filter) {
          var selRow = listEl.querySelector('.nt-dial-picker-row.is-selected');
          if (selRow && selRow.scrollIntoView) selRow.scrollIntoView({ block: 'nearest' });
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
          pop.style.top = '';
          pop.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        } else {
          pop.style.bottom = '';
          pop.style.top = (rect.bottom + 6) + 'px';
        }
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
          if (rendered.length > 0) { activeIdx = (activeIdx + 1) % rendered.length; updateActive(); }
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (rendered.length > 0) { activeIdx = (activeIdx - 1 + rendered.length) % rendered.length; updateActive(); }
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

    global.NTDialPicker = { create: create };
  })();

  /* =================================================================== *
   *  Defaults
   * =================================================================== */

  var DEFAULTS = {
    storageKey: 'chatbox_state_v1',
    mountId:    'chatbox-root',
    stylesId:   'chatbox-styles',
    stylesHref: null,             // if set, library injects <link rel=stylesheet>

    brand: {
      name:      'Support',
      avatarText:'S',
      tagline:   'Online — replies in ~5 min',
      launcherTitle: 'Chat with us',
      launcherSub:   'Schedule a callback'
    },

    steps:    ['phone', 'mail', 'name'],
    stepMeta: {
      phone:        { icon: '📞', label: 'phone',        send_mail: true },
      interests:    { icon: '🎯', label: 'interests',    send_mail: true },
      team_size:    { icon: '👥', label: 'team size',    send_mail: true },
      mail:         { icon: '✉️', label: 'email',        send_mail: true },
      name:         { icon: '👤', label: 'name',         send_mail: true },
      requirements: { icon: '📝', label: 'requirements', send_mail: true }
    },

    interests: [],
    teamSizes: ['1 – 10', '11 – 50', '51 – 200', '201 – 1,000', '1,000+'],

    autoExpand:          true,
    autoExpandDelayMs:   10000,
    autoExpandBlockedPaths: /book-demo|thank-you|order|privacy|reach|meet/i,

    whatsappNumber:      null,
    bookDemoHrefPattern: /(?:^|\/)book-demo(?:\.html)?(?:[?#].*)?$/i,

    typingFastMs: 650,
    typingSlowMs: 950,
    stepDelayMs:  600,

    googleSignIn: null,     // { clientId: '...', enabled: true }

    mailer: null,           // { url, secretKey, recipients: [...] }

    onSubmit: null,         // function(stage, payload)   — called per stage
    onEvent:  null,         // function(name, payload)    — analytics hook

    // Adapter hooks (all optional)
    profile:    null,       // see ProfileAdapter contract below
    validators: null,       // { isValidPhoneDigits, isValidEmail }
    ipLocation: null,       // { getDialCode, getLocation }
    dialPicker: null,       // { create({selected,ariaLabel}) -> {element,getValue} }
    attribution:null        // { get() -> { utm_source, ... } }
  };

  /* =================================================================== *
   *  Built-in fallback validators (used if config.validators absent)
   * =================================================================== */

  // Per-country expected length (national significant number, no dial code).
  // Compiled from libphonenumber's mobile rules — wide enough to admit valid
  // mobile and landline lengths, tight enough to reject obvious garbage like
  // an 8-digit Indian number. Unknown dial codes fall back to a generic
  // 7–15 range. Order: by dial code numeric value.
  var PHONE_LEN_BY_DIAL = {
    '+1':   [10, 10],  // NANP (US, CA, ...)
    '+7':   [10, 10],  // Russia, Kazakhstan
    '+20':  [10, 10],  // Egypt
    '+27':  [9, 9],    // South Africa
    '+30':  [10, 10],  // Greece
    '+31':  [9, 9],    // Netherlands
    '+32':  [8, 9],    // Belgium
    '+33':  [9, 9],    // France
    '+34':  [9, 9],    // Spain
    '+36':  [8, 9],    // Hungary
    '+39':  [9, 11],   // Italy
    '+40':  [9, 9],    // Romania
    '+41':  [9, 9],    // Switzerland
    '+43':  [10, 13],  // Austria (high variance)
    '+44':  [9, 10],   // United Kingdom
    '+45':  [8, 8],    // Denmark
    '+46':  [7, 13],   // Sweden
    '+47':  [8, 8],    // Norway
    '+48':  [9, 9],    // Poland
    '+49':  [10, 11],  // Germany
    '+51':  [9, 9],    // Peru
    '+52':  [10, 10],  // Mexico
    '+54':  [10, 10],  // Argentina
    '+55':  [10, 11],  // Brazil
    '+56':  [9, 9],    // Chile
    '+57':  [10, 10],  // Colombia
    '+58':  [10, 10],  // Venezuela
    '+60':  [9, 10],   // Malaysia
    '+61':  [9, 9],    // Australia
    '+62':  [9, 12],   // Indonesia
    '+63':  [10, 10],  // Philippines
    '+64':  [8, 10],   // New Zealand
    '+65':  [8, 8],    // Singapore
    '+66':  [9, 9],    // Thailand
    '+81':  [10, 10],  // Japan
    '+82':  [9, 10],   // South Korea
    '+84':  [9, 10],   // Vietnam
    '+86':  [11, 11],  // China
    '+90':  [10, 10],  // Turkey
    '+91':  [10, 10],  // India
    '+92':  [10, 10],  // Pakistan
    '+93':  [9, 9],    // Afghanistan
    '+94':  [9, 9],    // Sri Lanka
    '+98':  [10, 10],  // Iran
    '+212': [9, 9],    // Morocco
    '+213': [9, 9],    // Algeria
    '+216': [8, 8],    // Tunisia
    '+220': [7, 7],    // Gambia
    '+221': [9, 9],    // Senegal
    '+233': [9, 9],    // Ghana
    '+234': [10, 10],  // Nigeria
    '+250': [9, 9],    // Rwanda
    '+251': [9, 9],    // Ethiopia
    '+254': [9, 10],   // Kenya
    '+255': [9, 9],    // Tanzania
    '+256': [9, 9],    // Uganda
    '+260': [9, 9],    // Zambia
    '+263': [9, 9],    // Zimbabwe
    '+351': [9, 9],    // Portugal
    '+353': [9, 9],    // Ireland
    '+354': [7, 7],    // Iceland
    '+355': [9, 9],    // Albania
    '+356': [8, 8],    // Malta
    '+357': [8, 8],    // Cyprus
    '+358': [6, 11],   // Finland
    '+359': [9, 9],    // Bulgaria
    '+370': [8, 8],    // Lithuania
    '+371': [8, 8],    // Latvia
    '+372': [7, 8],    // Estonia
    '+380': [9, 9],    // Ukraine
    '+385': [8, 9],    // Croatia
    '+386': [8, 8],    // Slovenia
    '+420': [9, 9],    // Czechia
    '+421': [9, 9],    // Slovakia
    '+501': [7, 7],    // Belize
    '+502': [8, 8],    // Guatemala
    '+503': [8, 8],    // El Salvador
    '+504': [8, 8],    // Honduras
    '+505': [8, 8],    // Nicaragua
    '+506': [8, 8],    // Costa Rica
    '+507': [7, 8],    // Panama
    '+591': [8, 8],    // Bolivia
    '+593': [8, 9],    // Ecuador
    '+595': [9, 9],    // Paraguay
    '+598': [8, 8],    // Uruguay
    '+852': [8, 8],    // Hong Kong
    '+853': [8, 8],    // Macao
    '+855': [8, 9],    // Cambodia
    '+856': [8, 10],   // Laos
    '+880': [10, 10],  // Bangladesh
    '+886': [9, 9],    // Taiwan
    '+960': [7, 7],    // Maldives
    '+961': [7, 8],    // Lebanon
    '+962': [8, 9],    // Jordan
    '+964': [10, 10],  // Iraq
    '+965': [8, 8],    // Kuwait
    '+966': [9, 9],    // Saudi Arabia
    '+968': [8, 8],    // Oman
    '+971': [8, 9],    // UAE
    '+972': [8, 9],    // Israel
    '+973': [8, 8],    // Bahrain
    '+974': [8, 8],    // Qatar
    '+975': [7, 8],    // Bhutan
    '+976': [8, 8],    // Mongolia
    '+977': [9, 10],   // Nepal
    '+994': [9, 9],    // Azerbaijan
    '+995': [9, 9],    // Georgia
    '+998': [9, 9]     // Uzbekistan
  };

  // Default phone validation:
  //   1. If libphonenumber-js is loaded (window.libphonenumber), defer to it
  //      for the strictest possible country-aware rules (prefix checks too).
  //   2. Otherwise enforce a per-country digit-length range from the table
  //      above based on the dial code the user picked. Sites no longer need
  //      to load libphonenumber-js separately for sensible validation.
  //   3. Unknown dial codes fall through to a generic 7–15 digit count.
  var DEFAULT_VALIDATORS = {
    isValidPhoneDigits: function (input, dialCode) {
      var raw  = String(input || '').trim();
      var dial = String(dialCode || '').trim();
      if (!raw) return false;

      var lpn = (typeof window !== 'undefined') ? window.libphonenumber : null;
      if (lpn && typeof lpn.isValidPhoneNumber === 'function') {
        var e164 = (raw.charAt(0) === '+') ? raw
                 : (dial ? (dial + ' ' + raw) : raw);
        try { return lpn.isValidPhoneNumber(e164); } catch (e) { /* fall through */ }
      }

      var digits = raw.replace(/\D/g, '');
      var range = PHONE_LEN_BY_DIAL[dial];
      if (range) return digits.length >= range[0] && digits.length <= range[1];
      return digits.length >= 7 && digits.length <= 15;
    },
    isValidEmail: function (input) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input || '').trim());
    }
  };

  /* =================================================================== *
   *  Built-in localStorage profile adapter
   *
   * Contract (all methods optional except get/update):
   *   get()                            -> { phone, name, email, ... } | null
   *   update(patch)                    -> void                 // shallow merge
   *   getCurrentProduct()              -> 'productKey' | null
   *   setInterests(arr)                -> void
   *   bumpChatOpenCount()              -> number
   *   bumpEmailsSentCount()            -> number
   *   getNewInterests(currentInterests)-> arr   (subset not yet emailed)
   *   markInterestsEmailed(arr)        -> void
   * =================================================================== */

  function createLocalStorageProfile(storageKey) {
    var KEY = storageKey || 'chatbox_profile_v1';
    function read() {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; }
      catch (e) { return {}; }
    }
    function write(p) {
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
    }
    return {
      get: function () { return read(); },
      update: function (patch) {
        var p = read();
        Object.keys(patch || {}).forEach(function (k) {
          var v = patch[k];
          if (v === undefined) return;
          if (Array.isArray(v) && v.length === 0 && Array.isArray(p[k]) && p[k].length > 0) return;
          if (v === '' && p[k]) return;
          p[k] = v;
        });
        write(p);
      },
      setInterests: function (arr) {
        var p = read();
        p.interests = (arr || []).slice();
        p.interests_owned_by_user = true;
        write(p);
      },
      bumpChatOpenCount: function () {
        var p = read();
        p.chat_open_count = (p.chat_open_count || 0) + 1;
        write(p);
        return p.chat_open_count;
      },
      bumpEmailsSentCount: function () {
        var p = read();
        p.emails_sent_count = (p.emails_sent_count || 0) + 1;
        write(p);
        return p.emails_sent_count;
      },
      getNewInterests: function (current) {
        var p = read();
        var already = (p.emailed_interests || []).reduce(function (m, k) { m[k] = true; return m; }, {});
        return (current || []).filter(function (k) { return !already[k]; });
      },
      markInterestsEmailed: function (arr) {
        var p = read();
        var seen = (p.emailed_interests || []).reduce(function (m, k) { m[k] = true; return m; }, {});
        (arr || []).forEach(function (k) { seen[k] = true; });
        p.emailed_interests = Object.keys(seen);
        write(p);
      },
      getCurrentProduct: function () { return null; }
    };
  }

  /* =================================================================== *
   *  Tiny DOM helper
   * =================================================================== */

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    if (children) [].concat(children).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  /* =================================================================== *
   *  Icon glyphs (Unicode / emoji — no Font Awesome dependency).
   * =================================================================== */

  var ICONS = {
    comments:      '💬',
    refresh:       '↻',
    expand:        '⤢',
    compress:      '⤡',
    'paper-plane': '✈',
    check:         '✓',
    whatsapp:
      '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/>' +
      '</svg>'
  };

  function icon(name) {
    var glyph = ICONS[name] || '';
    var isSvg = glyph.charAt(0) === '<';
    var attrs = { class: 'nt-chat-ico', 'aria-hidden': 'true' };
    if (isSvg) attrs.html = glyph;
    return el('span', attrs, isSvg ? null : glyph);
  }

  /* =================================================================== *
   *  Main factory — produces an isolated instance bound to its config.
   * =================================================================== */

  function createInstance(userCfg) {
    var cfg = mergeConfig(DEFAULTS, userCfg || {});

    // Snap adapters into local refs (cheap, also lets us swap to defaults).
    // ipLocation / dialPicker fall back to the modules bundled at the top of
    // this file (which also live on global.NTIPLocation / global.NTDialPicker),
    // so a host that doesn't override them gets the built-in country-aware
    // picker + IP-based dial-code prefill for free.
    var validators = cfg.validators || DEFAULT_VALIDATORS;
    var profile    = cfg.profile    || createLocalStorageProfile(cfg.storageKey + '_profile');
    var ipLocation = cfg.ipLocation || global.NTIPLocation || null;
    var dialPicker = cfg.dialPicker || global.NTDialPicker || null;
    var attribution= cfg.attribution|| null;

    var STEPS      = cfg.steps;
    var STEP_META  = cfg.stepMeta;
    var INTERESTS  = cfg.interests;
    var TEAM_SIZES = cfg.teamSizes;
    var WA_NUMBER  = cfg.whatsappNumber || '';

    function stepNumberOf(name) { return STEPS.indexOf(name) + 1; }
    function isFinalStage(n)    { return n === STEPS.length; }

    /* ---- state ----------------------------------------------------- */

    function initialState() {
      return {
        open: false, step: 0, stageEmailed: 0, resetCount: 0,
        autoTaggedFrom: null, autoExpanded: false, focused: false,
        data: {
          phone: '', interests: [], team_size: '',
          email: '', email_verified: false,
          name: '', requirements: ''
        },
        messages: []
      };
    }

    function loadState() {
      try {
        var raw = sessionStorage.getItem(cfg.storageKey);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }
    function saveState() {
      try { sessionStorage.setItem(cfg.storageKey, JSON.stringify(state)); } catch (e) {}
    }

    var state = loadState() || initialState();
    if (state.resetCount == null)          state.resetCount = 0;
    if (state.autoTaggedFrom === undefined) state.autoTaggedFrom = null;
    if (state.autoExpanded === undefined)   state.autoExpanded = false;
    if (state.focused === undefined)        state.focused = !!state.fullscreen;
    delete state.fullscreen;

    function getProfile() {
      try { return profile && typeof profile.get === 'function' ? profile.get() : null; }
      catch (e) { return null; }
    }
    function profileCall(fn) {
      try { return typeof fn === 'function' ? fn.apply(null, [].slice.call(arguments, 1)) : null; }
      catch (e) { return null; }
    }
    function detectProductInterest() {
      return profileCall(profile && profile.getCurrentProduct);
    }

    function applyProfileToState() {
      var p = getProfile();
      if (p) {
        if (!state.data.phone        && p.phone)        state.data.phone        = p.phone;
        if (!state.data.name         && p.name)         state.data.name         = p.name;
        if (!state.data.team_size    && p.team_size)    state.data.team_size    = p.team_size;
        if (!state.data.requirements && p.requirements) state.data.requirements = p.requirements;
        if (!state.data.email        && p.email)        state.data.email        = p.email;
        if (!state.data.email_verified && p.email_verified) state.data.email_verified = true;
      }
      if (state.autoTaggedFrom || (state.data.interests && state.data.interests.length > 0)) return;

      var currentKey = detectProductInterest();
      var preTick;
      if (p && p.interests_owned_by_user) {
        preTick = (p.interests || []).slice();
      } else {
        preTick = (p && p.interests) ? p.interests.slice() : [];
        if (currentKey && preTick.indexOf(currentKey) === -1) preTick.push(currentKey);
      }
      if (preTick.length === 0) return;
      state.data.interests = preTick;
      state.autoTaggedFrom = currentKey || preTick[0];
      saveState();
    }
    applyProfileToState();

    var dom = {};

    /* ---- styles --------------------------------------------------- */

    function injectStyles() {
      if (!cfg.stylesHref) return;
      if (document.getElementById(cfg.stylesId)) return;
      var link = document.createElement('link');
      link.id   = cfg.stylesId;
      link.rel  = 'stylesheet';
      link.href = cfg.stylesHref;
      document.head.appendChild(link);
    }

    /* ---- analytics ------------------------------------------------ */

    function pushEvent(name, extra) {
      var payload = { event: name, page_path: location.pathname };
      if (extra) Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
      try { (global.dataLayer = global.dataLayer || []).push(payload); } catch (e) {}
      try { if (typeof cfg.onEvent === 'function') cfg.onEvent(name, payload); } catch (e) {}
    }

    /* ---- mount ---------------------------------------------------- */

    function mountRoot() {
      var root = document.getElementById(cfg.mountId);
      if (!root) {
        root = document.createElement('div');
        root.id = cfg.mountId;
        document.body.appendChild(root);
      }
      return root;
    }

    function mount() {
      injectStyles();
      var root = mountRoot();

      dom.launcher = el('button', {
        class: 'nt-chat-launcher',
        'aria-label': 'Open chat',
        type: 'button',
        onclick: function () { open({ focused: false }); }
      }, [
        el('span', { class: 'nt-chat-launcher-ico', 'aria-hidden': 'true' }, [
          icon('comments')
        ]),
        el('span', { class: 'nt-chat-launcher-text' }, [
          el('span', { class: 'nt-chat-launcher-title' }, cfg.brand.launcherTitle),
          el('span', { class: 'nt-chat-launcher-sub' }, cfg.brand.launcherSub)
        ])
      ]);

      root.appendChild(dom.launcher);
      if (state.open) renderPanel();
    }

    function open(opts) {
      state.open = true;
      state.focused = !!(opts && opts.focused);
      saveState();
      pushEvent('chat_open', { focused: state.focused });
      profileCall(profile && profile.bumpChatOpenCount);
      renderPanel();
    }

    function mountBackdrop() {
      if (dom.backdrop) return;
      dom.backdrop = el('div', {
        class: 'nt-chat-backdrop', 'aria-hidden': 'true',
        onclick: function () { if (state.focused) toggleFocused(); }
      });
      (document.getElementById(cfg.mountId) || document.body).insertBefore(
        dom.backdrop, dom.panel || null
      );
    }
    function unmountBackdrop() {
      var bd = dom.backdrop; dom.backdrop = null;
      if (!bd || !bd.parentNode) return;
      bd.classList.add('is-leaving');
      var removed = false;
      var remove = function () { if (!removed && (removed = true) && bd.parentNode) bd.parentNode.removeChild(bd); };
      bd.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, 300);
    }
    function applyFocusedDom() {
      if (!dom.panel) return;
      dom.panel.classList.toggle('is-focused', state.focused);
      if (state.focused) mountBackdrop(); else unmountBackdrop();
      if (dom.focusBtn) {
        var ico = dom.focusBtn.querySelector('.nt-chat-ico');
        if (ico) ico.textContent = ICONS[state.focused ? 'compress' : 'expand'] || '';
        var label = state.focused ? 'Dock to corner' : 'Focus mode';
        dom.focusBtn.setAttribute('aria-label', label);
        dom.focusBtn.setAttribute('title',      label);
      }
    }
    function toggleFocused() {
      state.focused = !state.focused; saveState(); applyFocusedDom();
    }
    function close() {
      state.open = false; state.focused = false; saveState();
      unmountBackdrop();
      var panel = dom.panel; dom.panel = null;
      if (!panel || !panel.parentNode) return;
      panel.classList.add('is-leaving');
      var removed = false;
      var remove = function () { if (!removed && (removed = true) && panel.parentNode) panel.parentNode.removeChild(panel); };
      panel.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, 400);
    }

    function hasProgress() {
      var d = state.data || {};
      return Boolean(d.phone || (d.interests && d.interests.length) ||
                     d.team_size || d.requirements || d.name);
    }

    function askReset() {
      if (!hasProgress()) { resetChat(); return; }
      var existing = dom.body && dom.body.querySelector('.nt-chat-confirm');
      if (existing) { existing.scrollIntoView({ block: 'nearest' }); return; }
      var card = el('div', { class: 'nt-chat-confirm', role: 'alertdialog' }, [
        el('p', null, 'Start over? You will lose your current progress in this chat.'),
        el('div', { class: 'actions' }, [
          el('button', {
            class: 'yes', type: 'button',
            onclick: function () { if (card.parentNode) card.parentNode.removeChild(card); resetChat(); }
          }, 'Yes, restart'),
          el('button', {
            class: 'no', type: 'button',
            onclick: function () { if (card.parentNode) card.parentNode.removeChild(card); }
          }, 'Cancel')
        ])
      ]);
      dom.body.appendChild(card);
      scrollBodyToBottom();
    }

    function resetChat() {
      var keep = (state.resetCount || 0) + 1;
      state = initialState();
      state.open = true;
      state.resetCount = keep;
      applyProfileToState();
      saveState();
      pushEvent('chat_reset', { reset_count: keep });
      renderPanel();
    }

    /* ---- panel ---------------------------------------------------- */

    function renderPanel() {
      if (dom.panel && dom.panel.parentNode) dom.panel.parentNode.removeChild(dom.panel);

      dom.panel = el('div', {
        class: 'nt-chat-panel' + (state.focused ? ' is-focused' : ''),
        role: 'dialog', 'aria-label': 'Chat'
      });

      var stopAndCall = function (fn) { return function (e) { e.stopPropagation(); fn(); }; };

      var head = el('div', {
        class: 'nt-chat-head', role: 'button', tabindex: '0',
        'aria-label': 'Minimize chat', title: 'Click to minimize',
        onclick: close,
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } }
      }, [
        el('div', { class: 'nt-chat-head-avatar' }, cfg.brand.avatarText),
        el('div', { class: 'nt-chat-head-text' }, [
          el('p', { class: 'nt-chat-head-title' }, cfg.brand.name),
          el('p', { class: 'nt-chat-head-sub' }, cfg.brand.tagline)
        ]),
        el('div', { class: 'nt-chat-head-actions' }, [
          el('button', {
            class: 'nt-chat-head-btn', type: 'button',
            'aria-label': 'Start over', title: 'Start over',
            onclick: stopAndCall(askReset)
          }, [icon('refresh')]),
          (dom.focusBtn = el('button', {
            class: 'nt-chat-head-btn', type: 'button',
            'aria-label': state.focused ? 'Dock to corner' : 'Focus mode',
            title:        state.focused ? 'Dock to corner' : 'Focus mode',
            onclick: stopAndCall(toggleFocused)
          }, [icon(state.focused ? 'compress' : 'expand')])),
          el('button', {
            class: 'nt-chat-head-btn close', type: 'button',
            'aria-label': 'Close chat', onclick: stopAndCall(close)
          }, '×')
        ])
      ]);

      dom.body = el('div', { class: 'nt-chat-body' });
      dom.foot = el('div', { class: 'nt-chat-foot' });

      dom.panel.appendChild(head);
      dom.panel.appendChild(dom.body);
      dom.panel.appendChild(dom.foot);
      (document.getElementById(cfg.mountId) || document.body).appendChild(dom.panel);
      if (state.focused) mountBackdrop(); else unmountBackdrop();

      state.messages.forEach(function (m) { renderMessage(m.who, m.text, false); });

      if (state.messages.length === 0) playIntroSequence();
      else renderStep();
    }

    function renderMessage(who, text, animate) {
      var node = el('div', { class: 'nt-chat-msg ' + who }, text);
      if (!animate) node.style.animation = 'none';
      dom.body.appendChild(node);
      scrollBodyToBottom();
    }
    function sayBot(text)  { state.messages.push({ who: 'bot',  text: text }); renderMessage('bot',  text, true); saveState(); }
    function sayUser(text) { state.messages.push({ who: 'user', text: text }); renderMessage('user', text, true); saveState(); }
    function clearFoot()   { dom.foot.innerHTML = ''; }

    function scrollBodyToBottom() {
      if (!dom.body) return;
      var go = function () { dom.body.scrollTop = dom.body.scrollHeight; };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () { requestAnimationFrame(go); });
      } else setTimeout(go, 16);
    }

    /* ---- step routing -------------------------------------------- */

    var STEP_RENDERERS = {
      phone:        renderPhoneStep,
      interests:    renderInterestsStep,
      team_size:    renderTeamSizeStep,
      mail:         renderMailStep,
      requirements: renderRequirementsStep,
      name:         renderNameStep
    };

    function renderStep() {
      clearFoot();
      var name = STEPS[state.step];
      if (!name) { renderSuccess(); scrollBodyToBottom(); return; }
      var fn = STEP_RENDERERS[name];
      if (typeof fn === 'function') fn();
      scrollBodyToBottom();
    }

    /* ---- step: phone --------------------------------------------- */

    function renderPhoneStep() {
      var hasVerifiedEmail = !!state.data.email_verified;
      var hasEmail         = !!state.data.email;

      var ipDial = (ipLocation && ipLocation.getDialCode) ? ipLocation.getDialCode() : null;
      var savedPhone = state.data.phone || '';
      var savedDial  = state.data.dial_code || '';
      var savedRest  = savedPhone;
      if (!savedDial && savedPhone) {
        var m = savedPhone.match(/^\s*(\+\d{1,4})\s*(.*)$/);
        if (m) { savedDial = m[1]; savedRest = m[2]; }
      } else if (savedDial && savedPhone.indexOf(savedDial) === 0) {
        savedRest = savedPhone.slice(savedDial.length).replace(/^\s+/, '');
      }
      var initialDial = savedDial || ipDial || '+91';

      var dialEl, getDial;
      if (dialPicker && dialPicker.create) {
        var picker = dialPicker.create({ selected: initialDial, ariaLabel: 'Country code' });
        dialEl  = picker.element;
        getDial = picker.getValue;
      } else {
        var fallback = el('select', { class: 'nt-chat-dial', 'aria-label': 'Country code' });
        fallback.appendChild(el('option', { value: initialDial, selected: 'selected' }, initialDial));
        dialEl  = fallback;
        getDial = function () { return fallback.value; };
      }

      var input = el('input', {
        class: 'nt-chat-input', type: 'tel', inputmode: 'numeric',
        autocomplete: 'tel', placeholder: '98765 43210',
        'aria-label': 'Phone or WhatsApp number'
      });
      input.value = savedRest || '';

      var errBox = el('div', { class: 'nt-chat-error' });

      var submit = function () {
        var dial = getDial() || '';
        var rest = (input.value || '').trim();
        var combined = (dial ? dial + ' ' : '') + rest;
        if (!validators.isValidPhoneDigits(rest, dial)) {
          errBox.textContent = 'Please enter a valid phone number.';
          input.focus(); return;
        }
        errBox.textContent = '';
        state.data.phone = combined.trim();
        if (dial) state.data.dial_code = dial;
        sayUser(combined.trim());
        advance('phone');
      };

      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

      var sendBtn = el('button', {
        class: 'nt-chat-send', type: 'button', onclick: submit
      }, [icon('paper-plane'), ' Send']);

      dom.foot.appendChild(el('div', { class: 'nt-chat-input-row' }, [dialEl, input, sendBtn]));
      dom.foot.appendChild(errBox);

      if (!hasVerifiedEmail && googleEnabled()) {
        var divider = el('div', { class: 'nt-chat-divider' }, [el('span', null, 'or')]);
        var slot = el('div', { class: 'nt-chat-google-slot', id: 'nt-chat-google-slot-phone' });
        slot.textContent = 'Loading Google sign-in…';
        dom.foot.appendChild(divider);
        dom.foot.appendChild(slot);
        initGoogleSlot(slot, 'phone');
      }

      if (hasEmail) {
        var skipBtn = el('button', {
          class: 'nt-chat-skip', type: 'button',
          onclick: function () { sayUser('(skipped — will share later)'); advance('phone'); }
        }, 'Skip for now →');
        dom.foot.appendChild(el('div', { style: 'text-align:center;margin-top:6px;' }, [skipBtn]));
      }

      setTimeout(function () { input.focus(); }, 60);
    }

    /* ---- step: interests ----------------------------------------- */

    function renderInterestsStep() {
      var selected = (state.data.interests || []).slice();
      var chips = el('div', { class: 'nt-chat-chips' });

      INTERESTS.forEach(function (item) {
        var isSel = selected.indexOf(item.key) !== -1;
        var chip = el('button', {
          type: 'button',
          class: 'nt-chat-chip' + (isSel ? ' selected' : ''),
          'data-key': item.key
        }, item.label);
        chip.addEventListener('click', function () {
          var k = item.key, i = selected.indexOf(k);
          if (i === -1) { selected.push(k); chip.classList.add('selected'); }
          else          { selected.splice(i, 1); chip.classList.remove('selected'); }
        });
        chips.appendChild(chip);
      });

      var confirmBtn = el('button', {
        class: 'nt-chat-send', type: 'button',
        onclick: function () {
          state.data.interests = selected;
          if (state.autoTaggedFrom && selected.indexOf(state.autoTaggedFrom) === -1) {
            state.autoTaggedFrom = null;
          }
          profileCall(profile && profile.setInterests, selected);

          var labels = INTERESTS
            .filter(function (i) { return selected.indexOf(i.key) !== -1; })
            .map(function (i) { return i.label; }).join(', ');
          sayUser(labels || '(no specific product — just exploring)');
          advance('interests');
        }
      }, 'Continue →');

      dom.foot.appendChild(chips);
      dom.foot.appendChild(el('div', { style: 'margin-top:10px;display:flex;justify-content:flex-end;' }, [confirmBtn]));
    }

    /* ---- step: team size ----------------------------------------- */

    function renderTeamSizeStep() {
      var quick = el('div', { class: 'nt-chat-quick' });
      TEAM_SIZES.forEach(function (size) {
        var btn = el('button', { class: 'nt-chat-quick-btn', type: 'button' }, size);
        btn.addEventListener('click', function () {
          state.data.team_size = size;
          sayUser(size);
          advance('team_size');
        });
        quick.appendChild(btn);
      });
      dom.foot.appendChild(quick);
    }

    /* ---- step: mail (+ Google) ----------------------------------- */

    function decodeJwt(token) {
      try {
        var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        var json = decodeURIComponent(atob(part).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(json);
      } catch (e) { return null; }
    }

    function googleEnabled() {
      return !!(cfg.googleSignIn && cfg.googleSignIn.enabled !== false && cfg.googleSignIn.clientId);
    }

    function ensureGoogleLibrary(cb) {
      if (global.google && global.google.accounts && global.google.accounts.id) { cb(); return; }
      var existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) { existing.addEventListener('load', cb, { once: true }); return; }
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = cb;
      s.onerror = function () {};
      document.head.appendChild(s);
    }

    function initGoogleSlot(slot, advanceFromStep) {
      if (!googleEnabled()) {
        slot.textContent = 'Google sign-in unavailable.';
        slot.classList.add('is-unavailable');
        return;
      }
      ensureGoogleLibrary(function () {
        if (!global.google || !global.google.accounts || !global.google.accounts.id) {
          slot.textContent = 'Google sign-in unavailable.';
          slot.classList.add('is-unavailable');
          return;
        }
        try {
          global.google.accounts.id.initialize({
            client_id: cfg.googleSignIn.clientId,
            callback: function (response) { onGoogleCredential(response, advanceFromStep); },
            ux_mode: 'popup', auto_select: false, context: 'signin'
          });
          slot.textContent = '';
          global.google.accounts.id.renderButton(slot, {
            type: 'standard', theme: 'outline', size: 'large',
            text: 'continue_with', shape: 'pill', logo_alignment: 'left', width: 280
          });
        } catch (e) {
          slot.textContent = 'Google sign-in unavailable.';
          slot.classList.add('is-unavailable');
        }
      });
    }

    function onGoogleCredential(response, advanceFromStep) {
      if (!response || !response.credential) return;
      var claims = decodeJwt(response.credential);
      if (!claims || !claims.email) return;
      state.data.email = claims.email;
      state.data.email_verified = true;
      if (claims.name && !state.data.name) state.data.name = claims.name;
      sayUser(claims.email + ' ✓ verified via Google');
      advance(advanceFromStep || 'mail');
    }

    function renderMailStep() {
      var input = el('input', {
        class: 'nt-chat-input', type: 'email', autocomplete: 'email',
        placeholder: 'you@company.com', 'aria-label': 'Email address'
      });
      input.value = state.data.email || '';

      var errBox = el('div', { class: 'nt-chat-error' });

      var submitManual = function () {
        var v = (input.value || '').trim();
        if (!validators.isValidEmail(v)) {
          errBox.textContent = 'Please enter a valid email address.';
          input.focus(); return;
        }
        errBox.textContent = '';
        state.data.email = v;
        state.data.email_verified = false;
        sayUser(v);
        advance('mail');
      };

      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitManual(); } });

      var sendBtn = el('button', {
        class: 'nt-chat-send', type: 'button', onclick: submitManual
      }, [icon('paper-plane'), ' Send']);

      dom.foot.appendChild(el('div', { class: 'nt-chat-input-row' }, [input, sendBtn]));
      dom.foot.appendChild(errBox);

      if (googleEnabled()) {
        var divider = el('div', { class: 'nt-chat-divider' }, [el('span', null, 'or')]);
        var slot = el('div', { class: 'nt-chat-google-slot', id: 'nt-chat-google-slot' });
        slot.textContent = 'Loading Google sign-in…';
        dom.foot.appendChild(divider);
        dom.foot.appendChild(slot);
        initGoogleSlot(slot, 'mail');
      }

      setTimeout(function () { input.focus(); }, 60);
    }

    /* ---- step: requirements -------------------------------------- */

    function renderRequirementsStep() {
      var ta = el('textarea', {
        class: 'nt-chat-textarea', rows: '2',
        placeholder: 'Anything we should know…',
        'aria-label': 'Specific requirements'
      });
      ta.value = state.data.requirements || '';

      var submit = function () {
        var v = (ta.value || '').trim();
        state.data.requirements = v;
        sayUser(v || '(skipped)');
        advance('requirements');
      };

      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      });

      var send = el('button', {
        class: 'nt-chat-send', type: 'button', onclick: submit
      }, [icon('paper-plane'), ' Send']);

      var skip = el('button', {
        class: 'nt-chat-skip', type: 'button',
        onclick: function () { state.data.requirements = ''; sayUser('(skipped)'); advance('requirements'); }
      }, 'Skip');

      dom.foot.appendChild(el('div', { class: 'nt-chat-input-row' }, [ta, send]));
      dom.foot.appendChild(el('div', { style: 'text-align:right;' }, [skip]));
      setTimeout(function () { ta.focus(); }, 60);
    }

    /* ---- step: name ---------------------------------------------- */

    function renderNameStep() {
      var input = el('input', {
        class: 'nt-chat-input', type: 'text', autocomplete: 'name',
        placeholder: 'Your name', 'aria-label': 'Your name'
      });
      input.value = state.data.name || '';

      var submit = function () {
        var v = (input.value || '').trim();
        if (!v) { input.focus(); return; }
        state.data.name = v;
        sayUser(v);
        advance('name');
      };

      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

      var btn = el('button', { class: 'nt-chat-send', type: 'button', onclick: submit },
        [icon('paper-plane'), ' Send']);

      dom.foot.appendChild(el('div', { class: 'nt-chat-input-row' }, [input, btn]));
      setTimeout(function () { input.focus(); }, 60);
    }

    /* ---- advance + bot prompts ----------------------------------- */

    function advance(stepName) {
      var n = stepNumberOf(stepName);
      pushEvent('chat_step_complete', { step: stepName, step_number: n });
      sendStageEmail(n, stepName);
      state.step = n;
      saveState();

      showTyping();
      setTimeout(function () {
        hideTyping();
        var next = STEPS[state.step];
        if      (next === 'interests')    sayBot(interestsPrompt());
        else if (next === 'team_size')    sayBot('Thanks! How many employees do you have?');
        else if (next === 'mail')         sayBot(mailPrompt());
        else if (next === 'name')         sayBot(namePrompt());
        else if (next === 'requirements') sayBot("Last one — anything specific we should know? (Optional — press Skip if nothing comes to mind.)");
        else                              sayBot('All set!');
        renderStep();
      }, cfg.stepDelayMs);
    }

    function interestsPrompt() {
      var tagged = state.autoTaggedFrom
        ? INTERESTS.filter(function (x) { return x.key === state.autoTaggedFrom; })[0]
        : null;
      if (tagged) {
        return "Got it. I noticed you're looking at " + tagged.label +
               " — picked that for you. Add anything else you're interested in, or untick it.";
      }
      return 'Got it. Which products are you interested in? (Pick any that apply, or just continue.)';
    }
    function mailPrompt() {
      if (state.data.email && state.data.email_verified)
        return "We have your verified email (" + state.data.email + "). Sign in again to update, or just type a different one.";
      if (state.data.email)
        return "Drop your email below" + (googleEnabled() ? ", or sign in with Google for a verified address." : ".");
      return "Your email?" + (googleEnabled() ? " Type it in, or sign in with Google for one-tap verified delivery." : "");
    }
    function namePrompt() {
      var existing = (state.data.name || '').split(' ')[0];
      return existing
        ? 'Almost done — confirm your name is "' + state.data.name + '", or update it below.'
        : 'Almost done — what should we call you - Your good name?';
    }

    var typingNode = null;
    function showTyping() {
      if (!dom.body) return;
      typingNode = el('div', { class: 'nt-chat-typing', 'aria-label': 'Typing' }, [
        el('span'), el('span'), el('span')
      ]);
      dom.body.appendChild(typingNode);
      scrollBodyToBottom();
    }
    function hideTyping() {
      if (typingNode && typingNode.parentNode) typingNode.parentNode.removeChild(typingNode);
      typingNode = null;
    }

    function playIntroSequence() {
      var p = getProfile();
      var firstName = p && p.name ? p.name.split(' ')[0] : '';
      var verified = !!state.data.email_verified;
      var hasEmail = !!state.data.email;

      var msgs = [];
      msgs.push(firstName
        ? 'Welcome back, ' + firstName + '! 👋'
        : "Hi! I'm here to schedule a callback for you — should take under a minute.");

      if (verified) {
        msgs.push("Share your phone for the fastest reply, or skip — we have your verified email on file.");
      } else if (hasEmail) {
        msgs.push("Share your phone or WhatsApp number" + (googleEnabled() ? ", verify via Google" : "") + ", or skip — we already have your email.");
      } else if (p && p.phone) {
        msgs.push("Confirm your phone number" + (googleEnabled() ? ", or sign in with Google to add your email." : "."));
      } else {
        msgs.push("Share your phone or WhatsApp number" + (googleEnabled() ? ", or sign in with Google to get started." : " to get started."));
      }
      revealIntroNext(msgs, 0);
    }
    function revealIntroNext(msgs, idx) {
      if (!state.open || !dom.body) return;
      if (idx >= msgs.length) { renderStep(); return; }
      showTyping();
      var dur = idx === 0 ? cfg.typingFastMs : cfg.typingSlowMs;
      setTimeout(function () {
        if (!state.open || !dom.body) return;
        hideTyping();
        sayBot(msgs[idx]);
        setTimeout(function () { revealIntroNext(msgs, idx + 1); }, 250);
      }, dur);
    }

    /* ---- success screen ------------------------------------------ */

    function renderSuccess() {
      clearFoot();
      var firstName = (state.data.name || '').split(' ')[0];
      var greeting = firstName ? ('Thanks, ' + firstName + '!') : 'Thanks!';

      pushEvent('lead_success', {
        form_name: 'chat_demo',
        product_interest: (state.data.interests && state.data.interests[0]) || null,
        user_data: { phone_number: state.data.phone, email: null }
      });

      var box = el('div', { class: 'nt-chat-success' }, [
        el('div', { class: 'nt-chat-success-ico' }, [icon('check')]),
        el('h4', null, greeting + " We've got your details."),
        el('p',  null, "Our team will reach out within one business day." + (WA_NUMBER ? ' Want to chat now?' : ''))
      ]);
      if (WA_NUMBER) {
        box.appendChild(el('a', {
          class: 'wa', href: waLink(state.data),
          target: '_blank', rel: 'noopener noreferrer',
          'data-cta-type': 'whatsapp', 'data-cta-location': 'chatbot'
        }, [icon('whatsapp'), 'WhatsApp now']));
      }
      dom.body.appendChild(box);
      scrollBodyToBottom();
    }

    function waLink(d) {
      var labels = (d.interests || []).map(function (k) {
        var item = INTERESTS.filter(function (x) { return x.key === k; })[0];
        return item ? item.label : k;
      }).join(', ');
      var lines = ['Hi! I just submitted my details.', ''];
      if (d.name)         lines.push('Name: '         + d.name);
      if (d.phone)        lines.push('Phone: '        + d.phone);
      if (d.email)        lines.push('Email: '        + d.email + (d.email_verified ? ' (verified)' : ''));
      if (labels)         lines.push('Interests: '    + labels);
      if (d.team_size)    lines.push('Team size: '    + d.team_size);
      if (d.requirements) lines.push('Requirements: ' + d.requirements);
      lines.push('', 'Looking forward to the callback.');
      return 'https://wa.me/' + WA_NUMBER + '/?text=' + encodeURIComponent(lines.join('\n'));
    }

    /* ---- email pipeline ------------------------------------------ */

    function persistToProfile(stageNum) {
      profileCall(profile && profile.update, {
        phone:          state.data.phone,
        name:           state.data.name,
        team_size:      state.data.team_size,
        requirements:   state.data.requirements,
        interests:      state.data.interests,
        email:          state.data.email,
        email_verified: !!state.data.email_verified,
        company:        state.data.company,
        industry:       state.data.industry,
        max_stage_reached: stageNum
      });
    }

    function computeNewInterests() {
      var fn = profile && profile.getNewInterests;
      if (typeof fn === 'function') {
        try { return fn(state.data.interests || []); } catch (e) {}
      }
      return (state.data.interests || []).slice();
    }

    function labelForInterest(key) {
      var item = INTERESTS.filter(function (x) { return x.key === key; })[0];
      return item ? item.label : key;
    }

    function sendStageEmail(stageNum, stageName) {
      if (stageNum <= state.stageEmailed) return;
      state.stageEmailed = stageNum;
      saveState();

      persistToProfile(stageNum);

      var meta = STEP_META[stageName] || {};
      if (!meta.send_mail) return;

      // Without a contactable identity, nothing to send.
      if (!state.data.phone && !state.data.email) return;

      var attr        = (attribution && attribution.get) ? attribution.get() : null;
      var p           = getProfile();
      var newInterests= stageName === 'interests' ? computeNewInterests() : [];
      var isReturning = Boolean(p && (p.emailed_interests || []).length > 0);

      var mailNum = profileCall(profile && profile.bumpEmailsSentCount) || stageNum;

      var stageInfo = {
        stageNum: stageNum, stageName: stageName,
        isFinal: isFinalStage(stageNum), mailNum: mailNum,
        newInterests: newInterests, isReturning: isReturning,
        meta: meta
      };

      var payload = {
        data: state.data, profile: p, attribution: attr, stage: stageInfo,
        interests: INTERESTS, labelForInterest: labelForInterest
      };

      // 1. Caller hook — wins. If onSubmit is set, library hands off completely.
      if (typeof cfg.onSubmit === 'function') {
        try { cfg.onSubmit(stageInfo, payload); } catch (e) {}
      } else if (cfg.mailer && cfg.mailer.url && cfg.mailer.secretKey) {
        // 2. Built-in mailer (simple POST) — opinionated subject + body.
        builtinMailerSend(payload);
      }

      if (stageName === 'interests') {
        profileCall(profile && profile.markInterestsEmailed, state.data.interests || []);
      }

      if (stageInfo.isFinal) {
        pushEvent('lead_submit', {
          form_name: state.data.source === 'book_demo' ? 'book_demo' : 'chat_demo',
          product_interest: (state.data.interests && state.data.interests[0]) || null,
          utm_source:   attr && attr.utm_source   || null,
          utm_medium:   attr && attr.utm_medium   || null,
          utm_campaign: attr && attr.utm_campaign || null,
          gclid:        attr && attr.gclid        || null,
          is_returning: isReturning
        });
      }
    }

    function builtinMailerSend(payload) {
      var m = cfg.mailer;
      var to = (m.recipients && m.recipients.length) ? m.recipients : [m.fallback || 'support@example.com'];
      var subject = (typeof m.subject === 'function')
        ? m.subject(payload)
        : defaultSubject(payload);
      var content = (typeof m.body === 'function')
        ? m.body(payload)
        : defaultBody(payload);

      to.forEach(function (recipient) {
        fetch(m.url, {
          method: 'POST', mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: subject, content: content,
            email_secret_key: m.secretKey, to_email: recipient
          }),
          keepalive: true
        }).catch(function () {});
      });
    }

    function defaultSubject(payload) {
      var d = payload.data, s = payload.stage;
      var who = d.name || d.phone || d.email || 'partial';
      var icon = s.isFinal ? '✅' : (s.meta.icon || '📝');
      var label = s.isFinal ? 'COMPLETE' : (s.meta.label || s.stageName);
      return 'Mail #' + s.mailNum + ' — ' + icon + ' ' + label + ': ' + who;
    }
    function defaultBody(payload) {
      var d = payload.data;
      var lines = [];
      ['name', 'phone', 'email', 'team_size', 'requirements'].forEach(function (k) {
        if (d[k]) lines.push('<p><strong>' + k + ':</strong> ' + esc(d[k]) + '</p>');
      });
      if (d.interests && d.interests.length) {
        lines.push('<p><strong>interests:</strong> ' +
          d.interests.map(function (k) { return esc(payload.labelForInterest(k)); }).join(', ') + '</p>');
      }
      return '<html><body style="font-family:Arial,sans-serif;">' + lines.join('') + '</body></html>';
    }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    /* ---- submitFullLead (book-demo passthrough) ------------------- */

    function submitFullLead(data, opts) {
      data = data || {};
      var phoneIn = data.phone || state.data.phone;
      var emailIn = data.email || state.data.email;
      if (!phoneIn && !emailIn) {
        return Promise.reject(new Error('No phone or email provided'));
      }

      ['name', 'phone', 'dial_code', 'email', 'team_size', 'requirements',
       'company', 'industry', 'source'].forEach(function (k) {
        if (data[k] != null && data[k] !== '') state.data[k] = data[k];
      });
      if (data.email_verified) state.data.email_verified = true;
      if (Array.isArray(data.interests) && data.interests.length) {
        state.data.interests = data.interests.slice();
      }

      var finalStage     = STEPS.length;
      var finalStageName = STEPS[STEPS.length - 1];
      if (state.stageEmailed >= finalStage) state.stageEmailed = finalStage - 1;
      state.step = finalStage;
      saveState();

      sendStageEmail(finalStage, finalStageName);

      pushEvent('lead_success', {
        form_name: data.source || 'chat_demo',
        product_interest: (state.data.interests && state.data.interests[0]) || null,
        user_data: { phone_number: state.data.phone, email: state.data.email || null }
      });

      return Promise.resolve();
    }

    /* ---- auto-expand --------------------------------------------- */

    function shouldAutoExpand() {
      if (!cfg.autoExpand) return false;
      if (state.open) return false;
      if (state.autoExpanded) return false;
      if (state.stageEmailed >= STEPS.length) return false;
      if (cfg.autoExpandBlockedPaths && cfg.autoExpandBlockedPaths.test(location.pathname)) return false;
      return true;
    }
    function maybeAutoExpand() {
      if (!shouldAutoExpand()) return;
      state.autoExpanded = true;
      saveState();
      if (state.open) return;
      open({ focused: false });
    }

    /* ---- book-demo link interceptor ------------------------------- */

    function isPlainLeftClick(e) {
      return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
    }
    function bookDemoAnchorFor(target) {
      if (!cfg.bookDemoHrefPattern) return null;
      if (!target || !target.closest) return null;
      var a = target.closest('a[href]');
      if (!a) return null;
      if (a.target && a.target !== '' && a.target !== '_self') return null;
      if (a.hasAttribute('download')) return null;
      var href = (a.getAttribute('href') || '').trim();
      if (!href || href.charAt(0) === '#') return null;
      return cfg.bookDemoHrefPattern.test(href.split('?')[0].split('#')[0]) ? a : null;
    }
    function installBookDemoInterceptor() {
      if (!cfg.bookDemoHrefPattern) return;
      if (global.__chatboxBookDemoIntercepted) return;
      global.__chatboxBookDemoIntercepted = true;
      document.addEventListener('click', function (e) {
        if (!isPlainLeftClick(e)) return;
        var a = bookDemoAnchorFor(e.target);
        if (!a) return;
        e.preventDefault();
        open({ focused: true });
      });
    }

    /* ---- boot ---------------------------------------------------- */

    function boot() {
      mount();
      installBookDemoInterceptor();
      setTimeout(maybeAutoExpand, cfg.autoExpandDelayMs);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }

    return {
      open:           function (opts) { open(opts || {}); },
      openFocused:    function ()     { open({ focused: true }); },
      close:          close,
      reset:          resetChat,
      submitFullLead: submitFullLead,
      getState:       function () { return JSON.parse(JSON.stringify(state)); },
      config:         cfg
    };
  }

  /* =================================================================== *
   *  Shallow merge with adapter-friendly handling (objects merged one
   *  level deep, primitives + arrays replaced wholesale).
   * =================================================================== */
  function mergeConfig(base, over) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over).forEach(function (k) {
      var bv = base[k], ov = over[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) && !(bv instanceof RegExp) &&
          ov && typeof ov === 'object' && !Array.isArray(ov) && !(ov instanceof RegExp)) {
        var merged = {};
        Object.keys(bv).forEach(function (kk) { merged[kk] = bv[kk]; });
        Object.keys(ov).forEach(function (kk) { merged[kk] = ov[kk]; });
        out[k] = merged;
      } else {
        out[k] = ov;
      }
    });
    return out;
  }

  /* =================================================================== *
   *  Singleton facade. Calling Chatbox.init() multiple times no-ops
   *  after the first (matches the old window.__ntChatbotMounted guard).
   * =================================================================== */

  var instance = null;

  var Chatbox = {
    __loaded: true,
    init: function (userCfg) {
      if (instance) return instance;
      instance = createInstance(userCfg);
      return instance;
    },
    open:           function (opts) { if (instance) instance.open(opts); },
    openFocused:    function ()     { if (instance) instance.openFocused(); },
    close:          function ()     { if (instance) instance.close(); },
    reset:          function ()     { if (instance) instance.reset(); },
    submitFullLead: function (d, o) { return instance ? instance.submitFullLead(d, o) : Promise.reject(new Error('Chatbox not initialised')); },
    getState:       function ()     { return instance ? instance.getState() : null; }
  };

  global.Chatbox = Chatbox;

  if (typeof module !== 'undefined' && module.exports) module.exports = Chatbox;
})(typeof window !== 'undefined' ? window : this);
