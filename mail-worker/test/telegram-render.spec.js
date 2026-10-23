import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import emailHtmlTemplate from '../src/template/email-html';
import emailTextTemplate from '../src/template/email-text';
import mailLayoutFixtures from './fixtures/telegram-mail-layout';
import renderTelegramView, { STATIC_VIEW_CSP } from '../src/template/telegram-view';

describe('Telegram View renderer selection', () => {
	it('restores the existing responsive HTML renderer without changing its output or script policy', async () => {
		const html = '<p>Existing renderer</p><table><tr><th>Item</th></tr></table>';
		const result = await renderTelegramView({content: html}, '', 'responsive');
		expect(result.html).toBe(emailHtmlTemplate(html, ''));
		expect(result.csp).toBe(STATIC_VIEW_CSP);
	});
	it('restores the existing responsive plain text renderer including empty input', async () => {
		for (const text of ['', '<literal> & text']) {
			const result = await renderTelegramView({text}, '', 'responsive');
			expect(result.html).toBe(emailTextTemplate(text));
			expect(result.csp).toBe(STATIC_VIEW_CSP);
		}
	});
	it('rejects unknown renderer configuration rather than widening the script policy', async () => {
		await expect(renderTelegramView({content: '<p>Mail</p>'}, '', 'other')).rejects.toThrow('Unsupported telegram_view_renderer');
	});
});

describe('Telegram mail rendering with scripts disabled', () => {
	it('puts an HTML fragment directly in the returned body without a script bootstrap', () => {
		const { document } = parseHTML(emailHtmlTemplate('<p id="mail-body">Verification code: <b>123456</b></p>', ''));
		expect(document.body.querySelector('#mail-body')?.textContent).toBe('Verification code: 123456');
		expect(document.querySelector('script')).toBeNull();
	});
	it('preserves full email document styles, body attributes, tables and inline images', () => {
		const { document } = parseHTML(emailHtmlTemplate(`<!DOCTYPE html><html><head><style>.message {color: #123456}</style></head>
			<body class="message" dir="rtl" style="background: #eee"><table><tr><td id="mail-body">Original body</td></tr></table>
			<img src="{{domain}}attachments/logo.png" alt="Original image"></body></html>`, 'https://images.example.com/'));
		expect(document.body.querySelector('#mail-body')?.textContent).toBe('Original body');
		expect(document.head.textContent).toContain('.message {color: #123456}');
		expect(document.body.getAttribute('class')).toBe('message');
		expect(document.body.getAttribute('dir')).toBe('rtl');
		expect(document.body.getAttribute('style')).toBe('background: #eee');
		expect(document.body.querySelector('img')?.getAttribute('src')).toBe('https://images.example.com/attachments/logo.png');
	});
	it('removes active email content while keeping its visible text available', () => {
		const { document } = parseHTML(emailHtmlTemplate(`<p id="mail-body" onclick="alert(1)">Safe body</p>
			<script>document.body.textContent='Injected';</script>
			<iframe src="https://external.example.com"></iframe>
			<meta http-equiv="refresh" content="0;url=https://external.example.com">
			<img src="data:image/png;base64," onerror="alert(1)">`, ''));
		expect(document.body.querySelector('#mail-body')?.textContent).toBe('Safe body');
		expect(document.querySelector('script,iframe,meta[http-equiv]')).toBeNull();
		expect(document.querySelector('[onclick],[onerror]')).toBeNull();
	});
	it('renders head/body fragments even when the email omits an outer html element', () => {
		const { document } = parseHTML(emailHtmlTemplate('<head><style>.message{color:red}</style></head><body class="message"><p id="mail-body">Fragment body</p></body>', ''));
		expect(document.body.querySelector('#mail-body')?.textContent).toBe('Fragment body');
		expect(document.head.textContent).toContain('.message{color:red}');
		expect(document.body.getAttribute('class')).toBe('message');
	});
	it('displays plain-text angle brackets and markup literally rather than interpreting them as HTML', () => {
		const text = 'Line one\n<div>Literal & text</div>\n<script>Also literal</script>';
		const { document } = parseHTML(emailTextTemplate(text));
		expect(document.body.querySelector('span')?.textContent).toBe(text);
		expect(document.body.querySelector('div,script')).toBeNull();
	});
	it('contains wide data tables in a local scroll area without losing their cells', () => {
		const { document } = parseHTML(emailHtmlTemplate('<table id="data-table" style="min-width:680px"><tr><th>Item</th><th>Quantity</th><th>Amount</th></tr><tr><td>Original item</td><td>12</td><td>100</td></tr></table>', ''));
		const table = document.querySelector('#data-table');
		expect(table.parentElement.hasAttribute('data-mail-table-scroll')).toBe(true);
		expect(table.hasAttribute('data-mail-data-table')).toBe(true);
		expect(table.querySelectorAll('th,td')).toHaveLength(6);
		expect(table.textContent).toContain('Original item');
	});
	it('keeps presentation tables fluid when a nested data table needs its own scrolling', () => {
		const { document } = parseHTML(emailHtmlTemplate('<table role="presentation" id="layout" width="680"><tr><td><table id="data"><tr><th>Item</th><th>Quantity</th><th>Amount</th></tr></table></td></tr></table>', ''));
		expect(document.querySelector('#layout').hasAttribute('data-mail-data-table')).toBe(false);
		expect(document.querySelector('#data').parentElement.hasAttribute('data-mail-table-scroll')).toBe(true);
	});
	it('adapts nested inline gutters while keeping vertical spacing, auto margins and explicit columns', () => {
		const { document } = parseHTML(emailHtmlTemplate(`<table role="presentation" width="680"><tr><td style="padding:30px 40px !important">
			<div id="card" style="margin:20px auto; padding:32px 48px; padding-left:24px">
			<table role="presentation" id="nav"><tr><td width="40%">Logo</td><td>Home</td><td>Contact</td></tr></table>
			<p>Original content</p></div></td></tr></table>`, ''));
		expect(document.querySelector('td').style.padding).toMatch(/^30px min\(40px, var\(--mail-view-inline-limit, 40px\)\) 30px min\(40px, var\(--mail-view-inline-limit, 40px\)\) !important$/);
		expect(document.querySelector('#card').style.margin).toBe('20px auto');
		expect(document.querySelector('#card').style.paddingLeft).toBe('min(24px, var(--mail-view-inline-limit, 24px))');
		expect(document.querySelector('#nav td').getAttribute('width')).toBe('40%');
		expect(document.querySelector('#nav').hasAttribute('data-mail-layout-table')).toBe(false);
		expect(document.querySelector('table').hasAttribute('data-mail-layout-table')).toBe(true);
	});
	it('adapts stylesheet spacing inside media rules without overriding the sender mobile rules', () => {
		const { document } = parseHTML(emailHtmlTemplate(`<html><head><style id="sender-style">
			.card { padding:40px 60px !important; margin-left:30px; margin-right:-10px }
			@media(max-width:480px) { .card { padding:16px 0 !important } }
		</style></head><body><div class="card">Original content</div></body></html>`, ''));
		const rules = document.querySelector('#sender-style').sheet.cssRules;
		expect(rules[0].style.getPropertyValue('padding')).toContain('min(60px, var(--mail-view-inline-limit, 60px))');
		expect(rules[0].style.getPropertyPriority('padding')).toBe('important');
		expect(rules[0].style.getPropertyValue('margin-right')).toBe('-10px');
		expect(rules[1].cssRules[0].style.getPropertyValue('padding')).toBe('16px 0');
	});
	it('handles legacy cellpadding without replacing explicit cell padding or data table contents', () => {
		const { document } = parseHTML(emailHtmlTemplate(`<table role="presentation" cellpadding="40"><tr><td style="padding:8px">Content
			<table role="table" cellpadding="20"><tr><td>A</td><td>B</td></tr></table></td></tr></table>`, ''));
		expect(document.querySelector('table').getAttribute('data-mail-cellpadding')).toBe('40');
		expect(document.querySelector('td').style.padding).toBe('8px min(8px, var(--mail-view-inline-limit, 8px)) 8px min(8px, var(--mail-view-inline-limit, 8px))');
		expect(document.head.textContent).toContain(':where([data-mail-cellpadding="40"]');
		expect(document.querySelector('[role="table"]').textContent).toBe('AB');
	});
	it('contains a two-column invoice without headers in its own scroll region', () => {
		const fixture = mailLayoutFixtures.find(item => item.id === 'tables');
		const { document } = parseHTML(emailHtmlTemplate(fixture.html, ''));
		expect(document.querySelector('#invoice').parentElement.hasAttribute('data-mail-table-scroll')).toBe(true);
		expect(document.querySelector('#invoice').querySelectorAll('td')).toHaveLength(6);
		expect(document.querySelector('#report').parentElement.hasAttribute('data-mail-table-scroll')).toBe(true);
	});
	it('allows sender nowrap declarations to wrap only on mobile, retaining their priority', () => {
		const fixture = mailLayoutFixtures.find(item => item.id === 'links');
		const { document } = parseHTML(emailHtmlTemplate(fixture.html, ''));
		expect(document.querySelector('div').style.whiteSpace).toBe('var(--mail-view-white-space, nowrap)');
		const style = [...document.querySelectorAll('style')].find(node => node.textContent.includes('.tracking')).sheet.cssRules[0].style;
		expect(style.getPropertyValue('white-space')).toBe('var(--mail-view-white-space, nowrap)');
		expect(style.getPropertyPriority('white-space')).toBe('important');
	});
	it('adapts an inline important image minimum width without losing the desktop fallback', () => {
		const fixture = mailLayoutFixtures.find(item => item.id === 'images');
		const { document } = parseHTML(emailHtmlTemplate(fixture.html, ''));
		expect(document.querySelector('#hero').style.minWidth).toBe('var(--mail-view-min-width, 1200px) !important');
		expect(document.querySelector('#hero').style.maxWidth).toBe('var(--mail-view-max-width, none) !important');
		expect(document.querySelector('#hero').style.height).toBe('var(--mail-view-media-height, 360px) !important');
		expect(document.querySelector('#hero').getAttribute('width')).toBe('1200');
		expect(document.querySelector('#hero').getAttribute('height')).toBe('360');
	});
	it.each(mailLayoutFixtures)('preserves the visible contents of $name', fixture => {
		const result = fixture.text === undefined ? emailHtmlTemplate(fixture.html, '') : emailTextTemplate(fixture.text);
		const { document } = parseHTML(result);
		expect(document.body.textContent).toContain('邮件正文结束 / End of message');
		expect(document.querySelector('script,iframe')).toBeNull();
		if (fixture.text !== undefined) expect(document.querySelector('span').textContent).toBe(fixture.text);
		if (fixture.id === 'images') expect(document.querySelectorAll('img,svg')).toHaveLength(2);
	});
});
