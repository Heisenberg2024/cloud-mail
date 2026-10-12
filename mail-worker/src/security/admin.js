import BizError from '../error/biz-error';

export function requireAdmin(c) {
	const user = c.get('user');
	if (!user || user.isDel || user.status || user.email.toLowerCase() !== String(c.env.admin).toLowerCase()) {
		throw new BizError('Administrator required / 仅限管理员', 403);
	}
	return user;
}
