import { validateDestination, normalizeEmail, splitValues } from '../service/push-validation';

export const schema = [
	`CREATE TABLE IF NOT EXISTS app_migration (version TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE IF NOT EXISTS mailbox_login_upgrade (account_id INTEGER PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
	 source_user_id INTEGER NOT NULL, nonce TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE IF NOT EXISTS push_destination (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('telegram','email','webhook')),
	 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), config TEXT NOT NULL CHECK(json_valid(config)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE IF NOT EXISTS push_rule (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
	 recipient_mode TEXT NOT NULL CHECK(recipient_mode IN ('all_registered','selected','legacy_all','legacy_selected')), priority INTEGER NOT NULL DEFAULT 0,
	 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE IF NOT EXISTS push_rule_account (rule_id TEXT NOT NULL REFERENCES push_rule(id) ON DELETE CASCADE,
	 account_id INTEGER NOT NULL REFERENCES account(account_id) ON DELETE CASCADE, PRIMARY KEY(rule_id, account_id))`,
	`CREATE TABLE IF NOT EXISTS push_rule_recipient (rule_id TEXT NOT NULL REFERENCES push_rule(id) ON DELETE CASCADE,
	 email TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY(rule_id, email))`,
	`CREATE TABLE IF NOT EXISTS push_rule_destination (rule_id TEXT NOT NULL REFERENCES push_rule(id) ON DELETE CASCADE,
	 destination_id TEXT NOT NULL REFERENCES push_destination(id) ON DELETE CASCADE, PRIMARY KEY(rule_id, destination_id))`,
	`CREATE TABLE IF NOT EXISTS push_delivery_log (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER, recipient TEXT NOT NULL,
	 destination_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
	 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)`,
	`CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_delivery_log(created_at)`,
	`CREATE INDEX IF NOT EXISTS idx_push_log_email_destination ON push_delivery_log(email_id, destination_id)`,
];

// Schema preparation is independent of legacy configuration validity, so mail
// storage and login continue even when an administrator must repair a legacy target.
export async function ensureV34Schema(c) {
	const db = c.env.db;
	const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_migration'").first();
	if (table && (await db.prepare("SELECT version FROM app_migration WHERE version='v3.4-schema'").first())) return;
	const columns = (await db.prepare('PRAGMA table_info(user)').all()).results;
	if (!columns.length) throw new Error('Database not initialized; run /api/init/:secret');
	const statements = schema.map((sql) => db.prepare(sql));
	if (!columns.some((col) => col.name === 'session_version'))
		statements.push(db.prepare('ALTER TABLE user ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'));
	statements.push(db.prepare("INSERT INTO app_migration(version) VALUES ('v3.4-schema')"));
	try {
		await db.batch(statements);
	} catch {
		const exists = await db.prepare("SELECT name FROM sqlite_master WHERE name='app_migration'").first();
		if (exists && (await db.prepare("SELECT version FROM app_migration WHERE version='v3.4-schema'").first())) return;
		throw new Error('v3.4 schema preparation failed and rolled back');
	}
}

// Legacy targets, rule associations and the completion marker commit together.
// First use and explicit initialization share this idempotent migration.
export async function upgradeV34(c) {
	await ensureV34Schema(c);
	const db = c.env.db;
	if (await db.prepare("SELECT version FROM app_migration WHERE version='v3.4'").first()) return;
	const old = await db.prepare('SELECT * FROM setting LIMIT 1').first();
	if (!old) throw new Error('Push migration requires initialized setting table');
	const destinations = [];
	if (old.tg_bot_token || old.tg_chat_id)
		destinations.push({
			id: 'legacy-telegram',
			name: 'Legacy Telegram',
			type: 'telegram',
			enabled: old.tg_bot_status === 0,
			config: {
				token: old.tg_bot_token,
				chatIds: splitValues(old.tg_chat_id),
				from: old.tg_msg_from,
				to: old.tg_msg_to,
				text: old.tg_msg_text,
				customDomain: old.custom_domain,
			},
		});
	if (old.forward_email)
		destinations.push({
			id: 'legacy-email',
			name: 'Legacy Email',
			type: 'email',
			enabled: old.forward_status === 0,
			config: { recipients: splitValues(old.forward_email) },
		});
	if (old.webhook_url)
		destinations.push({
			id: 'legacy-webhook',
			name: 'Legacy Webhook',
			type: 'webhook',
			enabled: old.webhook_status === 0,
			config: {
				url: old.webhook_url.includes('://') ? old.webhook_url : `https://${old.webhook_url}`,
				secret: old.webhook_secret,
				retry: Math.min(2, Math.max(0, Number(old.webhook_retry) || 0)),
				timeout: 5000,
			},
		});
	for (const dest of destinations) {
		try {
			dest.config = validateDestination(dest.type, dest.config, c.env, {}, !dest.enabled);
		} catch {
			throw new Error(`Push migration: invalid ${dest.type} configuration; correct legacy settings before retrying initialization`);
		}
	}
	const statements = [];
	statements.push(db.prepare("INSERT INTO app_migration(version) VALUES ('v3.4')"));
	for (const d of destinations)
		statements.push(
			db
				.prepare('INSERT INTO push_destination(id,name,type,enabled,config) VALUES (?,?,?,?,?)')
				.bind(d.id, d.name, d.type, Number(d.enabled), JSON.stringify(d.config)),
		);
	if (destinations.length) {
		const mode = old.rule_type === 1 ? 'legacy_selected' : 'legacy_all';
		statements.push(
			db.prepare('INSERT INTO push_rule(id,name,enabled,recipient_mode) VALUES (?,?,1,?)').bind('legacy-rule', 'Legacy forwarding', mode),
		);
		for (const d of destinations) statements.push(db.prepare('INSERT INTO push_rule_destination VALUES (?,?)').bind('legacy-rule', d.id));
		if (mode === 'legacy_selected')
			for (const address of new Set(splitValues(old.rule_email).map(normalizeEmail))) {
				if (!address) throw new Error('Push migration: invalid legacy recipient');
				statements.push(db.prepare('INSERT INTO push_rule_recipient VALUES (?,?)').bind('legacy-rule', address));
			}
	}
	try {
		await db.batch(statements);
	} catch (err) {
		// A concurrent initializer can win the marker race. Never treat a partial migration as success.
		const table = await db.prepare("SELECT name FROM sqlite_master WHERE name='app_migration'").first();
		if (table && (await db.prepare("SELECT version FROM app_migration WHERE version='v3.4'").first())) return;
		throw new Error('Push migration failed and rolled back; inspect D1 schema and legacy settings, then retry initialization');
	}
}
