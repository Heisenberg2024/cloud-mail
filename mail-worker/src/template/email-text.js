import emailViewStyle from './email-view-style';

export default function emailTextTemplate(text) {
	const escapedText = String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return `<!DOCTYPE html>
<html lang='en' data-mail-view>
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0, viewport-fit=cover'>
    <style>
        ${emailViewStyle}
        span {
            display: block;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

    </style>
</head>
<body>
<span>${escapedText}</span>
</body>
</html>`
}
