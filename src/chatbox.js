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

  // If libphonenumber-js is loaded on the page (window.libphonenumber, exposes
  // isValidPhoneNumber + parsePhoneNumberFromString), the default phone
  // validator uses it for country-aware length/prefix checks. Otherwise it
  // falls back to a permissive 7–15 digit count.
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
    var validators = cfg.validators || DEFAULT_VALIDATORS;
    var profile    = cfg.profile    || createLocalStorageProfile(cfg.storageKey + '_profile');
    var ipLocation = cfg.ipLocation || null;
    var dialPicker = cfg.dialPicker || null;
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
