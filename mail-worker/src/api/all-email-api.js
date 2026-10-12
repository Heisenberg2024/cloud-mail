import app from '../hono/hono';
import emailService from '../service/email-service';
import result from '../model/result';
import { requireAdmin } from '../security/admin';

app.use('/allEmail/*', async (c, next) => {
	// Role permissions alone must never grant access to other users' mail.
	requireAdmin(c);
	return next();
});

app.get('/allEmail/detail', async (c) => c.json(result.ok(await emailService.adminDetail(c, c.req.query()))));

app.get('/allEmail/list', async (c) => {
	const data = await emailService.allList(c, c.req.query());
	return c.json(result.ok(data));
})

app.delete('/allEmail/delete', async (c) => {
	const list = await emailService.physicsDelete(c, c.req.query());
	return c.json(result.ok(list));
})

app.delete('/allEmail/batchDelete', async (c) => {
	await emailService.batchDelete(c, c.req.query());
	return c.json(result.ok());
})

app.get('/allEmail/latest', async (c) => {
	const list = await emailService.allEmailLatest(c, c.req.query());
	return c.json(result.ok(list));
})
