import { env, fetchMock } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import telegramService from '../src/service/telegram-service';
import webhookService from '../src/service/webhook-service';

const token = '123456:abcdefghijklmnopqrstuvwxyz12345';
const destination = {
	id: 'network-regression',
	config: { token, chatIds: ['123456'], from: 'show', to: 'show', text: 'show', viewLink: false, showCode: false },
};
const mail = { emailId: 1, subject: 'Regression', name: 'Sender', sendEmail: 'from@example.com', toEmail: 'to@example.com', text: 'test' };
const hook = {
	id: 'hook-regression',
	config: { url: 'https://notify.example.net/hook', secret: 'private-secret', retry: 2, timeout: 1000 },
};
function telegramReply(method, status, body, headers = {}) {
	return fetchMock
		.get('https://api.telegram.org')
		.intercept({ method: 'POST', path: `/bot${token}/${method}` })
		.reply(status, typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...headers } });
}
function publicDns(status = 200, headers = {}) {
	for (const type of ['A', 'AAAA']) {
		fetchMock
			.get('https://cloudflare-dns.com')
			.intercept({ method: 'GET', path: `/dns-query?name=notify.example.net&type=${type}` })
			.reply(status, JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }), {
				headers: { 'Content-Type': 'application/json', ...headers },
			});
	}
}
function webhookReply(status, headers = {}) {
	return fetchMock.get('https://notify.example.net').intercept({ method: 'POST', path: '/hook' }).reply(status, '', { headers });
}
beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());
afterAll(() => fetchMock.deactivate());

// Keep native fetch intact: replacing it with vi.spyOn bypassed RequestInit
// validation and let unsupported redirect: 'error' pass the original tests.
describe('Native Workers outbound fetch compatibility', () => {
	it('delivers Telegram through the native request path', async () => {
		telegramReply('sendMessage', 200, { ok: true });
		expect(await telegramService.sendEmailToBot({ env }, mail, destination)).toMatchObject({ status: 'success', error: '' });
	});
	it('tests Bot, Chat and message stages through native fetch', async () => {
		for (const method of ['getMe', 'getChat', 'sendMessage']) telegramReply(method, 200, { ok: true });
		expect(await telegramService.test(destination.config)).toMatchObject({
			tokenValid: true,
			status: 'success',
			chats: [{ chatId: '123456', chatValid: true, sent: true }],
		});
	});
	it('rejects Telegram redirects without following their private destination', async () => {
		telegramReply('sendMessage', 302, '', { Location: 'http://127.0.0.1/secret' });
		expect(await telegramService.sendEmailToBot({ env }, mail, destination)).toMatchObject({
			status: 'failed',
			error: 'Chat 123456: Telegram sendMessage redirect blocked (HTTP 302)',
		});
	});
	it('preserves an HTTP failure when its body is not JSON', async () => {
		telegramReply('sendMessage', 401, `sensitive response ${token}`);
		const result = await telegramService.sendEmailToBot({ env }, mail, destination);
		expect(result.error).toBe('Chat 123456: Telegram sendMessage failed (HTTP 401)');
		expect(JSON.stringify(result)).not.toContain(token);
	});
	it('distinguishes invalid success JSON from request failures without leaking its body', async () => {
		telegramReply('sendMessage', 200, `sensitive response ${token}`);
		const result = await telegramService.sendEmailToBot({ env }, mail, destination);
		expect(result.error).toBe('Chat 123456: Telegram sendMessage invalid JSON response (HTTP 200)');
		expect(JSON.stringify(result)).not.toContain(token);
	});
	it('reports API rejection even if Telegram returns HTTP 200', async () => {
		telegramReply('sendMessage', 200, { ok: false, description: `sensitive response ${token}` });
		const result = await telegramService.sendEmailToBot({ env }, mail, destination);
		expect(result.error).toBe('Chat 123456: Telegram sendMessage API rejected request (HTTP 200)');
		expect(JSON.stringify(result)).not.toContain(token);
	});
	it('delivers Webhook through native DNS and POST requests', async () => {
		publicDns();
		webhookReply(200);
		expect(await webhookService.sendEmail({ env }, mail, hook)).toMatchObject({ status: 'success', attempts: 1, error: '' });
	});
	it('blocks Webhook redirects without retrying or forwarding Authorization', async () => {
		publicDns();
		webhookReply(307, { Location: 'http://127.0.0.1/secret' });
		expect(await webhookService.sendEmail({ env }, mail, hook)).toMatchObject({
			status: 'failed',
			attempts: 1,
			error: 'Webhook redirect blocked (HTTP 307)',
		});
	});
	it('keeps bounded Webhook retries after the compatibility repair', async () => {
		publicDns();
		webhookReply(503).times(3);
		expect(await webhookService.sendEmail({ env }, mail, hook)).toMatchObject({ status: 'failed', attempts: 3, error: 'Webhook HTTP 503' });
	});
	it('rejects DoH redirects before any Webhook request', async () => {
		publicDns(302, { Location: 'http://127.0.0.1/secret' });
		expect(await webhookService.sendEmail({ env }, mail, hook)).toMatchObject({
			status: 'failed',
			attempts: 0,
			error: 'Webhook public DNS validation failed',
		});
	});
});
