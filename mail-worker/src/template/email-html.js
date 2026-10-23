import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';

export default function emailHtmlTemplate(html, domain) {
	const source = parseHTML(html.replace(/{{domain}}/g, (domainUtils.toOssDomain(domain) || '') + '/')).document;
	const sourceBody = source.querySelector('body');
	const { document } = parseHTML(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; }
        html { background: #fff; overflow-wrap: anywhere; }
        body {
            margin: 0;
            padding: 15px 10px;
            color: #13181d;
            background: #fff;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 14px;
            line-height: 1.5;
            overflow: auto;
        }
        img { max-width: 100%; height: auto; }
        table { max-width: 100%; }
        pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    </style>
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
	return document.toString();
}
