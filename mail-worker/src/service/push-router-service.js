import pushService from './push-service';
import telegramService from './telegram-service';
import webhookService from './webhook-service';
import { normalizeEmail, validateDestination } from './push-validation';
import { requireAdmin } from '../security/admin';
import BizError from '../error/biz-error';

const pushRouterService = {
	async record(c, emailRow, recipient, destination, outcome, logId) {
		const db = c.env.db;
		if (logId)
			return db
				.prepare('UPDATE push_delivery_log SET status=?,attempts=?,error=?,completed_at=CURRENT_TIMESTAMP WHERE id=?')
				.bind(outcome.status, outcome.attempts, outcome.error || '', logId)
				.run();
		const row = await db
			.prepare(
				`INSERT INTO push_delivery_log(email_id,recipient,destination_id,type,status,attempts,error)
		 VALUES (?,?,?,?,?,?,?) RETURNING id`,
			)
			.bind(emailRow?.emailId || null, recipient, destination.id, destination.type, outcome.status, outcome.attempts, outcome.error || '')
			.first();
		return row.id;
	},
	async deliver(c, emailRow, destination, message) {
		try {
			destination.config = validateDestination(destination.type, destination.config, c.env);
			if (destination.type === 'telegram') return await telegramService.sendEmailToBot(c, emailRow, destination);
			if (destination.type === 'webhook') return await webhookService.sendEmail(c, emailRow, destination);
			const results = await Promise.all(
				destination.config.recipients.map(async (recipient) => {
					if (recipient === normalizeEmail(message?.to)) return false;
					try {
						await message.forward(recipient);
						return true;
					} catch {
						return false;
					}
				}),
			);
			return {
				status: results.every(Boolean) ? 'success' : results.some(Boolean) ? 'partial' : 'failed',
				attempts: 1,
				error: results.every(Boolean)
					? ''
					: `Email forwarding failed for ${destination.config.recipients.filter((r, i) => !results[i]).join(', ')}; verify Cloudflare addresses/routing`.slice(
							0,
							300,
						),
			};
		} catch {
			return { status: 'failed', attempts: 0, error: 'Destination configuration or delivery failed' };
		}
	},
	async route(c, emailRow, message) {
		let result;
		try {
			result = await pushService.resolve(c, message.to);
		} catch {
			console.error('Push routing unavailable; saved mail retained. Run database initialization and inspect routing configuration.');
			return;
		}
		await Promise.all(
			result.destinations.map(async (destination) => {
				let logId;
				try {
					logId = await this.record(c, emailRow, result.recipient, destination, { status: 'pending', attempts: 0 });
				} catch {
					console.error('Push delivery log insert failed');
				}
				const outcome = await this.deliver(c, emailRow, destination, message);
				try {
					await this.record(c, emailRow, result.recipient, destination, outcome, logId);
				} catch {
					console.error(`Push delivery log update failed for destination ${destination.id}; status ${outcome.status}`);
				}
			}),
		);
	},
	async test(c, id) {
		requireAdmin(c);
		const destination = await c.env.db.prepare('SELECT * FROM push_destination WHERE id=?').bind(id).first();
		if (!destination) throw new BizError('Destination not found', 404);
		destination.config = validateDestination(destination.type, JSON.parse(destination.config), c.env);
		if (destination.type === 'email') throw new BizError('Email forwarding can only be verified during a real Email Routing event', 400);
		const testMail = {
			emailId: 0,
			sendEmail: 'test@example.com',
			name: 'Cloud Mail',
			toEmail: 'test@example.com',
			toName: 'Test',
			subject: 'Cloud Mail connection test',
			text: 'Connection test',
			content: '',
			code: '',
			createTime: new Date().toISOString(),
		};
		const outcome =
			destination.type === 'telegram'
				? await telegramService.test(destination.config)
				: await webhookService.sendEmail(c, testMail, destination);
		const logId = await this.record(c, null, 'connection-test', destination, { status: 'pending', attempts: 0 });
		await this.record(c, null, 'connection-test', destination, outcome, logId);
		return outcome;
	},
};
export default pushRouterService;
