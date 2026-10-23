import pushService from './push-service';
import telegramService from './telegram-service';
import webhookService from './webhook-service';
import { normalizeEmail, validateDestination } from './push-validation';
import { requireAdmin } from '../security/admin';
import BizError from '../error/biz-error';
import emailService from './email-service';

const retryErrors = {
	test: 'Connection test records cannot be retried / 连接测试记录不能再次投递',
	original: 'Email forwarding requires the original email stream / 邮箱转发缺少原始邮件流，不能再次投递',
	target_missing: 'Original destination not found / 原推送目标已删除',
	target_changed: 'Original destination type changed / 推送目标类型与原记录不符',
	target_disabled: 'Original destination disabled / 原推送目标已停用',
	mail_unavailable: 'Original received email or mailbox unavailable / 原收件邮件、邮箱或所属用户已不可用',
	recipient_mismatch: 'Original email recipient mismatch / 邮件收件人与原投递记录不符',
	pending: 'Delivery in progress; retry later / 该邮件正在投递，请稍后重试',
};

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
	async retry(c, id) {
		requireAdmin(c);
		id = Number(id);
		if (!Number.isSafeInteger(id) || id < 1) throw new BizError('Invalid delivery log ID / 投递记录 ID 无效', 400);
		const log = await pushService.deliveryLog(c, id);
		if (!log) throw new BizError('Delivery log not found / 投递记录不存在', 404);
		if (log.retry_reason) throw new BizError(retryErrors[log.retry_reason], 409);
		const emailRow = await emailService.selectById(c, log.email_id);
		const destination = await c.env.db.prepare('SELECT * FROM push_destination WHERE id=?').bind(log.destination_id).first();
		if (!emailRow || !destination) throw new BizError('Original email or destination changed; refresh / 原邮件或目标已变化，请刷新', 409);
		if (normalizeEmail(emailRow.toEmail) !== normalizeEmail(log.recipient))
			throw new BizError(retryErrors.recipient_mismatch, 409);
		const storedConfig = destination.config;
		destination.config = validateDestination(destination.type, JSON.parse(storedConfig), c.env);
		// The conditional insert is the cross-request lock. Match the captured target
		// configuration and current ownership again before any external side effect.
		const claim = await c.env.db.prepare(`INSERT INTO push_delivery_log(email_id,recipient,destination_id,type,status,attempts,error)
		 SELECT e.email_id,?,d.id,d.type,'pending',0,'' FROM email e JOIN push_destination d ON d.id=?
		 WHERE e.email_id=? AND e.is_del=0 AND e.type=0 AND e.status IN (0,7)
		 AND e.account_id=? AND e.user_id=? AND e.to_email=? AND d.enabled=1 AND d.type=? AND d.config=?
		 AND ((e.account_id=0 AND e.user_id=0 AND e.status=7) OR EXISTS(
		 SELECT 1 FROM account a JOIN user u ON u.user_id=a.user_id
		 WHERE a.account_id=e.account_id AND a.user_id=e.user_id AND a.is_del=0 AND u.is_del=0))
		 AND EXISTS(SELECT 1 FROM push_delivery_log l WHERE l.id=? AND l.email_id=e.email_id AND l.destination_id=d.id AND l.type=d.type AND l.recipient=?)
		 AND NOT EXISTS(SELECT 1 FROM push_delivery_log p WHERE p.email_id=e.email_id AND p.destination_id=d.id
		 AND p.status='pending' AND p.created_at>=datetime('now','-60 seconds')) RETURNING id`)
			.bind(log.recipient, destination.id, emailRow.emailId, emailRow.accountId, emailRow.userId, emailRow.toEmail,
				log.type, storedConfig, id, log.recipient).first();
		if (!claim) throw new BizError('Delivery in progress or source/target changed; refresh / 正在投递或原邮件、目标已变化，请刷新', 409);
		const outcome = await this.deliver(c, emailRow, destination);
		await this.record(c, emailRow, log.recipient, destination, outcome, claim.id);
		return { logId: claim.id, ...outcome };
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
