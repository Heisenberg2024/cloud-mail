import { requireAdmin } from '../security/admin';
import BizError from '../error/biz-error';
import cryptoUtils from '../utils/crypto-utils';
import roleService from './role-service';
import accountService from './account-service';

const mailboxLoginService = {
	async list(c, params = {}) {
		return accountService.adminList(c, params);
	},
	async enable(c, params) {
		requireAdmin(c);
		if (params.enabled !== undefined && typeof params.enabled !== 'boolean') throw new BizError('Invalid enabled state', 400);
		const { password, confirmPassword } = params;
		if (typeof password !== 'string' || password.length < 8 || password.length > 128 || password !== confirmPassword) {
			throw new BizError('Password must be 8–128 characters and match / 密码须为 8–128 位且确认一致', 400);
		}
		const accountId = Number(params.accountId),
			roleId = Number(params.roleId);
		if (!Number.isSafeInteger(accountId) || accountId < 1 || !Number.isSafeInteger(roleId))
			throw new BizError('Invalid account or role', 400);
		const role = await roleService.selectById(c, roleId);
		const row = await c.env.db
			.prepare(
				`SELECT a.*,u.email AS owner_email,u.is_del AS owner_deleted FROM account a JOIN user u ON u.user_id=a.user_id WHERE a.account_id=?`,
			)
			.bind(accountId)
			.first();
		if (!row || row.is_del || row.owner_deleted) throw new BizError('Mailbox not available / 邮箱不存在或已删除', 404);
		if (
			row.email.toLowerCase() === row.owner_email.toLowerCase() ||
			(await c.env.db.prepare('SELECT user_id FROM user WHERE email=? COLLATE NOCASE').bind(row.email).first())
		) {
			throw new BizError('Independent login already exists (including deleted users) / 已开通或存在已删除用户', 409);
		}
		if (!role || !roleService.hasAvailDomainPerm(role.availDomain, row.email))
			throw new BizError('Role cannot use this mailbox domain / 角色不可使用此域名', 400);
		const { salt, hash } = await cryptoUtils.hashPassword(password);
		const nonce = crypto.randomUUID();
		const db = c.env.db;
		try {
			await db.batch([
				// NOT NULL and unique constraints turn stale/concurrent eligibility into a rollback.
				db
					.prepare(
						`INSERT INTO mailbox_login_upgrade(account_id,source_user_id,nonce) VALUES (?,
				 (SELECT a.user_id FROM account a JOIN user u ON u.user_id=a.user_id WHERE a.account_id=? AND a.user_id=? AND a.is_del=0 AND u.is_del=0
				 AND a.email<>u.email COLLATE NOCASE AND EXISTS(SELECT 1 FROM role WHERE role_id=?)
				 AND NOT EXISTS(SELECT 1 FROM user WHERE email=a.email COLLATE NOCASE)),?)`,
					)
					.bind(accountId, accountId, row.user_id, roleId, nonce),
				db
					.prepare('INSERT INTO user(email,type,password,salt,status) SELECT email,?,?,?,? FROM account WHERE account_id=?')
					.bind(roleId, hash, salt, params.enabled === false ? 1 : 0, accountId),
				db
					.prepare(
						'UPDATE account SET user_id=(SELECT user_id FROM user WHERE email=account.email COLLATE NOCASE),all_receive=0 WHERE account_id=?',
					)
					.bind(accountId),
				db
					.prepare('UPDATE email SET user_id=(SELECT user_id FROM account WHERE account_id=?) WHERE account_id=?')
					.bind(accountId, accountId),
				db
					.prepare(
						'UPDATE attachments SET user_id=(SELECT user_id FROM account WHERE account_id=?) WHERE account_id=? OR email_id IN (SELECT email_id FROM email WHERE account_id=?)',
					)
					.bind(accountId, accountId, accountId),
				db
					.prepare(
						'UPDATE star SET user_id=(SELECT user_id FROM account WHERE account_id=?) WHERE email_id IN (SELECT email_id FROM email WHERE account_id=?)',
					)
					.bind(accountId, accountId),
			]);
		} catch {
			throw new BizError('Upgrade failed or conflicted; transaction rolled back / 升级失败或并发冲突，事务已回滚', 409);
		}
		return db.prepare('SELECT account_id AS accountId,user_id AS userId,email FROM account WHERE account_id=?').bind(accountId).first();
	},
};
export default mailboxLoginService;
