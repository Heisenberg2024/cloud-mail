import http from '@/axios';
export const destinations = () => http.get('/push/destinations');
export const saveDestination = (data) => http.post('/push/destinations', data);
export const deleteDestination = (id) =>
	http.delete(`/push/destinations/${encodeURIComponent(id)}`);
export const testDestination = (id) =>
	http.post(`/push/destinations/${encodeURIComponent(id)}/test`);
export const rules = () => http.get('/push/rules');
export const saveRule = (data) => http.post('/push/rules', data);
export const deleteRule = (id) =>
	http.delete(`/push/rules/${encodeURIComponent(id)}`);
export const simulate = (recipient) =>
	http.post('/push/simulate', { recipient });
export const deliveryLogs = () => http.get('/push/logs');
export const mailboxes = (params) =>
	http.get('/mailbox-login/accounts', { params });
export const enableLogin = (data) => http.post('/mailbox-login/enable', data);
