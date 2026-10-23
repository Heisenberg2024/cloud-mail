import { env, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import { upgradeV34 } from '../src/init/upgrade-v34';
import cryptoUtils from '../src/utils/crypto-utils';
import jwtUtils from '../src/utils/jwt-utils';
import mailboxLoginService from '../src/service/mailbox-login-service';
import accountService from '../src/service/account-service';
import loginService from '../src/service/login-service';
import userService from '../src/service/user-service';
import emailService from '../src/service/email-service';
import pushService from '../src/service/push-service';
import pushRouterService from '../src/service/push-router-service';
import telegramService from '../src/service/telegram-service';
import attService from '../src/service/att-service';
import r2Service from '../src/service/r2-service';
import settingService from '../src/service/setting-service';
import starService from '../src/service/star-service';
import KvConst from '../src/const/kv-const';
import { email as receiveEvent } from '../src/email/email';
import { normalizeEmail, validateDestination, validateWebhookUrl, isPublicIp } from '../src/service/push-validation';

function context(user = { userId: 1, email: env.admin, isDel: 0, status: 0 }) {
	const state = new Map([['user', user]]);
	return {
		env,
		get: (k) => state.get(k),
		set: (k, v) => state.set(k, v),
		req: { param: () => env.jwt_secret, header: () => undefined },
		text: (v) => v,
	};
}
const sql = async (query, ...params) =>
	env.db
		.prepare(query)
		.bind(...params)
		.all();
const first = async (query, ...params) =>
	env.db
		.prepare(query)
		.bind(...params)
		.first();
let c, a, b, d;
const password = 'test-password-123';
const tgConfig = (token) => ({
	token,
	chatIds: ['123456'],
	from: 'show',
	to: 'show',
	text: 'show',
	customDomain: 'https://mail.example.com',
});
const tg1 = '123456:abcdefghijklmnopqrstuvwxyz12345',
	tg2 = '654321:zyxwvutsrqponmlkjihgfedcba12345';
const upgrade = () =>
	mailboxLoginService.enable(c, { accountId: a.accountId, roleId: 1, password, confirmPassword: password, enabled: true });
async function addTarget(id, type = 'telegram', config = tgConfig(tg1), enabled = true) {
	await pushService.saveDestination(c, { name: id, type, config, enabled });
	const row = await first('SELECT id FROM push_destination WHERE name=?', id);
	return row.id;
}
async function addRule(name, accountIds, destinationIds, enabled = true, mode = 'selected') {
	return pushService.saveRule(c, { name, accountIds, destinationIds, enabled, recipient_mode: mode });
}
function message(to = 'a@example.com', from = 'sender@outside.org', displayTo = 'spoof@example.net') {
	const raw = `From: Sender <${from}>\r\nTo: ${displayTo}\r\nSubject: Hello\r\nMessage-ID: <test@outside.org>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello world`;
	return { to, from, raw: new Blob([raw]).stream(), forward: vi.fn(async () => {}), setReject: vi.fn() };
}
async function mockNetwork(failTelegram = false, failWebhook = false) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
		url = String(url);
		if (url.startsWith('https://cloudflare-dns.com')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
		if (url.startsWith('https://api.telegram.org')) return Response.json({ ok: !failTelegram }, { status: failTelegram ? 401 : 200 });
		if (url.startsWith('https://notify.example.net')) return new Response('', { status: failWebhook ? 503 : 200 });
		throw new Error('Unexpected external request blocked');
	});
}
beforeAll(async () => {
	await dbInit.init(context());
});
beforeEach(async () => {
	c = context();
	const { salt, hash } = await cryptoUtils.hashPassword(password);
	await sql('INSERT INTO user(user_id,email,password,salt,type) VALUES (1,?,?,?,1)', env.admin, hash, salt);
	await sql('INSERT INTO account(account_id,email,user_id,name) VALUES (1,?,1,?)', env.admin, 'admin');
	a = await accountService.add(c, { email: 'a@example.com' }, 1);
	b = await accountService.add(c, { email: 'b@example.com' }, 1);
	d = await accountService.add(c, { email: 'c@example.com' }, 1);
	await sql(
		'INSERT INTO email(email_id,account_id,user_id,type,status,subject) VALUES (10,?,1,0,0,?), (11,?,1,1,1,?), (12,?,1,0,0,?)',
		a.accountId,
		'Received',
		a.accountId,
		'Sent',
		b.accountId,
		'Other',
	);
	await sql(
		'INSERT INTO attachments(att_id,account_id,user_id,email_id,key) VALUES (1,?,1,10,?), (2,?,1,11,?), (3,?,1,12,?)',
		a.accountId,
		'attachments/original-receive',
		a.accountId,
		'attachments/original-send',
		b.accountId,
		'attachments/other',
	);
	await sql('INSERT INTO star(user_id,email_id) VALUES (1,10),(1,12)');
});
afterEach(() => vi.restoreAllMocks());

describe('Telegram in-app mail viewing', () => {
	let sent;
	beforeEach(() => {
		sent = [];
		fetchMock.activate();
		fetchMock.disableNetConnect();
		fetchMock.get('https://api.telegram.org')
			.intercept({ method: 'POST', path: `/bot${tg1}/sendMessage` })
			.reply(({ body }) => {
				sent.push(JSON.parse(body));
				return { statusCode: 200, data: JSON.stringify({ ok: true }) };
			});
	});
	afterEach(() => {
		try { fetchMock.assertNoPendingInterceptors(); }
		finally { fetchMock.deactivate(); }
	});
	async function deliver(config = {}) {
		const id = await addTarget('Mail view', 'telegram', { ...tgConfig(tg1), customDomain: '', ...config });
		const destination = await first('SELECT * FROM push_destination WHERE id=?', id);
		destination.config = JSON.parse(destination.config);
		await sql('UPDATE email SET text=? WHERE email_id=10', 'Original mail body');
		const result = await pushRouterService.deliver(c, {
			emailId: 10, accountId: a.accountId, userId: 1, subject: 'Received', text: 'Original mail body', code: '123456',
		}, destination);
		expect(result).toMatchObject({ status: 'success', error: '' });
		return { id, keyboard: sent[0].reply_markup?.inline_keyboard || [] };
	}
	it('restores the Web App button from the original site and opens the scoped email without login', async () => {
		await settingService.set(c, { customDomain: 'original.example.com/' });
		const { id, keyboard } = await deliver();
		const button = keyboard.flat().find(button => button.web_app);
		expect(button).toBeDefined();
		const url = new URL(button.web_app.url);
		expect(url.origin).toBe('https://original.example.com');
		expect(url.pathname).toMatch(/^\/api\/telegram\/getEmail\//);
		const token = url.pathname.split('/').pop();
		const payload = await jwtUtils.verifyToken(c, token);
		expect(payload).toMatchObject({ purpose: 'mail-view', emailId: 10, accountId: a.accountId, userId: 1, destinationId: id });
		expect(payload.exp - payload.iat).toBe(900);
		const response = await worker.fetch(new Request(url), env, {});
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('Original mail body');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
		expect(keyboard.flat()).toContainEqual({ text: '123456', copy_text: { text: '123456' } });
	});
	it('prefers the destination site over the original global setting', async () => {
		await settingService.set(c, { customDomain: 'original.example.com' });
		const { keyboard } = await deliver({ customDomain: 'https://target.example.com/' });
		const button = keyboard.flat().find(button => button.web_app);
		expect(new URL(button.web_app.url).origin).toBe('https://target.example.com');
	});
	it.each(['', 'http://invalid.example.com'])('keeps notification and code copying usable without a valid fallback site (%s)', async (customDomain) => {
		await settingService.set(c, { customDomain });
		const { keyboard } = await deliver();
		expect(keyboard).toEqual([[{ text: '123456', copy_text: { text: '123456' } }]]);
	});
	it('respects an explicitly disabled view button while preserving code copying', async () => {
		await settingService.set(c, { customDomain: 'original.example.com' });
		const { keyboard } = await deliver({ customDomain: 'https://target.example.com', viewLink: false });
		expect(keyboard).toEqual([[{ text: '123456', copy_text: { text: '123456' } }]]);
	});
});

describe('Mailbox independent login and D1 ownership', () => {
	it('keeps attached mailboxes without login credentials', async () => {
		expect(await first('SELECT user_id FROM user WHERE email=?', a.email)).toBeNull();
		await expect(loginService.login(c, { email: a.email, password })).rejects.toThrow();
		expect(a.userId).toBe(1);
	});
	it('atomically transfers received/sent mail, attachments and stars while retaining identities', async () => {
		const result = await upgrade();
		expect(result.accountId).toBe(a.accountId);
		expect(result.email).toBe(a.email);
		expect(result.userId).not.toBe(1);
		expect((await sql('SELECT email_id,user_id FROM email WHERE account_id=?', a.accountId)).results).toEqual([
			{ email_id: 10, user_id: result.userId },
			{ email_id: 11, user_id: result.userId },
		]);
		const atts = (await sql('SELECT key,user_id FROM attachments WHERE account_id=?', a.accountId)).results;
		expect(atts.map((a) => a.key)).toEqual(['attachments/original-receive', 'attachments/original-send']);
		expect(atts.every((a) => a.user_id === result.userId)).toBe(true);
		expect((await first('SELECT user_id FROM star WHERE email_id=10')).user_id).toBe(result.userId);
		expect((await first('SELECT user_id FROM email WHERE email_id=12')).user_id).toBe(1);
		const token = await loginService.login(context(), { email: 'A@EXAMPLE.COM', password });
		expect((await jwtUtils.verifyToken(c, token)).userId).toBe(result.userId);
		const userContext = context({ email: a.email, userId: result.userId, isDel: 0, status: 0 });
		expect((await accountService.list(userContext, { size: 30 }, result.userId)).map((a) => a.accountId)).toEqual([a.accountId]);
		await expect(emailService.list(userContext, { accountId: b.accountId, size: 30, allReceive: 0 }, result.userId)).rejects.toThrow();
	});
	it('rejects repeat upgrades, main account upgrades and deleted login collisions', async () => {
		await upgrade();
		await expect(upgrade()).rejects.toThrow('already exists');
		await expect(mailboxLoginService.enable(c, { accountId: 1, roleId: 1, password, confirmPassword: password })).rejects.toThrow(
			'already exists',
		);
		await sql('INSERT INTO user(email,password,salt,is_del) VALUES (?, ?, ?,1)', b.email, 'x', 'x');
		await expect(mailboxLoginService.enable(c, { accountId: b.accountId, roleId: 1, password, confirmPassword: password })).rejects.toThrow(
			'already exists',
		);
	});
	it('rolls back all changes if attachment migration fails', async () => {
		await sql("CREATE TRIGGER fail_upgrade BEFORE UPDATE ON attachments BEGIN SELECT RAISE(ABORT,'injected'); END");
		await expect(upgrade()).rejects.toThrow('rolled back');
		expect(await first('SELECT user_id FROM user WHERE email=?', a.email)).toBeNull();
		expect((await first('SELECT user_id FROM account WHERE account_id=?', a.accountId)).user_id).toBe(1);
		expect(await first('SELECT * FROM mailbox_login_upgrade')).toBeNull();
	});
	it('allows only one winner for simultaneous requests', async () => {
		const results = await Promise.allSettled([upgrade(), upgrade()]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect((await first('SELECT count(*) AS n FROM user WHERE email=?', a.email)).n).toBe(1);
	});
	it('rejects ordinary users and invalid passwords/roles', async () => {
		await expect(
			mailboxLoginService.enable(context({ email: 'other@example.com', userId: 99 }), {
				accountId: a.accountId,
				password,
				confirmPassword: password,
				roleId: 1,
			}),
		).rejects.toThrow('Administrator');
		await expect(
			mailboxLoginService.enable(c, { accountId: a.accountId, password: 'short', confirmPassword: 'short', roleId: 1 }),
		).rejects.toThrow('Password');
		await expect(
			mailboxLoginService.enable(c, { accountId: a.accountId, password, confirmPassword: password, roleId: 999 }),
		).rejects.toThrow('Role');
	});
	it('disabling and password reset invalidate old passwords and already-issued tokens', async () => {
		const result = await upgrade();
		const token = await loginService.login(context(), { email: a.email, password });
		const req = () =>
			worker.fetch(new Request('https://mail.example.com/api/my/loginUserInfo', { headers: { Authorization: token } }), env, {});
		expect((await (await req()).json()).code).toBe(200);
		await userService.setStatus(c, { userId: result.userId, status: 1 });
		expect((await (await req()).json()).code).toBe(401);
		await expect(loginService.login(context(), { email: a.email, password })).rejects.toThrow();
		expect((await first('SELECT count(*) AS n FROM email WHERE account_id=?', a.accountId)).n).toBe(2);
		await userService.setStatus(c, { userId: result.userId, status: 0 });
		const second = await loginService.login(context(), { email: a.email, password });
		await userService.setPwd(c, { userId: result.userId, password: 'replacement-password' });
		await expect(loginService.login(context(), { email: a.email, password })).rejects.toThrow();
		expect(
			(
				await (
					await worker.fetch(new Request('https://mail.example.com/api/my/loginUserInfo', { headers: { Authorization: second } }), env, {})
				).json()
			).code,
		).toBe(401);
		expect(await loginService.login(context(), { email: a.email, password: 'replacement-password' })).toBeTruthy();
	});
	it('rejects stale KV sessions after role changes and protects the administrator', async () => {
		const user = await upgrade();
		const token = await loginService.login(context(), { email: a.email, password });
		const oldAuth = await env.kv.get(KvConst.AUTH_INFO + user.userId);
		await userService.setType(c, { userId: user.userId, type: 1 });
		await env.kv.put(KvConst.AUTH_INFO + user.userId, oldAuth);
		const response = await worker.fetch(
			new Request('https://mail.example.com/api/my/loginUserInfo', { headers: { Authorization: token } }),
			env,
			{},
		);
		expect((await response.json()).code).toBe(401);
		await expect(userService.setStatus(c, { userId: 1, status: 1 })).rejects.toThrow();
		await expect(userService.setType(c, { userId: 1, type: 1 })).rejects.toThrow();
		await expect(
			userService.setPwd(context({ email: a.email, userId: user.userId }), { userId: 1, password: 'unauthorized-password' }),
		).rejects.toThrow();
	});
	it('never returns a stale star belonging to another email owner', async () => {
		const user = await upgrade();
		await sql('INSERT INTO star(user_id,email_id) VALUES (1,10)');
		expect((await starService.list(c, { size: 30 }, 1)).list.map((e) => e.emailId)).toEqual([12]);
		expect((await starService.list(c, { size: 30 }, user.userId)).list.map((e) => e.emailId)).toEqual([10]);
	});
	it('receives new mail after transfer using envelope rather than spoofed To header', async () => {
		const result = await upgrade();
		const msg = message(' A+TAG@EXAMPLE.COM ', 'sender@outside.org', b.email);
		await receiveEvent(msg, env, {});
		const row = await first('SELECT * FROM email ORDER BY email_id DESC LIMIT 1');
		expect(row.account_id).toBe(a.accountId);
		expect(row.user_id).toBe(result.userId);
		expect(row.to_email).toBe('a+tag@example.com');
		expect(msg.setReject).not.toHaveBeenCalled();
	});
	it('resolves ownership at insertion even for stale receive and attachment snapshots', async () => {
		const result = await upgrade();
		const row = await emailService.receive(
			c,
			{ accountId: a.accountId, userId: 1, subject: 'In flight', recipient: '[]', status: 0, isDel: 0 },
			[],
			'',
		);
		expect(row.userId).toBe(result.userId);
		vi.spyOn(r2Service, 'putObj').mockResolvedValue(undefined);
		await attService.addAtt(c, [
			{
				userId: 1,
				accountId: a.accountId,
				emailId: row.emailId,
				key: 'attachments/in-flight',
				content: new Uint8Array([1]),
				filename: 'x',
				mimeType: 'text/plain',
			},
		]);
		expect((await first('SELECT user_id FROM attachments WHERE key=?', 'attachments/in-flight')).user_id).toBe(result.userId);
	});
	it('retains in-flight send history under the current mailbox owner', async () => {
		await sql('UPDATE setting SET send=0');
		await settingService.refresh(c);
		c.env = { ...env, email: { send: () => {} } };
		let newOwner;
		vi.spyOn(emailService, 'sendByCloudflareEmail').mockImplementation(async () => {
			newOwner = await upgrade();
			return { data: { id: 'mock-send' } };
		});
		const result = await emailService.send(
			c,
			{
				accountId: a.accountId,
				name: 'A',
				sendType: 'new',
				receiveEmail: ['external@outside.org'],
				subject: 'In flight',
				text: 'hello',
				content: '<p>hello</p>',
			},
			1,
		);
		expect(result[0].userId).toBe(newOwner.userId);
		expect(result[0].accountId).toBe(a.accountId);
	});
	it('rejects deleted mailboxes and enforces blacklist and suspended reception', async () => {
		await sql('UPDATE account SET is_del=1 WHERE account_id=?', a.accountId);
		let msg = message();
		await receiveEvent(msg, env, {});
		expect(msg.setReject).toHaveBeenCalled();
		await sql('UPDATE account SET is_del=0 WHERE account_id=?', a.accountId);
		await sql("UPDATE setting SET black_from='sender@outside.org'");
		await (await import('../src/service/setting-service')).default.refresh(context());
		msg = message();
		await receiveEvent(msg, env, {});
		expect(msg.setReject).toHaveBeenCalledWith('Message rejected');
		await sql('UPDATE setting SET receive=1');
		await (await import('../src/service/setting-service')).default.refresh(context());
		msg = message();
		await receiveEvent(msg, env, {});
		expect(msg.setReject).toHaveBeenCalledWith('Service suspended');
	});
});

describe('Administrator mailbox view and ownership boundaries', () => {
	async function api(token, path, method = 'GET', body) {
		return (await worker.fetch(new Request('https://mail.example.com/api/' + path, {
			method, headers: { Authorization: token, 'Content-Type': 'application/json' },
			...(body ? {body: JSON.stringify(body)} : {}),
		}), env, {})).json();
	}
	it('keeps own mailboxes separate while all mailboxes follows an upgraded owner', async () => {
		const owner = await upgrade();
		const own = await accountService.list(c, {size: 30}, 1);
		expect(own.map(row => row.accountId)).toEqual([1, b.accountId, d.accountId]);
		const all = await accountService.adminList(c);
		expect(all.total).toBe(4);
		expect(all.list.find(row => row.accountId === a.accountId)).toMatchObject({email: a.email, userId: owner.userId, ownerEmail: a.email, independent: 1, userStatus: 0, accountStatus: 0});
		expect(all.list.find(row => row.accountId === b.accountId)).toMatchObject({ownerEmail: env.admin, independent: 0});
		expect(all.list.find(row => row.accountId === 1).isAdmin).toBe(1);
		expect(await mailboxLoginService.list(c)).toEqual(all);
	});
	it('searches owners and mailbox addresses with stable pages and excludes deleted owners/mailboxes', async () => {
		const owner = await upgrade();
		await sql('UPDATE user SET status=1 WHERE user_id=?', owner.userId);
		expect((await accountService.adminList(c, {search: 'A@EXAMPLE.COM'})).list[0].userStatus).toBe(1);
		expect((await accountService.adminList(c, {search: env.admin})).total).toBe(3);
		const pages = await Promise.all([1, 2, 3, 4].map(page => accountService.adminList(c, {page, size: 1})));
		expect(pages.map(page => page.list[0].accountId)).toEqual([d.accountId, b.accountId, a.accountId, 1]);
		await sql('UPDATE account SET is_del=1 WHERE account_id=?', b.accountId);
		await sql('UPDATE user SET is_del=1 WHERE user_id=?', owner.userId);
		expect((await accountService.adminList(c)).total).toBe(2);
		await expect(emailService.allList(c, {accountId: a.accountId})).rejects.toMatchObject({code: 404});
	});
	it('uses exact account IDs for lists, counts, both cursor directions and refresh despite misleading addresses', async () => {
		const owner = await upgrade();
		await sql("UPDATE email SET to_email='a@example.com',send_email='a@example.com',text='historical body',content='<p>historical body</p>'");
		await sql("INSERT INTO email(email_id,account_id,user_id,type,status,subject,to_email) VALUES (20,?,?,0,0,'Received newer','a+tag@example.com'),(21,?,1,0,0,'Received other','a@example.com'),(22,?,?,0,0,'Deleted','a@example.com'),(23,?,?,0,6,'Saving','a@example.com')",
			a.accountId, owner.userId, b.accountId, a.accountId, owner.userId, a.accountId, owner.userId);
		await sql('UPDATE email SET is_del=1 WHERE email_id=22');
		const query = {accountId: a.accountId, type: 'receive', size: 1, full: 0, subject: 'Received'};
		const page = await emailService.allList(c, query);
		expect(page.list.map(row => row.emailId)).toEqual([20]);
		expect(page.total).toBe(2);
		expect(page.latestEmail).toMatchObject({emailId: 20, accountId: a.accountId, userId: owner.userId});
		expect((await emailService.allList(c, {...query, emailId: 20})).list.map(row => row.emailId)).toEqual([10]);
		expect((await emailService.allList(c, {...query, timeSort: 1, emailId: 10})).list.map(row => row.emailId)).toEqual([20]);
		expect((await emailService.allEmailLatest(c, {...query, emailId: 10})).map(row => row.emailId)).toEqual([20]);
		expect((await emailService.allEmailLatest(c, {...query, subject: 'No match', emailId: 0}))).toEqual([]);
		expect((await emailService.allList(c, {...query, subject: 'No match'})).latestEmail.emailId).toBe(0);
		const sent = await emailService.allList(c, {accountId: a.accountId, type: 'send', full: 1});
		expect(sent.total).toBe(1);
		expect(sent.list[0]).toMatchObject({emailId: 11, userId: owner.userId, text: 'historical body'});
		expect(sent.list[0].attList.map(att => att.key)).toEqual(['attachments/original-send']);
	});
	it('loads received and sent detail and attachments without modifying any owned data or forwarding associations', async () => {
		const target = await addTarget('Mailbox target');
		await addRule('Mailbox rule', [a.accountId], [target]);
		await upgrade();
		await sql("UPDATE email SET text='Historical body',content='<p>Historical body</p>' WHERE account_id=?", a.accountId);
		const snapshot = async () => Promise.all(['account', 'user', 'email', 'attachments', 'star', 'push_rule_account', 'mailbox_login_upgrade'].map(table => sql(`SELECT * FROM ${table}`)));
		const before = await snapshot();
		for (const emailId of [10, 11]) {
			const detail = await emailService.adminDetail(c, {accountId: a.accountId, emailId});
			expect(detail.text).toBe('Historical body');
			expect(detail.attList).toHaveLength(1);
			expect(detail.attList[0].emailId).toBe(emailId);
		}
		await emailService.allList(c, {accountId: a.accountId, type: 'all', full: 1});
		await emailService.allEmailLatest(c, {accountId: a.accountId, emailId: 0});
		await accountService.adminList(c, {accountId: a.accountId});
		expect(await snapshot()).toEqual(before);
		await expect(emailService.adminDetail(c, {accountId: b.accountId, emailId: 10})).rejects.toMatchObject({code: 404});
		await expect(emailService.adminDetail(c, {accountId: a.accountId, emailId: 12})).rejects.toMatchObject({code: 404});
	});
	it.each(['', '0', '-1', 'abc', '1.5', '9007199254740992'])('rejects invalid accountId=%s instead of falling back to all mail', async accountId => {
		await expect(emailService.allList(c, {accountId})).rejects.toMatchObject({code: 400});
		await expect(emailService.allEmailLatest(c, {accountId})).rejects.toMatchObject({code: 400});
		await expect(emailService.adminDetail(c, {accountId, emailId: 10})).rejects.toMatchObject({code: 400});
	});
	it('returns 403 for every admin mail API even when an ordinary role has legacy all-mail permissions', async () => {
		await upgrade();
		await sql("INSERT INTO role_perm(role_id,perm_id) SELECT 1,perm_id FROM perm WHERE perm_key IN ('all-email:query','all-email:delete') AND perm_id NOT IN (SELECT perm_id FROM role_perm WHERE role_id=1)");
		const token = await loginService.login(context(), {email: a.email, password});
		for (const [path, method] of [
			['account/all?accountId=1&userId=1', 'GET'], ['mailbox-login/accounts', 'GET'],
			['allEmail/list?accountId=1', 'GET'], ['allEmail/list', 'GET'],
			['allEmail/latest?emailId=0&accountId=1', 'GET'], ['allEmail/detail?emailId=12&accountId=1', 'GET'],
			['allEmail/delete?emailIds=12', 'DELETE'], ['allEmail/batchDelete?subject=Other&type=eq', 'DELETE'],
		]) expect((await api(token, path, method)).code).toBe(403);
		expect(await first('SELECT email_id FROM email WHERE email_id=12')).toBeTruthy();
	});
	it('keeps ordinary APIs scoped to the login user and prevents administrator impersonation when sending', async () => {
		const owner = await upgrade();
		const adminToken = await loginService.login(context(), {email: env.admin, password});
		const userToken = await loginService.login(context(), {email: a.email, password});
		expect((await api(adminToken, 'account/all')).data.total).toBe(4);
		expect((await api(adminToken, `allEmail/list?accountId=${a.accountId}&type=receive`)).data.list.map(e => e.emailId)).toEqual([10]);
		expect((await api(adminToken, `allEmail/detail?accountId=${a.accountId}&emailId=10`)).data.attList).toHaveLength(1);
		expect((await api(userToken, 'account/list?size=30&userId=1&view=all')).data.map(row => row.accountId)).toEqual([a.accountId]);
		for (const token of [adminToken, userToken]) {
			const otherId = token === adminToken ? a.accountId : b.accountId;
			expect((await api(token, `email/list?accountId=${otherId}&size=30&allReceive=1&userId=${owner.userId}`)).code).toBe(403);
			expect((await api(token, `email/latest?accountId=${otherId}&emailId=0&allReceive=1`)).code).toBe(403);
			expect((await api(token, 'email/send', 'POST', {accountId: otherId})).code).toBe(403);
		}
		const before = await first('SELECT unread,user_id FROM email WHERE email_id=10');
		await api(adminToken, 'email/read', 'PUT', {emailIds: [10]});
		expect(await first('SELECT unread,user_id FROM email WHERE email_id=10')).toEqual(before);
		expect((await api(adminToken, 'email/attList?emailId=10')).data).toEqual([]);
		expect((await api(userToken, `email/list?accountId=${a.accountId}&size=30&allReceive=1`)).data.list.map(e => e.emailId)).toEqual([10]);
	});
});

describe('Destination/rule matching and delivery', () => {
	it('supports A → Bot 1; B,C → Bot 2 with separate tokens and no cross delivery', async () => {
		const one = await addTarget('Bot 1'),
			two = await addTarget('Bot 2', 'telegram', tgConfig(tg2));
		await addRule('A', [a.accountId], [one]);
		await addRule('BC', [b.accountId, d.accountId], [two]);
		for (const [recipient, target] of [
			[a.email, one],
			[b.email, two],
			[d.email, two],
		])
			expect((await pushService.resolve(c, recipient)).destinations.map((d) => d.id)).toEqual([target]);
		const network = await mockNetwork();
		await pushRouterService.route(c, { emailId: 10, accountId: a.accountId, userId: 1, toEmail: a.email, subject: 'hello' }, message());
		const calls = network.mock.calls.filter(([url]) => String(url).includes('/sendMessage'));
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toContain(tg1);
		expect(calls[0][0]).not.toContain(tg2);
	});
	it('routes the real receive event only once after legacy migration', async () => {
		await sql("DELETE FROM app_migration WHERE version='v3.4'");
		await sql("UPDATE setting SET tg_bot_token=?,tg_chat_id='123456',tg_bot_status=0", tg1);
		await settingService.refresh(c);
		const network = await mockNetwork();
		const msg = message(a.email, 'sender@outside.org', b.email);
		await receiveEvent(msg, env, {});
		expect(network.mock.calls.filter(([url]) => String(url).includes('/sendMessage'))).toHaveLength(1);
		expect((await first('SELECT count(*) AS n FROM push_delivery_log')).n).toBe(1);
	});
	it('keeps normal receiving alive and reports invalid legacy migration explicitly', async () => {
		await sql("DELETE FROM app_migration WHERE version='v3.4'");
		await sql("UPDATE setting SET webhook_url='http://localhost',webhook_status=0");
		await settingService.refresh(c);
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
		const msg = message();
		await receiveEvent(msg, env, {});
		expect((await first('SELECT count(*) AS n FROM email')).n).toBe(4);
		expect(msg.setReject).not.toHaveBeenCalled();
		expect(errorLog).toHaveBeenCalled();
		await expect(pushService.destinations(c)).rejects.toThrow('invalid webhook');
	});
	it('adds overlapping rules, deduplicates shared targets and supports multiple channels', async () => {
		const one = await addTarget('Bot'),
			hook = await addTarget('Hook', 'webhook', { url: 'https://notify.example.net/hook', secret: 'secret', retry: 1, timeout: 1000 }),
			mail = await addTarget('Email', 'email', { recipients: ['staff@gmail.com', 'STAFF@gmail.com', 'other@outlook.com'] });
		await addRule('A', [a.accountId], [one, hook, mail]);
		await addRule('AB', [a.accountId, b.accountId], [one]);
		await addRule('AC', [a.accountId, d.accountId], [hook]);
		const result = await pushService.resolve(c, a.email);
		expect(result.rules).toHaveLength(3);
		expect(result.destinations).toHaveLength(3);
		expect(result.destinations.find((d) => d.id === one).ruleIds).toHaveLength(2);
		await mockNetwork();
		const msg = message();
		await pushRouterService.route(c, { emailId: 10, accountId: a.accountId, userId: 1, toEmail: a.email, subject: 'hello' }, msg);
		expect(msg.forward).toHaveBeenCalledTimes(2);
		expect((await sql('SELECT status FROM push_delivery_log')).results.every((r) => r.status === 'success')).toBe(true);
	});
	it('disabled rules and destinations stop only their own deliveries', async () => {
		const one = await addTarget('Bot'),
			two = await addTarget('Bot 2', 'telegram', tgConfig(tg2), false);
		const r = await addRule('A', [a.accountId], [one, two]);
		expect((await pushService.resolve(c, a.email)).destinations).toHaveLength(1);
		await sql('UPDATE push_rule SET enabled=0 WHERE id=?', r);
		expect((await pushService.resolve(c, a.email)).destinations).toHaveLength(0);
	});
	it.each([
		[true, false],
		[false, true],
	])('isolates Telegram=%s and Webhook=%s failures', async (tgFail, hookFail) => {
		const one = await addTarget('Bot'),
			hook = await addTarget('Hook', 'webhook', { url: 'https://notify.example.net/hook', retry: 1, timeout: 1000 });
		await addRule('A', [a.accountId], [one, hook]);
		await mockNetwork(tgFail, hookFail);
		await pushRouterService.route(c, { emailId: 10, accountId: a.accountId, userId: 1, toEmail: a.email, subject: 'hello' }, message());
		const logs = (await sql('SELECT type,status,attempts FROM push_delivery_log ORDER BY type')).results;
		expect(logs.find((l) => l.type === 'telegram').status).toBe(tgFail ? 'failed' : 'success');
		expect(logs.find((l) => l.type === 'webhook').status).toBe(hookFail ? 'failed' : 'success');
		expect(logs.find((l) => l.type === 'webhook').attempts).toBe(hookFail ? 2 : 1);
	});
	it('logs partial forwarding failure without losing saved mail', async () => {
		const mail = await addTarget('Mail', 'email', { recipients: ['ok@gmail.com', 'bad@outlook.com'] });
		await addRule('A', [a.accountId], [mail]);
		const msg = message();
		msg.forward.mockImplementation(async (recipient) => {
			if (recipient === 'bad@outlook.com') throw new Error('authentication-secret-do-not-log');
		});
		await pushRouterService.route(c, { emailId: 10 }, msg);
		const log = await first('SELECT * FROM push_delivery_log');
		expect(log.status).toBe('partial');
		expect(log.error).not.toContain('authentication-secret');
		expect(await first('SELECT email_id FROM email WHERE email_id=10')).toBeTruthy();
	});
	it('matches case and +tag semantics with stable account ID after upgrade', async () => {
		const one = await addTarget('Bot');
		await addRule('A', [a.accountId], [one]);
		expect((await pushService.resolve(c, ' A+tag@EXAMPLE.COM ')).destinations).toHaveLength(1);
		await upgrade();
		expect((await pushService.resolve(c, a.email)).destinations).toHaveLength(1);
		expect((await pushService.resolve(c, b.email)).destinations).toHaveLength(0);
	});
	it('keeps identical local parts on different domains separate', async () => {
		await sql("INSERT INTO account(email,user_id,name) VALUES ('a@second.example',1,'second')");
		const other = await first("SELECT account_id FROM account WHERE email='a@second.example'");
		const one = await addTarget('First'),
			two = await addTarget('Second', 'telegram', tgConfig(tg2));
		await addRule('First', [a.accountId], [one]);
		await addRule('Second', [other.account_id], [two]);
		expect((await pushService.resolve(c, 'A@SECOND.EXAMPLE')).destinations.map((d) => d.id)).toEqual([two]);
		expect((await pushService.resolve(c, a.email)).destinations.map((d) => d.id)).toEqual([one]);
	});
	it('prefers a registered +tag account over its base mailbox', async () => {
		const tag = await accountService.add(c, { email: 'a+tag@example.com' }, 1),
			one = await addTarget('Bot');
		await addRule('A', [a.accountId], [one]);
		expect((await pushService.resolve(c, tag.email)).destinations).toHaveLength(0);
		expect((await pushService.resolve(c, 'a+other@example.com')).destinations).toHaveLength(1);
	});
	it('all_registered excludes unknown and deleted recipients, while explicit compatibility includes Catch-all', async () => {
		const one = await addTarget('Bot');
		await addRule('All', [], [one], true, 'all_registered');
		expect((await pushService.resolve(c, 'unknown@example.com')).destinations).toHaveLength(0);
		await addRule('Catch-all', [], [one], true, 'legacy_all');
		expect((await pushService.resolve(c, 'unknown@example.com')).destinations).toHaveLength(1);
		await sql('UPDATE account SET is_del=1 WHERE account_id=?', a.accountId);
		expect((await pushService.resolve(c, a.email)).destinations).toHaveLength(0);
	});
	it('simulation makes no network requests and responses redact credentials', async () => {
		const one = await addTarget('Bot'),
			hook = await addTarget('Hook', 'webhook', { url: 'https://notify.example.net/hook', secret: 'private-secret' });
		await addRule('A', [a.accountId], [one, hook]);
		const network = vi.spyOn(globalThis, 'fetch');
		const result = await pushService.simulate(c, a.email);
		expect(network).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toContain(tg1);
		expect(JSON.stringify(result)).not.toContain('private-secret');
		expect(result.destinations[0].config.token).toBeUndefined();
		const safe = await pushService.destinations(c);
		await pushService.saveDestination(c, {
			...safe.find((d) => d.id === one),
			config: { ...safe.find((d) => d.id === one).config, token: '' },
		});
		expect(JSON.parse((await first('SELECT config FROM push_destination WHERE id=?', one)).config).token).toBe(tg1);
	});
	it('blocks every management endpoint for ordinary users, including tests and logs', async () => {
		const user = await upgrade();
		const token = await loginService.login(context(), { email: a.email, password });
		for (const [method, path, body] of [
			['GET', 'push/destinations'],
			['GET', 'push/rules'],
			['GET', 'push/logs'],
			['GET', 'mailbox-login/accounts'],
			['POST', 'push/simulate', { recipient: a.email }],
			['POST', 'push/destinations/x/test'],
			['POST', 'mailbox-login/enable', { accountId: b.accountId }],
			['GET', 'setting/query'],
		]) {
			const response = await worker.fetch(
				new Request('https://mail.example.com/api/' + path, {
					method,
					headers: { Authorization: token, 'Content-Type': 'application/json' },
					...(body ? { body: JSON.stringify(body) } : {}),
				}),
				env,
				{},
			);
			expect((await response.json()).code).toBe(403);
		}
	});
	it('no rules does not interrupt normal receiving', async () => {
		const msg = message();
		await receiveEvent(msg, env, {});
		expect(msg.setReject).not.toHaveBeenCalled();
		expect((await first('SELECT count(*) AS n FROM email')).n).toBe(4);
		expect(msg.forward).not.toHaveBeenCalled();
	});
	it('uses all Chat IDs, preserves Webhook JSON fields and isolates failures per destination', async () => {
		const bot = await addTarget('Multi-chat', 'telegram', { ...tgConfig(tg1), chatIds: ['11111', '22222'] }),
			hook = await addTarget('Hook', 'webhook', { url: 'https://notify.example.net/hook', secret: 'hook-secret' });
		await addRule('A', [a.accountId], [bot, hook]);
		const network = await mockNetwork();
		await pushRouterService.route(
			c,
			{
				emailId: 10,
				accountId: a.accountId,
				userId: 1,
				sendEmail: 'sender@outside.org',
				name: 'Sender',
				toEmail: a.email,
				toName: 'A',
				subject: 'Hello',
				text: 'Body',
				content: '<p>Body</p>',
				code: '1234',
				createTime: '2026-10-13',
			},
			message(),
		);
		expect(network.mock.calls.filter(([url]) => String(url).includes('/sendMessage'))).toHaveLength(2);
		const request = network.mock.calls.find(([url]) => String(url).startsWith('https://notify.example.net'));
		expect(JSON.parse(request[1].body)).toMatchObject({
			emailId: 10,
			sendEmail: 'sender@outside.org',
			sendName: 'Sender',
			toEmail: a.email,
			toName: 'A',
			subject: 'Hello',
			text: 'Body',
			content: '<p>Body</p>',
			code: '1234',
			createTime: '2026-10-13',
		});
	});
	it('allows secret clearing only explicitly and revalidates before enabling a Telegram target', async () => {
		const bot = await addTarget('Bot'),
			hook = await addTarget('Hook', 'webhook', { url: 'https://notify.example.net/hook', secret: 'secret' });
		const targets = await pushService.destinations(c);
		const b = targets.find((t) => t.id === bot);
		await pushService.saveDestination(c, { ...b, enabled: false, config: { ...b.config, clearToken: true } });
		expect(JSON.parse((await first('SELECT config FROM push_destination WHERE id=?', bot)).config).token).toBe('');
		await expect(pushService.saveDestination(c, { ...b, enabled: true })).rejects.toThrow('token');
		const h = targets.find((t) => t.id === hook);
		await pushService.saveDestination(c, { ...h, config: { ...h.config, clearSecret: true } });
		expect(JSON.parse((await first('SELECT config FROM push_destination WHERE id=?', hook)).config).secret).toBe('');
	});
	it('deleting shared targets cascades associations and reports invalid rules', async () => {
		const bot = await addTarget('Bot');
		await addRule('A', [a.accountId], [bot]);
		await addRule('BC', [b.accountId, d.accountId], [bot]);
		await pushService.deleteDestination(c, bot);
		expect((await first('SELECT count(*) AS n FROM push_rule_destination')).n).toBe(0);
		expect((await pushService.rules(c)).every((r) => !r.valid)).toBe(true);
	});
	it('setting reads do not mutate credentials and normal settings remain editable', async () => {
		await sql('UPDATE setting SET tg_bot_token=?,webhook_secret=?,github_client_secret=?', tg1, 'webhook-secret', 'github-secret');
		await settingService.refresh(c);
		const settings = await settingService.get(c);
		expect(settings.tgBotToken).toBe('******');
		expect(settings.webhookSecret).toBe('******');
		expect(settings.githubClientSecret).toBe('******');
		expect((await settingService.query(c)).tgBotToken).toBe(tg1);
		await settingService.set(c, { receive: 1 });
		expect((await first('SELECT receive FROM setting')).receive).toBe(1);
		await expect(settingService.set(c, { tgBotToken: 'changed' })).rejects.toThrow('Mail Push');
	});
	it('cleans records after 30 days', async () => {
		await sql(
			"INSERT INTO push_delivery_log(recipient,destination_id,type,status,created_at) VALUES ('x','x','email','failed','2000-01-01')",
		);
		await pushService.cleanup(c);
		expect((await first('SELECT count(*) AS n FROM push_delivery_log')).n).toBe(0);
	});
});

describe('Migration, security and compatibility', () => {
	async function resetMigration() {
		await sql("DELETE FROM app_migration WHERE version='v3.4'");
	}
	it('migrates all legacy channels and Catch-all exactly once with disabled status retained', async () => {
		await resetMigration();
		await sql(
			"UPDATE setting SET tg_bot_token=?,tg_chat_id='123456',tg_bot_status=0,forward_email='staff@gmail.com',forward_status=1,webhook_url='https://notify.example.net/hook',webhook_status=0,webhook_secret='old-secret',webhook_retry=5,rule_type=0",
			tg1,
		);
		await upgradeV34(c);
		await upgradeV34(c);
		expect((await first('SELECT count(*) AS n FROM push_destination')).n).toBe(3);
		expect((await first('SELECT enabled FROM push_destination WHERE id=?', 'legacy-email')).enabled).toBe(0);
		expect((await pushService.resolve(c, 'unknown@example.com')).destinations).toHaveLength(2);
		expect((await first('SELECT count(*) AS n FROM push_rule')).n).toBe(1);
	});
	it('preserves legacy selected addresses including unregistered Catch-all recipients', async () => {
		await resetMigration();
		await sql(
			"UPDATE setting SET tg_bot_token=?,tg_chat_id='123456',tg_bot_status=0,rule_type=1,rule_email='a@example.com,unknown@example.com'",
			tg1,
		);
		await upgradeV34(c);
		expect((await pushService.resolve(c, a.email)).destinations).toHaveLength(1);
		expect((await pushService.resolve(c, 'unknown@example.com')).destinations).toHaveLength(1);
		expect((await pushService.resolve(c, b.email)).destinations).toHaveLength(0);
		expect((await pushService.resolve(c, 'a+tag@example.com')).destinations).toHaveLength(0);
	});
	it('migration failure commits neither marker nor partial destinations and can be retried', async () => {
		await resetMigration();
		await sql("UPDATE setting SET tg_bot_token=?,tg_chat_id='123456'", tg1);
		await sql("CREATE TRIGGER fail_migration BEFORE INSERT ON push_destination BEGIN SELECT RAISE(ABORT,'injected'); END");
		await expect(upgradeV34(c)).rejects.toThrow('rolled back');
		expect(await first("SELECT version FROM app_migration WHERE version='v3.4'")).toBeNull();
		expect((await first('SELECT count(*) AS n FROM push_destination')).n).toBe(0);
		await sql('DROP TRIGGER fail_migration');
		await upgradeV34(c);
		expect((await first('SELECT count(*) AS n FROM push_destination')).n).toBe(1);
	});
	it('empty legacy configuration and concurrent migration remain idempotent', async () => {
		await resetMigration();
		await Promise.all([upgradeV34(c), upgradeV34(c)]);
		expect((await first('SELECT count(*) AS n FROM push_destination')).n).toBe(0);
		expect((await first('SELECT count(*) AS n FROM app_migration')).n).toBe(2);
	});
	it('adds session version to an old database without rewriting existing rows', async () => {
		await resetMigration();
		await sql("DELETE FROM app_migration WHERE version='v3.4-schema'");
		await sql('ALTER TABLE user DROP COLUMN session_version');
		await upgradeV34(c);
		expect((await first('SELECT session_version FROM user WHERE user_id=1')).session_version).toBe(0);
		expect((await first('SELECT count(*) AS n FROM email')).n).toBe(3);
	});
	it.each([
		'http://example.com',
		'https://localhost',
		'https://127.0.0.1',
		'https://2130706433',
		'https://[::1]',
		'https://foo.local',
		'https://user:secret@example.com',
		'https://example.com:8080',
	])('rejects unsafe webhook %s', (url) => {
		expect(() => validateWebhookUrl(url)).toThrow();
	});
	it('validates public DNS and never follows redirects or logs remote secrets', async () => {
		const hook = await addTarget('Hook', 'webhook', {
			url: 'https://notify.example.net/hook',
			secret: 'auth-secret',
			retry: 2,
			timeout: 1000,
		});
		await addRule('A', [a.accountId], [hook]);
		let fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ Status: 0, Answer: [{ type: 1, data: '127.0.0.1' }] }));
		await pushRouterService.route(c, { emailId: 10 }, message());
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect((await first('SELECT status FROM push_delivery_log')).status).toBe('failed');
		fetchMock.mockRestore();
		await sql('DELETE FROM push_delivery_log');
		fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(async (url, options) =>
				String(url).includes('cloudflare-dns')
					? Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] })
					: new Response('auth-secret', { status: 302, headers: { Location: 'http://127.0.0.1' } }),
			);
		await pushRouterService.route(c, { emailId: 10 }, message());
		expect(fetchMock.mock.calls.find(([url]) => String(url).includes('notify.'))[1].redirect).toBe('manual');
		expect((await first('SELECT error FROM push_delivery_log')).error).not.toContain('auth-secret');
	});
	it('rejects loops, normalizes addresses and validates special IP ranges', () => {
		expect(() => validateDestination('email', { recipients: ['a@example.com'] }, env)).toThrow('loop');
		expect(normalizeEmail(' A@EXAMPLE.COM ')).toBe('a@example.com');
		for (const invalid of ['not-an-address', 'a..b@example.com', 'a@-example.com', 'a@example..com', 'a@exam_ple.com'])
			expect(normalizeEmail(invalid)).toBe('');
		for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::'])
			expect(isPublicIp(ip)).toBe(false);
		expect(isPublicIp('8.8.8.8')).toBe(true);
	});
	it('signed mail links require purpose, expiry, destination and ownership scope', async () => {
		const target = await addTarget('Bot');
		const payload = { emailId: 10, accountId: a.accountId, userId: 1, destinationId: target, purpose: 'mail-view' };
		const token = await jwtUtils.generateToken(c, payload, 900);
		expect(await telegramService.getEmailContent(c, { token })).not.toContain('Access denied');
		for (const bad of [
			{ ...payload, purpose: 'login' },
			{ ...payload, userId: 999 },
			{ ...payload, accountId: b.accountId },
		])
			expect(await telegramService.getEmailContent(c, { token: await jwtUtils.generateToken(c, bad, 900) })).toContain('Access denied');
		expect(await telegramService.getEmailContent(c, { token: await jwtUtils.generateToken(c, payload) })).toContain('Access denied');
		expect(await telegramService.getEmailContent(c, { token: await jwtUtils.generateToken(c, payload, -1) })).toContain('Access denied');
		const upgraded = await upgrade();
		expect(await telegramService.getEmailContent(c, { token })).toContain('Access denied');
		const newToken = await jwtUtils.generateToken(c, { ...payload, userId: upgraded.userId }, 900);
		expect(await telegramService.getEmailContent(c, { token: newToken })).not.toContain('Access denied');
		await sql('UPDATE user SET is_del=1 WHERE user_id=?', upgraded.userId);
		expect(await telegramService.getEmailContent(c, { token: newToken })).toContain('Access denied');
	});
	it('tests distinguish Bot validity, Chat validity and sending; saving never sends', async () => {
		const network = await mockNetwork();
		const id = await addTarget('Bot');
		expect(network).not.toHaveBeenCalled();
		const outcome = await pushRouterService.test(c, id);
		expect(outcome.tokenValid).toBe(true);
		expect(outcome.chats[0]).toMatchObject({ chatValid: true, sent: true });
		expect(outcome.status).toBe('success');
	});
});
