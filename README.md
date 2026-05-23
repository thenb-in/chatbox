# @nt/chatbox

Embeddable lead-capture chatbox widget. Drop in two files, call `Chatbox.init(...)`, get a configurable bottom-right conversation that walks a visitor through whatever steps you configure (phone, email, interests, etc.) and hands you the final lead payload via a callback.

Originally extracted from the [Navlakha Technologies landing page](../landing-page) so the same widget can be reused across other NT properties.

---

## Install

### Option A — CDN (recommended for NT sites)

Load directly from jsDelivr, pinned to a release tag:

```html
<link  rel="stylesheet" href="https://cdn.jsdelivr.net/gh/thenb-in/chatbox@v1.0.0/src/chatbox.css">
<script src="https://cdn.jsdelivr.net/gh/thenb-in/chatbox@v1.0.0/src/chatbox.js"></script>
```

Pin formats:
- `@v1.0.0` — exact version (safest for prod)
- `@v1`     — latest 1.x patch (auto-picks up `v1.0.1`, `v1.1.0`, …)
- `@latest` — head of `main` (do **not** use in prod — a bad commit breaks every site)

To force-refresh a moving pointer like `@v1` after a release:
`https://purge.jsdelivr.net/gh/thenb-in/chatbox@v1/src/chatbox.js`

### Option B — Self-host

Copy `src/chatbox.js` + `src/chatbox.css` onto your own CDN/server and reference them however you serve other static assets.

### Option C — Symlink / local copy (in-repo)

```html
<link  rel="stylesheet" href="/path/to/chatbox/src/chatbox.css">
<script src="/path/to/chatbox/src/chatbox.js"></script>
```

---

The script exposes `module.exports` for CommonJS environments. It only touches the DOM once `Chatbox.init()` is called.

Icons (`fa-comments`, `fa-paper-plane`, etc.) come from [Font Awesome 4](https://fontawesome.com/v4/icons/) — load it on the host page. If you don't, the chat still works; you just lose the glyphs.

---

## Quick start

```html
<script>
Chatbox.init({
  brand: {
    name:          'Acme Co',
    avatarText:    'AC',
    tagline:       'Online — replies in ~5 min',
    launcherTitle: 'Chat with us',
    launcherSub:   'Schedule a callback'
  },
  steps: ['phone', 'mail', 'name'],
  whatsappNumber: '15555550100',
  onSubmit: function (stage, payload) {
    // stage.isFinal === true on the last step
    // payload.data = { phone, email, name, interests: [...], ... }
    // POST it wherever — your CRM, mailer, Slack, etc.
    fetch('/api/leads', { method: 'POST', body: JSON.stringify(payload.data) });
  }
});
</script>
```

That's it. The widget mounts a launcher pill in the bottom-right, auto-expands after 10 s (unless the visitor's already on a blocklisted path), and resumes mid-flow on page nav via `sessionStorage`.

---

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `brand` | `{ name: 'Support', ... }` | Header text, launcher label |
| `steps` | `['phone', 'mail', 'name']` | Step IDs, in order. Pick from: `phone`, `interests`, `team_size`, `mail`, `name`, `requirements` |
| `stepMeta` | per-step icon/label/`send_mail` | Each step's icon + email-subject label. Set `send_mail: false` to keep a step silent |
| `interests` | `[]` | `[ { key, label }, ... ]` for the multi-select chips |
| `teamSizes` | `['1 – 10', ...]` | Quick-reply pills shown at `team_size` |
| `autoExpand` | `true` | Auto-open the panel after `autoExpandDelayMs` |
| `autoExpandDelayMs` | `10000` | Delay before auto-expand |
| `autoExpandBlockedPaths` | `/book-demo\|thank-you\|order\|.../i` | RegExp matched against `location.pathname` |
| `bookDemoHrefPattern` | `/book-demo/i` | If set, clicks on links matching this open the chat focused instead of navigating. Set `null` to disable |
| `whatsappNumber` | `null` | Phone (no +) used by the success-screen WA deep-link. Omit to hide |
| `storageKey` | `'chatbox_state_v1'` | sessionStorage key — namespace if you embed two |
| `mountId` | `'chatbox-root'` | DOM id of the root element (auto-created if missing) |
| `stylesHref` | `null` | If set, the lib injects `<link rel=stylesheet href=...>` once |
| `googleSignIn` | `null` | `{ clientId: '...', enabled: true }`. Off by default |
| `mailer` | `null` | Built-in HTTP POST mailer — see below |
| `onSubmit` | `null` | `function(stageInfo, payload)` — wins over `mailer` if set |
| `onEvent` | `null` | `function(name, payload)` — analytics hook (also pushes to `dataLayer`) |

### Adapters

All of these are optional. Pass an adapter to swap behaviour; omit it and the lib uses a sensible default (or no-op).

```js
Chatbox.init({
  validators: {
    isValidPhoneDigits: function (input, dialCode) { ... },
    isValidEmail:       function (input) { ... }
  },
  ipLocation: {
    getDialCode: function () { return '+91'; }
  },
  dialPicker: {
    // Render a custom country picker — returns an element + value getter
    create: function ({ selected, ariaLabel }) {
      return { element: HTMLElement, getValue: function () { return '+91'; } };
    }
  },
  attribution: {
    get: function () { return { utm_source: 'google', ... }; }
  },
  profile: {
    get:               function () { ... },          // returns saved profile
    update:            function (patch) { ... },     // shallow-merge patch
    getCurrentProduct: function () { ... },
    setInterests:      function (arr) { ... },
    bumpChatOpenCount: function () { ... },
    bumpEmailsSentCount: function () { ... },        // returns lifetime counter
    getNewInterests:   function (current) { ... },
    markInterestsEmailed: function (arr) { ... }
  }
});
```

If no `profile` is given, a built-in `localStorage`-backed profile is used (namespaced from `storageKey`). All adapter methods are individually optional — missing methods become no-ops.

### Submitting leads

Two ways:

**1. `onSubmit` callback** — full control. Fires on every step whose `stepMeta.send_mail` is truthy. Payload:

```js
{
  data: {            // user input collected so far
    phone, dial_code, email, email_verified,
    name, interests, team_size, requirements,
    company, industry, source
  },
  profile,           // adapter snapshot (or null)
  attribution,       // adapter snapshot (or null)
  stage: {
    stageNum, stageName, isFinal, mailNum,
    newInterests, isReturning, meta
  },
  interests,         // your INTERESTS array (for label lookup)
  labelForInterest   // helper(key) -> label
}
```

**2. Built-in mailer** — convenient default that POSTs to an HTTP endpoint:

```js
Chatbox.init({
  mailer: {
    url:        'https://your.mailer/api/send',
    secretKey:  'shared-secret',
    recipients: ['sales@yourco.com', 'cs@yourco.com'],
    // Optional overrides — defaults are minimal
    subject:    function (payload) { return '...'; },
    body:       function (payload) { return '<html>...</html>'; }
  }
});
```

Body shape per recipient: `{ subject, content, email_secret_key, to_email }`. Fires `keepalive: true` so a tab-close mid-step still ships the request.

`onSubmit` wins — if both are set, the built-in mailer is bypassed entirely.

### Programmatic API

```js
Chatbox.open();             // open compact dock
Chatbox.openFocused();      // open centered modal w/ backdrop
Chatbox.close();
Chatbox.reset();
Chatbox.submitFullLead({    // bypass the conversation, ship a final-stage submit
  name: '...', phone: '...', email: '...', interests: [...]
});
Chatbox.getState();         // read-only snapshot of current chat state
```

`init()` is idempotent — calling it twice returns the existing instance.

### Events

Pushed both to `window.dataLayer` (if present) and to your `onEvent` callback:

- `chat_open` — `{ focused: boolean }`
- `chat_step_complete` — `{ step, step_number }`
- `chat_reset` — `{ reset_count }`
- `lead_submit` — fired once, on final-stage email send
- `lead_success` — fired on success screen render + `submitFullLead`

### Theming

Override CSS custom properties on `:root` or `#chatbox-root`:

```css
:root {
  --cb-primary:       #6366f1;
  --cb-primary-hover: #4f46e5;
  --cb-accent:        #fde047;
  --cb-text:          #18181b;
  --cb-muted:         #71717a;
  --cb-bg:            #ffffff;
  --cb-bg-soft:       #f4f4f5;
  --cb-border:        #e4e4e7;
  --cb-error:         #ef4444;
  --cb-success:       #22c55e;
}
```

---

## Steps reference

Each built-in step ID accepts the visitor's input and stores it under the matching key on `state.data`:

| Step | Renders | Stores |
|---|---|---|
| `phone` | Dial picker + tel input, optional Google sign-in & skip | `data.phone`, `data.dial_code` |
| `interests` | Multi-select chips from `config.interests` | `data.interests` (array of keys) |
| `team_size` | Quick-reply pills from `config.teamSizes` | `data.team_size` |
| `mail` | Email input + optional Google sign-in | `data.email`, `data.email_verified` |
| `name` | Text input | `data.name` |
| `requirements` | Textarea + Skip | `data.requirements` |

`steps: ['phone', 'mail']` is the minimum sensible flow. Reorder freely.

---

## Forms module

`src/forms.js` is a separate, lightweight library for **regular HTML `<form>` elements** — not the chatbox widget. Attach a form, get phone + email validation, an optional country dial-code picker, and an optional "Sign in with Google" button — without each consuming site rewriting the wiring.

It shares the chatbox's adapter philosophy: nothing is read from globals; everything is injected.

### Install

```html
<script src="https://cdn.jsdelivr.net/gh/thenb-in/chatbox@v1/src/forms.js"></script>
```

Exposes `window.Forms` (and `window.NTForms` as a legacy alias).

### Configure once

```js
Forms.configure({
  validators:   MyValidators,            // { isValidPhoneDigits, isValidEmail }
  dialPicker:   MyDialPicker,            // { create({selected, ariaLabel}) -> picker }
  ipLocation:   MyIPLocation,            // { getDialCode() -> '+91' }
  googleSignIn: { clientId: '...' },     // omit/null disables Google entirely
  profile:      MyProfile,               // { update(patch), get() } — optional
  storageKeys:  ['nt_signed_up', 'nt_lead_captured'],  // override if needed
  fieldWrapClass: 'nt-field',            // wrapper toggled for invalid state
  invalidClass:   'is-invalid'
});
```

`Forms.configure()` is idempotent — call once per page after your adapters load. You can also pass any of these per-attach as overrides.

### Attach per form

```js
var f = Forms.attach(document.querySelector('#my-form'), {
  phone:  '#phone-input',                // or { input, dialMount, picker: false }
  email:  '#email-input',
  name:   '#name-input',                 // optional; populated on Google sign-in
  googleSignIn: true,                    // or { mount, text } / false to opt out
  onGoogleSignIn: function (profile) { /* { email, name, email_verified } */ }
});

f.validate();         // -> boolean, applies invalid class on the wrapper
f.getDialCode();      // -> '+91' (null if picker:false)
f.setPhone('+91 98765 43210');
f.getFullPhone();     // -> '+91 98765 43210'
f.isGoogleVerified(); // -> { email, name } | null
f.destroy();
```

### Google sign-in skip

If a configured `storageKeys` flag is `'1'` (default: `nt_signed_up` / `nt_lead_captured`) AND the form's email field value matches the verified address stored in `profileStorageKey` (default: `nt_profile_v1`), `f.validate()` skips the strict email format check — Google has already verified that address. Phone validation always runs (Google doesn't provide one).

### Google button visibility

The "Sign in with Google" button is rendered iff:

1. `googleSignIn.clientId` is set in `configure()` or `attach()` opts, **and**
2. `attach()` was not called with `googleSignIn: false`, **and**
3. The visitor isn't already verified (`isGoogleVerified()` returns null).

No client ID configured = no button rendered. The library never talks to Google in that case.

### Mount target

By default the button gets injected as a small banner above the form fields. Override by either:

- Putting an empty `<div data-nt-google-mount></div>` inside the form, or
- Passing `googleSignIn: { mount: '#my-slot' }` to `attach()`.

### Required HTML

The library expects each field to live inside a wrapper element it can toggle for the invalid state. The default wrapper class is `nt-field`:

```html
<div class="nt-field">
  <label for="phone">Phone</label>
  <input id="phone" type="tel" name="phone">
</div>
```

Override via `fieldWrapClass` / `invalidClass` in `configure()`.

---

## License

Proprietary — Copyright (c) 2026 Navlakha Technologies. All rights reserved.

Use is restricted to entities explicitly named in **Schedule A** of the [LICENSE](LICENSE) file. Anyone not listed there has no right to use, copy, modify, run, or distribute this software. Common ownership, partnership, or branding with Navlakha Technologies does **not** confer a license — only the named list does.

To add an affiliate, the Schedule A list must be amended in writing by Navlakha Technologies. For licensing inquiries, contact <support@navlakha.tech>.
