import BizError from '../error/biz-error';

export const splitValues = (value) =>
	Array.isArray(value)
		? value
		: String(value || '')
				.split(',')
				.map((v) => v.trim())
				.filter(Boolean);
export function normalizeEmail(value) {
	if (typeof value !== 'string') return '';
	const email = value.trim().toLowerCase();
	const parts = email.split('@');
	if (
		parts.length !== 2 ||
		email.length > 254 ||
		parts[0].length > 64 ||
		!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) ||
		parts[0].startsWith('.') ||
		parts[0].endsWith('.') ||
		parts[0].includes('..')
	)
		return '';
	try {
		const domain = new URL(`https://${parts[1]}`).hostname;
		if (
			!domain.includes('.') ||
			domain !== new URL(`https://${parts[1]}`).host ||
			/[/?#:]/.test(parts[1]) ||
			domain.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
		)
			return '';
		return `${parts[0]}@${domain}`;
	} catch {
		return '';
	}
}
export function validateWebhookUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new BizError('Invalid Webhook URL / Webhook URL 无效', 400);
	}
	const host = url.hostname.toLowerCase();
	// Only public DNS hostnames; URL parsing also canonicalizes alternate numeric IP forms.
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.hash ||
		(url.port && url.port !== '443') ||
		!host.includes('.') ||
		!/^[a-z0-9.-]+$/.test(host) ||
		/^\d+\.\d+\.\d+\.\d+$/.test(host) ||
		host.endsWith('.') ||
		/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)
	) {
		throw new BizError('Webhook requires a public HTTPS hostname / Webhook 须使用公共 HTTPS 域名', 400);
	}
	return url.toString();
}
export function isPublicIp(ip) {
	if (ip.includes(':')) {
		const value = ip.toLowerCase();
		// Global unicast only; reject mapped, documentation, transition and special ranges.
		return /^[23][0-9a-f]{3}:/.test(value) && !/^(2001:(0*:|db8:|2:|10:|20:)|2002:|3fff:)/.test(value);
	}
	const parts = ip.split('.').map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
	const [a, b] = parts;
	return !(
		a === 0 ||
		a === 10 ||
		a === 127 ||
		a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && [0, 168].includes(b)) ||
		(a === 198 && [18, 19, 51].includes(b)) ||
		(a === 203 && b === 0)
	);
}
export async function assertPublicDns(url) {
	const host = new URL(validateWebhookUrl(url)).hostname;
	const responses = await Promise.all(
		['A', 'AAAA'].map(async (type) => {
			const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
				headers: { Accept: 'application/dns-json' },
				redirect: 'error',
				signal: AbortSignal.timeout(3000),
			});
			if (!res.ok) throw new Error('DNS validation failed');
			const result = await res.json();
			if (result.Status !== 0) throw new Error('DNS validation failed');
			return result.Answer || [];
		}),
	);
	const addresses = responses.flat().filter((r) => r.type === 1 || r.type === 28);
	if (!addresses.length || addresses.some((r) => !isPublicIp(r.data))) throw new Error('Webhook DNS is not public');
}
export function validateDestination(type, input, env = {}, existing = {}, allowIncomplete = false) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BizError('Invalid configuration', 400);
	const config = {};
	const secret = (key) => {
		if (input[`clear${key[0].toUpperCase()}${key.slice(1)}`] === true) return '';
		const value = input[key] || existing[key] || '';
		if (typeof value !== 'string' || value.length > 2048 || /[\r\n]/.test(value)) throw new BizError('Invalid secret', 400);
		return value;
	};
	if (type === 'telegram') {
		config.token = secret('token');
		if (!(allowIncomplete && !config.token) && !/^\d+:[a-zA-Z0-9_-]{20,}$/.test(config.token))
			throw new BizError('Telegram token required / Telegram Token 无效', 400);
		config.chatIds = [...new Set(splitValues(input.chatIds).map((v) => String(v).trim()))];
		if (!config.chatIds.length || config.chatIds.length > 20 || config.chatIds.some((id) => !/^-?\d+$|^@[a-zA-Z0-9_]{5,}$/.test(id)))
			throw new BizError('Invalid Chat IDs', 400);
		for (const [key, values, fallback] of [
			['from', ['show', 'hide', 'only-name'], 'only-name'],
			['to', ['show', 'hide'], 'show'],
			['text', ['show', 'hide'], 'show'],
		]) {
			config[key] = values.includes(input[key]) ? input[key] : fallback;
		}
		config.customDomain = input.customDomain || '';
		if (config.customDomain) {
			const origin = new URL(config.customDomain.startsWith('https://') ? config.customDomain : `https://${config.customDomain}`);
			if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
				throw new BizError('Invalid mail view origin', 400);
			config.customDomain = origin.origin;
		}
		config.showCode = input.showCode !== false;
		config.viewLink = input.viewLink !== false;
	} else if (type === 'email') {
		config.recipients = [...new Set(splitValues(input.recipients).map(normalizeEmail))];
		let domains = env.domain || [];
		if (typeof domains === 'string') domains = JSON.parse(domains);
		domains = domains.map((d) => new URL(`https://${d}`).hostname);
		if (
			!config.recipients.length ||
			config.recipients.length > 20 ||
			config.recipients.some((r) => !r || domains.includes(r.split('@')[1]))
		)
			throw new BizError('Invalid forwarding email or internal loop / 转发地址无效或会形成站内循环', 400);
	} else if (type === 'webhook') {
		config.url = validateWebhookUrl(input.url);
		config.secret = secret('secret');
		config.retry = Number(input.retry ?? 0);
		config.timeout = Number(input.timeout ?? 5000);
		if (
			!Number.isInteger(config.retry) ||
			config.retry < 0 ||
			config.retry > 2 ||
			!Number.isInteger(config.timeout) ||
			config.timeout < 1000 ||
			config.timeout > 5000
		)
			throw new BizError('Retry 0–2; timeout 1000–5000 ms', 400);
	} else throw new BizError('Invalid destination type', 400);
	return config;
}

export function redactDestination(row) {
	const config = typeof row.config === 'string' ? JSON.parse(row.config) : { ...row.config };
	const safe = { ...config };
	for (const key of ['token', 'secret']) {
		if (key in safe) {
			safe[`has${key[0].toUpperCase()}${key.slice(1)}`] = !!safe[key];
			delete safe[key];
		}
	}
	// Secret presence flags support editing without returning stored credentials.
	return { ...row, config: safe };
}
