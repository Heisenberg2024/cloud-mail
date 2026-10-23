import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';
import emailViewStyle from './email-view-style';

function limitInlineSpace(value) {
	const length = /^(\d*\.?\d+)(px|pt|em|rem)$/i.exec(value);
	if (!length || Number(length[1]) === 0 || (length[2].toLowerCase() === 'px' && Number(length[1]) <= 4)) return value;
	// The fallback preserves desktop geometry; only the mobile viewport sets the limit.
	return `min(${value}, var(--mail-view-inline-limit, ${value}))`;
}

function replaceStyleValue(style, property, value) {
	const original = style.getPropertyValue(property);
	const priority = style.getPropertyPriority?.(property) || (/!important\s*$/i.test(original) ? 'important' : '');
	// linkedom stores priority inside the value; stylesheet CSSOM stores it separately.
	style.setProperty(property, value + (!style.getPropertyPriority && priority ? ' !important' : ''), priority);
}

function adaptStyle(style) {
	let changed = false;
	const whiteSpace = style.getPropertyValue('white-space') || '';
	if (/^nowrap\s*(?:!important)?$/i.test(whiteSpace.trim())) {
		replaceStyleValue(style, 'white-space', 'var(--mail-view-white-space, nowrap)');
		changed = true;
	}
	for (const property of ['min-width', 'min-inline-size']) {
		const original = style.getPropertyValue(property);
		if (!original) continue;
		const value = original.replace(/\s*!important\s*$/i, '').trim();
		replaceStyleValue(style, property, `var(--mail-view-min-width, ${value})`);
		changed = true;
	}
	for (const property of ['max-width', 'max-inline-size']) {
		const original = style.getPropertyValue(property);
		if (!original) continue;
		const value = original.replace(/\s*!important\s*$/i, '').trim();
		const next = /^(?:\d|\.|calc\(|min\(|max\(|clamp\(|var\()/i.test(value)
			? `min(${value}, var(--mail-view-max-width, ${value}))`
			: `var(--mail-view-max-width, ${value})`;
		replaceStyleValue(style, property, next);
		changed = true;
	}
	for (const property of ['padding', 'margin', 'padding-inline', 'margin-inline', 'padding-left', 'padding-right', 'margin-left', 'margin-right', 'padding-inline-start', 'padding-inline-end', 'margin-inline-start', 'margin-inline-end']) {
		const original = style.getPropertyValue(property);
		if (!original) continue;
		const value = original.replace(/\s*!important\s*$/i, '').trim();
		const parts = value.split(/\s+/);
		// Leave calc/var expressions and other complex sender CSS intact.
		if (!parts.every(part => /^(?:-?\d*\.?\d+(?:px|pt|em|rem|%)?|auto)$/i.test(part))) continue;
		let next;
		if (property === 'padding' || property === 'margin') {
			if (parts.length > 4) continue;
			const [top, right = top, bottom = top, left = right] = parts;
			const inlineRight = limitInlineSpace(right);
			const inlineLeft = limitInlineSpace(left);
			if (right === inlineRight && left === inlineLeft) continue;
			next = [top, inlineRight, bottom, inlineLeft].join(' ');
		} else {
			if (parts.length > (property.endsWith('-inline') ? 2 : 1)) continue;
			next = parts.map(limitInlineSpace).join(' ');
			if (next === value) continue;
		}
		replaceStyleValue(style, property, next);
		changed = true;
	}
	return changed;
}

function adaptStyleRules(rules) {
	let changed = false;
	for (const rule of rules) {
		if (rule.style && adaptStyle(rule.style)) changed = true;
		if (rule.cssRules && adaptStyleRules(rule.cssRules)) changed = true;
	}
	return changed;
}

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
	for (const element of document.querySelectorAll('[style]')) {
		adaptStyle(element.style);
		if (!/^(IMG|SVG|VIDEO)$/.test(element.tagName)) continue;
		for (const [property, variable] of [['height', '--mail-view-media-height'], ['min-height', '--mail-view-media-min-height']]) {
			const original = element.style.getPropertyValue(property);
			if (original) replaceStyleValue(element.style, property, `var(${variable}, ${original.replace(/\s*!important\s*$/i, '').trim()})`);
		}
	}
	for (const style of document.querySelectorAll('style')) {
		try {
			const rules = style.sheet.cssRules;
			if (adaptStyleRules(rules)) style.textContent = [...rules].map(rule => rule.cssText).join('\n');
		} catch {
			// Keep sender CSS verbatim if linkedom cannot parse its syntax.
		}
	}
	const cellPaddingRules = new Set();
	for (const table of document.querySelectorAll('table')) {
		const padding = table.getAttribute('cellpadding');
		if (/^\d+(?:\.\d+)?$/.test(padding || '') && Number(padding) > 4) {
			table.setAttribute('data-mail-cellpadding', padding);
			// Zero specificity lets explicit sender cell styles keep precedence.
			const cells = `:where([data-mail-cellpadding="${padding}"] > tr > :is(td, th), [data-mail-cellpadding="${padding}"] > :is(thead, tbody, tfoot) > tr > :is(td, th))`;
			cellPaddingRules.add(`${cells} { padding-left: ${limitInlineSpace(padding + 'px')}; padding-right: ${limitInlineSpace(padding + 'px')}; }`);
		}
		const ownHeaders = [...table.querySelectorAll('th')].filter(cell => cell.closest('table') === table);
		const ownRows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
		const columnCounts = ownRows.map(row => [...row.children].filter(cell => /^(TD|TH)$/.test(cell.tagName)).length);
		const hasManyColumns = columnCounts.some(count => count > 3);
		const hasTabularRows = columnCounts.filter(count => count > 1).length > 1 && !table.querySelector('table');
		const hasCaption = [...table.querySelectorAll('caption')].some(caption => caption.closest('table') === table);
		const isLayout = ['presentation', 'none'].includes(table.getAttribute('role'));
		const isDataTable = !isLayout && (ownHeaders.length > 0 || hasManyColumns || hasTabularRows || hasCaption || ['table', 'grid'].includes(table.getAttribute('role')));
		if (!isDataTable) {
			const singleColumn = ownRows.length > 0 && columnCounts.every(count => count <= 1);
			if (singleColumn) table.setAttribute('data-mail-layout-table', '');
			const width = table.style.width || table.getAttribute('width') || '';
			if (singleColumn || !table.parentElement.closest('table') || (/^\d+(?:\.\d+)?(?:px)?$/i.test(width) && parseFloat(width) > 280)) table.setAttribute('data-mail-fluid-table', '');
			continue;
		}
		table.setAttribute('data-mail-data-table', '');
		const scroll = document.createElement('div');
		scroll.setAttribute('data-mail-table-scroll', '');
		scroll.setAttribute('tabindex', '0');
		table.parentNode.insertBefore(scroll, table);
		scroll.appendChild(table);
	}
	if (cellPaddingRules.size) {
		const style = document.createElement('style');
		style.textContent = [...cellPaddingRules].join('\n');
		document.head.insertBefore(style, document.head.firstChild);
	}
	// Keep the viewport constraints after the sender's styles, without enabling JS.
	const viewStyle = document.createElement('style');
	viewStyle.textContent = emailViewStyle;
	document.head.appendChild(viewStyle);
	return document.toString();
}
