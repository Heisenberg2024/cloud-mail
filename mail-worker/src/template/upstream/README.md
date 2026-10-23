# Upstream Telegram View templates

Copied from maillab/cloud-mail commit `c0009ddae326197e22c44986b6537ca7d97e803a` (v3.4.0).
The only source adjustment is the relative import path in `email-html.js`.

The layout, Shadow DOM bootstrap, default font and one-time whole-message zoom
remain upstream code. `../telegram-view.js` selects the active renderer, resolves
storage placeholders, escapes plain text and authorizes only the template
bootstrap through its exact response-specific CSP hash.

The existing responsive templates stay in the parent folder unchanged.
