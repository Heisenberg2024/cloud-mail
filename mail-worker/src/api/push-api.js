import app from '../hono/hono';
import result from '../model/result';
import pushService from '../service/push-service';
import pushRouterService from '../service/push-router-service';
import mailboxLoginService from '../service/mailbox-login-service';

app.get('/push/destinations', async (c) => c.json(result.ok(await pushService.destinations(c))));
app.post('/push/destinations', async (c) => c.json(result.ok(await pushService.saveDestination(c, await c.req.json()))));
app.delete('/push/destinations/:id', async (c) => {
	await pushService.deleteDestination(c, c.req.param('id'));
	return c.json(result.ok());
});
app.post('/push/destinations/:id/test', async (c) => c.json(result.ok(await pushRouterService.test(c, c.req.param('id')))));
app.get('/push/rules', async (c) => c.json(result.ok(await pushService.rules(c))));
app.post('/push/rules', async (c) => c.json(result.ok(await pushService.saveRule(c, await c.req.json()))));
app.delete('/push/rules/:id', async (c) => {
	await pushService.deleteRule(c, c.req.param('id'));
	return c.json(result.ok());
});
app.post('/push/simulate', async (c) => c.json(result.ok(await pushService.simulate(c, (await c.req.json()).recipient))));
app.get('/push/logs', async (c) => c.json(result.ok(await pushService.logs(c))));
app.get('/mailbox-login/accounts', async (c) => c.json(result.ok(await mailboxLoginService.list(c, c.req.query()))));
app.post('/mailbox-login/enable', async (c) => c.json(result.ok(await mailboxLoginService.enable(c, await c.req.json()))));
