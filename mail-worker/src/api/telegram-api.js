import app from '../hono/hono';
import telegramService from '../service/telegram-service';
import { STATIC_VIEW_CSP } from '../template/telegram-view';

app.get('/telegram/getEmail/:token', async (c) => {
	const content = await telegramService.getEmailContent(c, c.req.param());
	c.header('Cache-Control', 'no-store');
	c.header('Referrer-Policy', 'no-referrer');
	c.header('Content-Security-Policy', c.get('telegramViewPolicy') || STATIC_VIEW_CSP);
	return c.html(content)
});

