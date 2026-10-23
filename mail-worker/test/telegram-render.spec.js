import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import emailHtmlTemplate from '../src/template/email-html';
import emailTextTemplate from '../src/template/email-text';

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
});
