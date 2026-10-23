import orm from '../entity/orm';
import email from '../entity/email';
import settingService from './setting-service';
import { eq } from 'drizzle-orm';
import jwtUtils from '../utils/jwt-utils';
import emailMsgTemplate from '../template/email-msg';
import emailTextTemplate from '../template/email-text';
import renderTelegramView, { STATIC_VIEW_CSP } from '../template/telegram-view';
import { validateDestination } from './push-validation';

function requestFailure(method, error) {
	const reason =
		error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'request timed out or aborted (5000 ms)' : 'request/network failure';
	return { ok: false, error: `Telegram ${method} ${reason}` };
}

async function telegramRequest(config, method, body = {}) {
	let response;
	try {
		response = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			// Workers runtimes used by this project reject redirect: 'error'.
			// Manual mode keeps credentials on the original host and lets us reject 3xx.
			redirect: 'manual',
			signal: AbortSignal.timeout(5000),
		});
	} catch (error) {
		return requestFailure(method, error);
	}
	if (!response.ok) {
		try {
			await response.body?.cancel();
		} catch {
			/* Keep the known HTTP failure. */
		}
		const reason = response.status >= 300 && response.status < 400 ? 'redirect blocked' : 'failed';
		return { ok: false, error: `Telegram ${method} ${reason} (HTTP ${response.status})` };
	}
	let data;
	try {
		data = await response.json();
	} catch (error) {
		if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return requestFailure(method, error);
		return { ok: false, error: `Telegram ${method} invalid JSON response (HTTP ${response.status})` };
	}
	return {
		ok: data?.ok === true,
		error: data?.ok === true ? '' : `Telegram ${method} API rejected request (HTTP ${response.status})`,
	};
}

const telegramService = {
	async getEmailContent(c, params) {
		c.set('telegramViewPolicy', STATIC_VIEW_CSP);
		const payload = await jwtUtils.verifyToken(c, params.token);
		if (!payload || payload.purpose !== 'mail-view' || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000))
			return emailTextTemplate('Access denied');
		const destination = await c.env.db
			.prepare("SELECT enabled FROM push_destination WHERE id=? AND type='telegram'")
			.bind(payload.destinationId)
			.first();
		const emailRow = await orm(c).select().from(email).where(eq(email.emailId, payload.emailId)).get();
		if (
			!destination?.enabled ||
			!emailRow ||
			emailRow.isDel ||
			emailRow.accountId !== payload.accountId ||
			emailRow.userId !== payload.userId
		)
			return emailTextTemplate('Access denied');
		if (payload.accountId) {
			const owner = await c.env.db
				.prepare(
					`SELECT a.account_id FROM account a JOIN user u ON u.user_id=a.user_id
			 WHERE a.account_id=? AND a.user_id=? AND a.is_del=0 AND u.is_del=0`,
				)
				.bind(payload.accountId, payload.userId)
				.first();
			if (!owner) return emailTextTemplate('Access denied');
		} else if (payload.userId !== 0 || emailRow.status !== 7) return emailTextTemplate('Access denied');
		const { r2Domain } = emailRow.content ? await settingService.query(c) : {};
		const view = await renderTelegramView(emailRow, r2Domain, c.env.telegram_view_renderer);
		c.set('telegramViewPolicy', view.csp);
		return view.html;
	},
	async sendEmailToBot(c, emailRow, destination) {
		const config = destination.config;
		const keyboard = [];
		let viewOrigin = config.customDomain || '';
		if (config.viewLink !== false && !viewOrigin) {
			const { customDomain } = await settingService.query(c);
			try {
				viewOrigin = validateDestination('telegram', { ...config, customDomain }, c.env).customDomain;
			} catch {
				// An invalid legacy site must not prevent the notification itself.
			}
		}
		if (config.viewLink !== false && viewOrigin) {
			const token = await jwtUtils.generateToken(
				c,
				{
					purpose: 'mail-view',
					emailId: emailRow.emailId,
					accountId: emailRow.accountId,
					userId: emailRow.userId,
					destinationId: destination.id,
				},
				900,
			);
			keyboard.push([{ text: 'View', web_app: { url: `${viewOrigin}/api/telegram/getEmail/${token}` } }]);
		}
		if (config.showCode && emailRow.code && emailRow.code.length <= 256)
			keyboard.push([{ text: emailRow.code, copy_text: { text: emailRow.code } }]);
		const results = await Promise.all(
			config.chatIds.map((chatId) =>
				telegramRequest(config, 'sendMessage', {
					chat_id: chatId,
					parse_mode: 'HTML',
					text: emailMsgTemplate(emailRow, config.to, config.from, config.text),
					...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
				}),
			),
		);
		return {
			status: results.every((r) => r.ok) ? 'success' : results.some((r) => r.ok) ? 'partial' : 'failed',
			attempts: 1,
			error: results
				.map((r, i) => (r.ok ? '' : `Chat ${config.chatIds[i]}: ${r.error}`))
				.filter(Boolean)
				.join('; ')
				.slice(0, 300),
		};
	},
	async test(config) {
		const token = await telegramRequest(config, 'getMe');
		if (!token.ok) return { tokenValid: false, chats: [], status: 'failed', error: token.error, attempts: 1 };
		const chats = await Promise.all(
			config.chatIds.map(async (chatId) => {
				const chat = await telegramRequest(config, 'getChat', { chat_id: chatId });
				if (!chat.ok) return { chatId, chatValid: false, sent: false, error: chat.error };
				const sent = await telegramRequest(config, 'sendMessage', { chat_id: chatId, text: 'Cloud Mail connection test' });
				return { chatId, chatValid: true, sent: sent.ok, error: sent.error };
			}),
		);
		return {
			tokenValid: true,
			chats,
			status: chats.every((c) => c.sent) ? 'success' : chats.some((c) => c.sent) ? 'partial' : 'failed',
			attempts: 1,
			error: chats.some((c) => !c.sent) ? 'Some Chat IDs failed; inspect test results' : '',
		};
	},
};
export default telegramService;
