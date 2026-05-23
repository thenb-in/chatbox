/**
 * @nt/chatbox — Forms module.
 *
 * Attach a regular HTML <form>, get phone + email validation, a country
 * dial-code picker (via adapter), and an optional "Sign in with Google"
 * button — without each consuming site rebuilding the wiring.
 *
 * Adapters are explicit (no global lookups). Configure once per page with
 * Forms.configure({...}), or pass overrides per-form via Forms.attach()'s
 * options. The library itself reads nothing off the host's window.
 *
 * Quick start:
 *
 *   Forms.configure({
 *     validators:   MyValidators,          // { isValidPhoneDigits, isValidEmail }
 *     dialPicker:   MyDialPicker,          // { create({selected, ariaLabel}) -> {element, getValue, setValue, dispose} }
 *     ipLocation:   MyIPLocation,          // { getDialCode() -> '+91' }
 *     googleSignIn: { clientId: '...' },   // omit/null disables Google entirely
 *     profile:      MyProfile              // { update(patch), get() }
 *   });
 *
 *   var f = Forms.attach(form, {
 *     phone:  '#phone',                    // or { input, dialMount, picker:false }
 *     email:  '#email',
 *     name:   '#name',
 *     googleSignIn: true,                  // or { mount, text } / false to opt out
 *     onGoogleSignIn: function (profile) { ... }
 *   });
 *
 *   f.validate();        // -> boolean, applies .nt-field.is-invalid on wrappers
 *   f.getDialCode();     // -> '+91'
 *   f.setPhone('+91 98765 43210');
 *   f.getFullPhone();    // -> '+91 98765 43210'
 *   f.isGoogleVerified();// -> { email, name } | null
 *   f.destroy();
 *
 * Google-verified skip:
 *   The library reads two localStorage flags (default: 'nt_signed_up',
 *   'nt_lead_captured') to detect prior Google sign-in. When the form's
 *   email value matches the verified address from the profile, the strict
 *   email-format check is skipped — Google already verified it. Override
 *   the storage keys via Forms.configure({ storageKeys: [...] }).
 *
 * License: SEE LICENSE IN ../LICENSE
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Forms = root.Forms || api;
    // Legacy alias retained for hosts that still reference window.NTForms.
    root.NTForms = root.NTForms || api;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Defaults / shared state
   * ------------------------------------------------------------------ */

  var defaults = {
    validators:        null,   // { isValidPhoneDigits, isValidEmail }
    dialPicker:        null,   // { create(opts) -> picker }
    ipLocation:        null,   // { getDialCode() }
    googleSignIn:      null,   // { clientId, scriptUrl?, theme?, text?, shape? }
    profile:           null,   // { update(patch), get() }
    storageKeys:       ['nt_signed_up', 'nt_lead_captured'],
    profileStorageKey: 'nt_profile_v1',
    fieldWrapClass:    'nt-field',     // page convention: invalid marker is set on this wrapper
    invalidClass:      'is-invalid',
    skipEmailWhenGoogleVerified: true
  };

  var GSI_DEFAULT_SRC = 'https://accounts.google.com/gsi/client';
  var STYLE_ID = 'nt-forms-styles';
  var STYLES = [
    '.nt-forms-google-row{display:flex;flex-direction:column;gap:8px;padding:14px 14px 12px;',
      'margin:0 0 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;}',
    '.nt-forms-google-hint{font-size:13px;color:#475569;line-height:1.4;}',
    '.nt-forms-google-hint strong{color:#0f172a;}',
    '.nt-forms-google-mount{min-height:40px;}'
  ].join('');

  /* ------------------------------------------------------------------ *
   *  Helpers
   * ------------------------------------------------------------------ */

  function $(sel, root) {
    if (!sel) return null;
    if (typeof sel !== 'string') return sel;
    return (root || document).querySelector(sel);
  }

  function injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function setInvalid(el, invalid, wrapClass, invalidClass) {
    if (!el || !el.closest) return;
    var wrap = el.closest('.' + wrapClass);
    if (wrap) wrap.classList.toggle(invalidClass, !!invalid);
  }

  // Splits "+91 98765 43210" → ['+91', '98765 43210']. Falls back to ['', value]
  // when no dial-code prefix is present.
  function splitPhone(v) {
    if (!v) return ['', ''];
    var m = String(v).match(/^\s*(\+\d{1,4})\s*(.*)$/);
    return m ? [m[1], m[2].trim()] : ['', String(v).trim()];
  }

  function readProfileFromStorage(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function decodeIdToken(token) {
    try {
      var b64 = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      // decodeURIComponent dance handles non-ASCII names from Google.
      var json = decodeURIComponent(atob(b64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ *
   *  Google Identity Services loader (shared across all attached forms)
   * ------------------------------------------------------------------ */

  var _gsiPromise = null;
  function loadGSI(scriptUrl) {
    var url = scriptUrl || GSI_DEFAULT_SRC;
    if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve();
    }
    if (_gsiPromise) return _gsiPromise;
    _gsiPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-nt-gsi], script[src="' + url + '"]');
      if (!existing) {
        var s = document.createElement('script');
        s.src = url; s.async = true; s.defer = true;
        s.setAttribute('data-nt-gsi', '1');
        document.head.appendChild(s);
      }
      var start = Date.now();
      (function poll() {
        if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
        if (Date.now() - start > 6000) return reject(new Error('GSI load timeout'));
        setTimeout(poll, 80);
      })();
    });
    return _gsiPromise;
  }

  /* ------------------------------------------------------------------ *
   *  Public: configure
   * ------------------------------------------------------------------ */

  function configure(opts) {
    if (!opts) return;
    Object.keys(opts).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(defaults, k)) {
        defaults[k] = opts[k];
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  Public: isGoogleVerified
   * ------------------------------------------------------------------ */

  // Truthy when any storage flag indicates a completed Google sign-in.
  // Returns { email, name } (possibly with empty strings) when verified,
  // null otherwise. Storage keys are configurable via Forms.configure().
  function isGoogleVerified(overrideConfig) {
    var cfg = overrideConfig || defaults;
    var keys = cfg.storageKeys || defaults.storageKeys;
    var hit = false;
    try {
      for (var i = 0; i < keys.length; i++) {
        if (localStorage.getItem(keys[i]) === '1') { hit = true; break; }
      }
    } catch (e) { return null; }
    if (!hit) return null;
    var p = readProfileFromStorage(cfg.profileStorageKey || defaults.profileStorageKey) || {};
    return { email: p.email || '', name: p.name || '' };
  }

  /* ------------------------------------------------------------------ *
   *  Public: attach
   * ------------------------------------------------------------------ */

  function attach(form, opts) {
    form = $(form);
    if (!form || form.tagName !== 'FORM') {
      throw new Error('Forms.attach: first arg must be a <form> element or selector');
    }
    opts = opts || {};

    // Merge per-attach adapter overrides over the configure() defaults.
    var cfg = {};
    Object.keys(defaults).forEach(function (k) { cfg[k] = defaults[k]; });
    ['validators', 'dialPicker', 'ipLocation', 'googleSignIn', 'profile',
     'storageKeys', 'profileStorageKey', 'fieldWrapClass', 'invalidClass',
     'skipEmailWhenGoogleVerified']
      .forEach(function (k) { if (k in opts) cfg[k] = opts[k]; });

    function mark(el, invalid) {
      setInvalid(el, invalid, cfg.fieldWrapClass, cfg.invalidClass);
    }

    /* ----- Phone field + dial picker ----- */
    // phone option shapes:
    //   string / element  — the input
    //   { input, dialMount, picker:false } — full control
    //   undefined         — autodetect input[type=tel] / [data-nt-phone]
    // picker:false suppresses the visible picker; validation still runs
    // against the IP-detected dial code.
    var phoneOpt = opts.phone;
    var phoneEl, dialMount, showPicker = true;
    if (phoneOpt && typeof phoneOpt === 'object' && phoneOpt.tagName == null) {
      phoneEl   = $(phoneOpt.input, form);
      dialMount = $(phoneOpt.dialMount, form);
      if (phoneOpt.picker === false) showPicker = false;
    } else {
      phoneEl   = $(phoneOpt, form) || form.querySelector('input[type="tel"], input[data-nt-phone]');
      dialMount = $(opts.dialMount, form) || form.querySelector('[data-nt-dial-mount]');
    }

    var picker = null;
    function ensurePicker(initial) {
      if (picker) return picker;
      if (!phoneEl || !showPicker) return null;
      var dp = cfg.dialPicker;
      if (!dp || !dp.create) return null;
      var ipDial = (cfg.ipLocation && cfg.ipLocation.getDialCode)
        ? cfg.ipLocation.getDialCode() : null;
      picker = dp.create({
        selected:  initial || ipDial || '+91',
        ariaLabel: 'Country code'
      });
      if (dialMount) {
        dialMount.appendChild(picker.element);
      } else if (phoneEl.parentNode) {
        phoneEl.parentNode.insertBefore(picker.element, phoneEl);
      }
      return picker;
    }

    /* ----- Email + name fields ----- */
    var emailEl = $(opts.email, form) ||
                  form.querySelector('input[type="email"], input[data-nt-email]');
    var nameEl  = $(opts.name, form) ||
                  form.querySelector('input[name="name"], input[data-nt-name]');

    /* ----- Sign in with Google ----- */
    // Hidden when:
    //   - opts.googleSignIn === false (page opts out)
    //   - cfg.googleSignIn has no clientId (host hasn't configured it)
    //   - the visitor is already Google-verified
    var googleOpt = opts.googleSignIn;
    var googleMountSel = null, googleHintText = null;
    if (googleOpt && typeof googleOpt === 'object') {
      googleMountSel = googleOpt.mount || null;
      googleHintText = googleOpt.text  || null;
    }

    var googleRow = null, googleBtnMount = null;
    function buildGoogleRow() {
      injectStyles();
      var mount = googleMountSel ? $(googleMountSel, form)
                                 : form.querySelector('[data-nt-google-mount]');
      if (mount) {
        googleBtnMount = mount;
        return;
      }
      googleRow = document.createElement('div');
      googleRow.className = 'nt-forms-google-row';
      var hint = document.createElement('div');
      hint.className = 'nt-forms-google-hint';
      hint.innerHTML = googleHintText ||
        'Skip the typing — <strong>sign in with Google</strong> to autofill your name and email.';
      googleBtnMount = document.createElement('div');
      googleBtnMount.className = 'nt-forms-google-mount';
      googleRow.appendChild(hint);
      googleRow.appendChild(googleBtnMount);
      form.insertBefore(googleRow, form.firstChild);
    }

    function applyGoogleProfile(profile) {
      if (!profile) return;
      var email = profile.email || '';
      var name  = profile.name  || '';
      if (cfg.profile && typeof cfg.profile.update === 'function') {
        try {
          cfg.profile.update({
            name: name, email: email,
            email_verified: !!profile.email_verified
          });
        } catch (e) {}
      }
      // Mark the visitor signed-in so future loads skip strict email checks.
      try {
        var key = (cfg.storageKeys && cfg.storageKeys[0]) || 'nt_signed_up';
        localStorage.setItem(key, '1');
      } catch (e) {}
      if (emailEl && !emailEl.value && email) {
        emailEl.value = email;
        mark(emailEl, false);
      }
      if (nameEl && !nameEl.value && name) {
        nameEl.value = name;
        mark(nameEl, false);
      }
      if (googleRow && googleRow.parentNode) {
        googleRow.parentNode.removeChild(googleRow);
      }
      if (typeof opts.onGoogleSignIn === 'function') {
        try { opts.onGoogleSignIn(profile); } catch (e) {}
      }
    }

    function maybeMountGoogle() {
      if (googleOpt === false) return;
      var gsi = cfg.googleSignIn;
      if (!gsi || !gsi.clientId) return;
      if (isGoogleVerified(cfg)) return;
      buildGoogleRow();
      if (!googleBtnMount) return;
      loadGSI(gsi.scriptUrl).then(function () {
        try {
          window.google.accounts.id.initialize({
            client_id: gsi.clientId,
            ux_mode: 'popup', auto_select: false, context: 'signin',
            callback: function (resp) {
              applyGoogleProfile(decodeIdToken(resp && resp.credential));
            }
          });
          window.google.accounts.id.renderButton(googleBtnMount, {
            type:  'standard',
            theme: gsi.theme || 'outline',
            size:  gsi.size  || 'large',
            text:  gsi.text  || 'continue_with',
            shape: gsi.shape || 'rectangular',
            width: gsi.width || 280
          });
        } catch (e) {}
      }).catch(function () {});
    }

    /* ----- Controller methods ----- */

    function getDialCode() { return picker ? picker.getValue() : null; }
    function setDialCode(v) {
      ensurePicker(v);
      if (picker && v) picker.setValue(v);
    }
    function setPhone(v) {
      var parts = splitPhone(v);
      ensurePicker(parts[0] || null);
      if (parts[0] && picker) picker.setValue(parts[0]);
      if (phoneEl) {
        phoneEl.value = parts[0] ? parts[1] : (parts[1] || String(v || '').trim());
      }
    }
    function getFullPhone() {
      var d = getDialCode() || '';
      var n = phoneEl ? String(phoneEl.value || '').trim() : '';
      if (!n) return '';
      return d ? (d + ' ' + n) : n;
    }

    function validate() {
      var ok = true;
      var V = cfg.validators || {};

      if (phoneEl) {
        var dial = getDialCode();
        if (!dial && cfg.ipLocation && cfg.ipLocation.getDialCode) {
          dial = cfg.ipLocation.getDialCode() || '';
        }
        var phoneVal = String(phoneEl.value || '').trim();
        var phoneOk = !!(V.isValidPhoneDigits && V.isValidPhoneDigits(phoneVal, dial || ''));
        mark(phoneEl, !phoneOk);
        if (!phoneOk) ok = false;
      }

      if (emailEl) {
        var emailVal = String(emailEl.value || '').trim();
        var verified = isGoogleVerified(cfg);
        var emailOk;
        if (cfg.skipEmailWhenGoogleVerified && verified && verified.email &&
            verified.email.toLowerCase() === emailVal.toLowerCase()) {
          emailOk = true;
        } else {
          emailOk = !!(V.isValidEmail && V.isValidEmail(emailVal));
        }
        mark(emailEl, !emailOk);
        if (!emailOk) ok = false;
      }

      return ok;
    }

    /* ----- Eager mounts ----- */

    // Mount the dial picker as soon as the adapter is ready. The host may
    // load the dial-picker adapter via defer, so poll briefly.
    (function mountPickerWhenReady(retries) {
      if (typeof retries !== 'number') retries = 20;
      if (ensurePicker(null)) return;
      if (retries <= 0) return;
      setTimeout(function () { mountPickerWhenReady(retries - 1); }, 80);
    })();

    // Mount the Google button as soon as a client ID is available. The
    // host may call Forms.configure() after the form has already attached,
    // so poll briefly for the configured clientId.
    (function mountGoogleWhenReady(retries) {
      if (typeof retries !== 'number') retries = 30;
      // Use the LIVE defaults reference if no per-attach override was given,
      // so a later Forms.configure() takes effect.
      var liveGsi = ('googleSignIn' in opts) ? cfg.googleSignIn : defaults.googleSignIn;
      cfg.googleSignIn = liveGsi;
      if (liveGsi && liveGsi.clientId) { maybeMountGoogle(); return; }
      if (retries <= 0) return;
      setTimeout(function () { mountGoogleWhenReady(retries - 1); }, 80);
    })();

    return {
      form:       form,
      phoneInput: phoneEl,
      emailInput: emailEl,
      nameInput:  nameEl,
      validate:           validate,
      getDialCode:        getDialCode,
      setDialCode:        setDialCode,
      setPhone:           setPhone,
      getFullPhone:       getFullPhone,
      isGoogleVerified:   function () { return isGoogleVerified(cfg); },
      destroy: function () {
        if (picker && picker.dispose) picker.dispose();
        picker = null;
        if (googleRow && googleRow.parentNode) {
          googleRow.parentNode.removeChild(googleRow);
        }
      }
    };
  }

  /* ------------------------------------------------------------------ *
   *  Module exports
   * ------------------------------------------------------------------ */

  return {
    configure:        configure,
    attach:           attach,
    isGoogleVerified: isGoogleVerified,
    splitPhone:       splitPhone,
    __version:        '0.1.0'
  };
});
