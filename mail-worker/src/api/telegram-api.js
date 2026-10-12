import app from '../hono/hono';
import telegramService from '../service/telegram-service';

app.get('/telegram/getEmail/:token', async (c) => {
	const content = await telegramService.getEmailContent(c, c.req.param());
	c.header('Cache-Control', 'no-store');
	c.header('Referrer-Policy', 'no-referrer');
	c.header('Content-Security-Policy', "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
	return c.html(content)
});

