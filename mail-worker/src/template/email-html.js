import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';
import emailViewStyle from './email-view-style';

export default function emailHtmlTemplate(html, domain) {
	const source = parseHTML(html.replace(/{{domain}}/g, (domainUtils.toOssDomain(domain) || '') + '/')).document;
	const sourceBody = source.querySelector('body');
	const { document } = parseHTML(`<!DOCTYPE html>
<html lang="en" data-mail-view>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
</head>
<body></body>
</html>`);

	// Render on the server: the mail-view CSP deliberately disables all scripts.
	// Keep mail-specific CSS and body presentation without a JS/shadow-DOM bootstrap.
	for (const style of source.querySelectorAll('head style')) document.head.appendChild(style.cloneNode(true));
	if (sourceBody) {
		for (const attribute of sourceBody.attributes) document.body.setAttribute(attribute.name, attribute.value);
	}
	document.body.innerHTML = sourceBody ? sourceBody.innerHTML : source.toString();
	document.querySelectorAll('script,iframe,frame,frameset,object,embed,base,meta[http-equiv]').forEach(node => node.remove());
	for (const element of document.querySelectorAll('*')) {
		for (const attribute of [...element.attributes]) {
			if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
		}
	}
	for (const table of document.querySelectorAll('table')) {
		if (table.getAttribute('role') === 'presentation') continue;
		const ownHeaders = [...table.querySelectorAll('th')].filter(cell => cell.closest('table') === table);
		const ownRows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
		const hasManyColumns = ownRows.some(row => [...row.children].filter(cell => /^(TD|TH)$/.test(cell.tagName)).length > 3);
		const hasCaption = [...table.querySelectorAll('caption')].some(caption => caption.closest('table') === table);
		if (ownHeaders.length < 3 && !hasManyColumns && !hasCaption && !['table', 'grid'].includes(table.getAttribute('role'))) continue;
		table.setAttribute('data-mail-data-table', '');
		const scroll = document.createElement('div');
		scroll.setAttribute('data-mail-table-scroll', '');
		scroll.setAttribute('tabindex', '0');
		table.parentNode.insertBefore(scroll, table);
		scroll.appendChild(table);
	}
	// Keep the viewport constraints after the sender's styles, without enabling JS.
	const viewStyle = document.createElement('style');
	viewStyle.textContent = emailViewStyle;
	document.head.appendChild(viewStyle);
	return document.toString();
}
