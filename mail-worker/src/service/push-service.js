import { upgradeV34 } from '../init/upgrade-v34';
import { requireAdmin } from '../security/admin';
import BizError from '../error/biz-error';
import { validateDestination, redactDestination, normalizeEmail } from './push-validation';

const rows = async (db, sql, ...params) =>
	(
		await db
			.prepare(sql)
			.bind(...params)
			.all()
	).results;
const nameValue = (value) => {
	if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new BizError('Name required, max 100 characters', 400);
	return value.trim();
};

function enabledValue(value) {
	if (value === undefined || value === true || value === 1) return 1;
	if (value === false || value === 0) return 0;
	throw new BizError('Invalid enabled state', 400);
}

const pushService = {
	async initialized(c) {
		await upgradeV34(c);
	},
	async destinations(c) {
		requireAdmin(c);
		await this.initialized(c);
		return (await rows(c.env.db, 'SELECT * FROM push_destination ORDER BY created_at,id')).map(redactDestination);
	},
	async saveDestination(c, params) {
		requireAdmin(c);
		await this.initialized(c);
		const enabled = enabledValue(params.enabled);
		const id = params.id || crypto.randomUUID();
		const old = params.id ? await c.env.db.prepare('SELECT * FROM push_destination WHERE id=?').bind(id).first() : null;
		if (params.id && !old) throw new BizError('Destination not found', 404);
		if (old && old.type !== params.type) throw new BizError('Destination type cannot change', 400);
		const config = validateDestination(params.type, params.config, c.env, old ? JSON.parse(old.config) : {}, !enabled);
		await c.env.db
			.prepare(
				`INSERT INTO push_destination(id,name,type,enabled,config) VALUES (?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,config=excluded.config,updated_at=CURRENT_TIMESTAMP`,
			)
			.bind(id, nameValue(params.name), params.type, enabled, JSON.stringify(config))
			.run();
		return id;
	},
	async deleteDestination(c, id) {
		requireAdmin(c);
		await c.env.db.prepare('DELETE FROM push_destination WHERE id=?').bind(id).run();
	},
	async rules(c) {
		requireAdmin(c);
		await this.initialized(c);
		const db = c.env.db;
		const [rules, accounts, targets, recipients] = await Promise.all([
			rows(db, 'SELECT * FROM push_rule ORDER BY priority DESC,id'),
			rows(
				db,
				`SELECT ra.rule_id,a.account_id,a.email,a.is_del,u.is_del AS owner_deleted FROM push_rule_account ra JOIN account a ON a.account_id=ra.account_id JOIN user u ON u.user_id=a.user_id`,
			),
			rows(db, 'SELECT rd.rule_id,d.id,d.name,d.enabled FROM push_rule_destination rd JOIN push_destination d ON d.id=rd.destination_id'),
			rows(db, 'SELECT * FROM push_rule_recipient'),
		]);
		return rules.map((rule) => {
			const ac = accounts.filter((a) => a.rule_id === rule.id),
				ds = targets.filter((d) => d.rule_id === rule.id);
			return {
				...rule,
				accountIds: ac.map((a) => a.account_id),
				accounts: ac,
				destinationIds: ds.map((d) => d.id),
				destinations: ds,
				recipients: recipients.filter((r) => r.rule_id === rule.id).map((r) => r.email),
				valid:
					ds.some((d) => d.enabled) &&
					(rule.recipient_mode !== 'selected' || ac.some((a) => !a.is_del && !a.owner_deleted)) &&
					(rule.recipient_mode !== 'legacy_selected' || recipients.some((r) => r.rule_id === rule.id)),
			};
		});
	},
	async saveRule(c, params) {
		requireAdmin(c);
		await this.initialized(c);
		const id = params.id || crypto.randomUUID(),
			db = c.env.db;
		if (params.id && !(await db.prepare('SELECT id FROM push_rule WHERE id=?').bind(id).first())) throw new BizError('Rule not found', 404);
		if (!['selected', 'all_registered', 'legacy_all', 'legacy_selected'].includes(params.recipient_mode))
			throw new BizError('Invalid recipient mode', 400);
		const enabled = enabledValue(params.enabled);
		for (const key of ['accountIds', 'destinationIds', 'recipients'])
			if (params[key] !== undefined && !Array.isArray(params[key])) throw new BizError('Invalid rule associations', 400);
		const accountIds = [...new Set((params.accountIds || []).map(Number))],
			destinationIds = [...new Set(params.destinationIds || [])];
		const recipients = [...new Set((params.recipients || []).map(normalizeEmail))];
		if (
			accountIds.length > 100 ||
			destinationIds.length < 1 ||
			destinationIds.length > 20 ||
			(params.recipient_mode === 'selected' && !accountIds.length) ||
			(params.recipient_mode === 'legacy_selected' && (!recipients.length || recipients.includes('')))
		)
			throw new BizError('Invalid rule associations', 400);
		const priority = Number(params.priority || 0);
		if (!Number.isInteger(priority) || Math.abs(priority) > 10000) throw new BizError('Invalid priority', 400);
		for (const aid of accountIds)
			if (
				!Number.isSafeInteger(aid) ||
				!(await db
					.prepare(
						'SELECT a.account_id FROM account a JOIN user u ON u.user_id=a.user_id WHERE a.account_id=? AND a.is_del=0 AND u.is_del=0',
					)
					.bind(aid)
					.first())
			)
				throw new BizError('Mailbox no longer available', 400);
		for (const did of destinationIds)
			if (!(await db.prepare('SELECT id FROM push_destination WHERE id=?').bind(did).first()))
				throw new BizError('Destination no longer available', 400);
		const statements = [
			db
				.prepare(
					`INSERT INTO push_rule(id,name,enabled,recipient_mode,priority) VALUES (?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,recipient_mode=excluded.recipient_mode,priority=excluded.priority,updated_at=CURRENT_TIMESTAMP`,
				)
				.bind(id, nameValue(params.name), enabled, params.recipient_mode, priority),
			db.prepare('DELETE FROM push_rule_account WHERE rule_id=?').bind(id),
			db.prepare('DELETE FROM push_rule_destination WHERE rule_id=?').bind(id),
			db.prepare('DELETE FROM push_rule_recipient WHERE rule_id=?').bind(id),
		];
		if (params.recipient_mode === 'selected')
			for (const aid of accountIds) statements.push(db.prepare('INSERT INTO push_rule_account VALUES (?,?)').bind(id, aid));
		if (params.recipient_mode === 'legacy_selected')
			for (const recipient of recipients) statements.push(db.prepare('INSERT INTO push_rule_recipient VALUES (?,?)').bind(id, recipient));
		for (const did of destinationIds) statements.push(db.prepare('INSERT INTO push_rule_destination VALUES (?,?)').bind(id, did));
		await db.batch(statements);
		return id;
	},
	async deleteRule(c, id) {
		requireAdmin(c);
		await c.env.db.prepare('DELETE FROM push_rule WHERE id=?').bind(id).run();
	},
	async resolve(c, recipient) {
		await this.initialized(c);
		const address = normalizeEmail(recipient);
		if (!address) throw new BizError('Invalid recipient / 收件邮箱无效', 400);
		const base = address.replace(/\+[^@]*(?=@)/, '');
		const account = await c.env.db
			.prepare(
				`SELECT a.* FROM account a
		 WHERE a.email COLLATE NOCASE IN (?,?) ORDER BY CASE WHEN a.email=? COLLATE NOCASE THEN 0 ELSE 1 END LIMIT 1`,
			)
			.bind(address, base, address)
			.first();
		// An exact deleted mailbox must not fall through to a base mailbox or Catch-all rule.
		if (
			account &&
			(account.is_del || !(await c.env.db.prepare('SELECT user_id FROM user WHERE user_id=? AND is_del=0').bind(account.user_id).first()))
		)
			return { recipient: address, account: null, rules: [], destinations: [] };
		const matching = await rows(
			c.env.db,
			`SELECT DISTINCT r.id,r.name,r.priority FROM push_rule r WHERE r.enabled=1 AND (
		 r.recipient_mode='legacy_all' OR (r.recipient_mode='all_registered' AND ?<>0) OR
		 (r.recipient_mode='selected' AND EXISTS(SELECT 1 FROM push_rule_account ra WHERE ra.rule_id=r.id AND ra.account_id=?)) OR
		 (r.recipient_mode='legacy_selected' AND EXISTS(SELECT 1 FROM push_rule_recipient rr WHERE rr.rule_id=r.id AND rr.email=? COLLATE NOCASE))) ORDER BY r.priority DESC,r.id`,
			account?.account_id || 0,
			account?.account_id || 0,
			address,
		);
		const destinations = new Map();
		if (matching.length) {
			const list = await rows(
				c.env.db,
				`SELECT d.*,rd.rule_id FROM push_destination d JOIN push_rule_destination rd ON rd.destination_id=d.id
		 WHERE d.enabled=1 AND rd.rule_id IN (SELECT value FROM json_each(?))`,
				JSON.stringify(matching.map((r) => r.id)),
			);
			for (const row of list) {
				const { rule_id, ...d } = row;
				if (!destinations.has(d.id)) destinations.set(d.id, { ...d, config: JSON.parse(d.config), ruleIds: [] });
				destinations.get(d.id).ruleIds.push(rule_id);
			}
		}
		return { recipient: address, account, rules: matching, destinations: [...destinations.values()] };
	},
	async simulate(c, recipient) {
		requireAdmin(c);
		const result = await this.resolve(c, recipient);
		return { ...result, destinations: result.destinations.map(redactDestination) };
	},
	async logs(c) {
		requireAdmin(c);
		return rows(c.env.db, 'SELECT * FROM push_delivery_log ORDER BY id DESC LIMIT 100');
	},
	async cleanup(c) {
		await c.env.db.prepare("DELETE FROM push_delivery_log WHERE created_at < datetime('now','-30 days')").run();
	},
};
export default pushService;
