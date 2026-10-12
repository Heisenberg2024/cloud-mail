import { assertPublicDns } from './push-validation';

const webhookService = {
	async sendEmail(c, emailRow, destination) {
		const { url, secret, retry, timeout } = destination.config;
		const body = JSON.stringify({
			emailId: emailRow.emailId,
			sendEmail: emailRow.sendEmail,
			sendName: emailRow.name,
			toEmail: emailRow.toEmail,
			toName: emailRow.toName,
			subject: emailRow.subject,
			text: emailRow.text,
			content: emailRow.content,
			code: emailRow.code,
			createTime: emailRow.createTime,
			destinationId: destination.id,
			ruleIds: destination.ruleIds || [],
		});
		let error = '',
			attempts = 0;
		try {
			await assertPublicDns(url);
		} catch {
			return { status: 'failed', attempts, error: 'Webhook public DNS validation failed' };
		}
		for (let i = 0; i <= retry; i++) {
			attempts++;
			try {
				const res = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: secret } : {}) },
					body,
					redirect: 'error',
					signal: AbortSignal.timeout(timeout),
				});
				await res.body?.cancel();
				if (res.ok) return { status: 'success', attempts, error: '' };
				error = `Webhook HTTP ${res.status}`;
				if (res.status < 500 && res.status !== 429) break;
			} catch {
				error = 'Webhook network/timeout/redirect failure';
			}
		}
		return { status: 'failed', attempts, error };
	},
};
export default webhookService;
