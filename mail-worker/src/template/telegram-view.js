import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';
import responsiveHtml from './email-html';
import responsiveText from './email-text';
import upstreamHtml from './upstream/email-html';
import upstreamText from './upstream/email-text';

export const STATIC_VIEW_CSP = "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

// Default to the upstream layout for the comparison. Set the optional Worker
// variable telegram_view_renderer=responsive to restore the existing renderer.
export default async function renderTelegramView(email, domain, configuredMode) {
	const mode = configuredMode || 'upstream';
	if (mode === 'responsive') return {
		html: email.content ? responsiveHtml(email.content, domain) : responsiveText(email.text || ''),
		csp: STATIC_VIEW_CSP,
	};
	if (mode !== 'upstream') throw new Error('Unsupported telegram_view_renderer');
	if (!email.content) {
		const text = String(email.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return { html: upstreamText(text), csp: STATIC_VIEW_CSP };
	}

	// Resolve proxy URLs before the verbatim upstream template, which otherwise
	// prefixes them with "null/" when the old storage-domain setting is empty.
	const content = email.content.replace(/{{domain}}/g, (domainUtils.toOssDomain(domain) || '') + '/');
	const html = upstreamHtml(content, domain);
	const { document } = parseHTML(html);
	const scripts = [...document.querySelectorAll('script')];
	if (scripts.length !== 1 || scripts[0].hasAttribute('src')) throw new Error('Unexpected upstream View bootstrap');
	// Hash the exact trusted template script, including its surrounding whitespace.
	// The upstream template removes mail scripts and embeds its data using escaped
	// JSON, so mail content cannot add a second authorized script element.
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scripts[0].textContent));
	const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
	return {
		html,
		csp: STATIC_VIEW_CSP.replace('sandbox;', 'sandbox allow-scripts;') + `; script-src 'sha256-${hash}'`,
	};
}
