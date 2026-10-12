<template>
	<div v-loading="loading" class="push-manager">
		<el-alert :title="t('pushRoutingHelp')" type="info" :closable="false" />
		<el-tabs v-model="tab">
			<el-tab-pane :label="t('pushDestinations')" name="destinations">
				<div class="toolbar">
					<el-button type="primary" @click="editDestination()">{{
						t('add')
					}}</el-button
					><el-button @click="load">{{ t('pushRefresh') }}</el-button>
				</div>
				<el-table :data="targets">
					<el-table-column prop="name" :label="t('pushName')" min-width="140" />
					<el-table-column prop="type" :label="t('pushType')" width="110" />
					<el-table-column :label="t('pushSummary')" min-width="210"
						><template #default="{ row }">{{
							summary(row)
						}}</template></el-table-column
					>
					<el-table-column :label="t('tabStatus')" width="110"
						><template #default="{ row }"
							><el-switch
								:model-value="!!row.enabled"
								@change="toggleTarget(row)"
								:disabled="busy" /></template
					></el-table-column>
					<el-table-column :label="t('action')" min-width="230"
						><template #default="{ row }">
							<el-button size="small" @click="editDestination(row)">{{
								t('pushEdit')
							}}</el-button>
							<el-button
								size="small"
								v-if="row.type !== 'email'"
								@click="test(row)"
								:loading="testing === row.id"
								>{{ t('pushTest') }}</el-button
							>
							<el-button
								size="small"
								type="danger"
								@click="removeTarget(row)"
								>{{ t('delete') }}</el-button
							>
						</template></el-table-column
					>
				</el-table>
				<el-alert
					v-if="testResult"
					:title="t('pushTestResult')"
					:type="testResult.status === 'success' ? 'success' : 'warning'"
					:closable="false"
				>
					<pre class="result-text">{{
						JSON.stringify(testResult, null, 2)
					}}</pre>
				</el-alert>
			</el-tab-pane>
			<el-tab-pane :label="t('pushRules')" name="rules">
				<div class="toolbar">
					<el-button type="primary" @click="editRule()">{{
						t('add')
					}}</el-button
					><el-button @click="load">{{ t('pushRefresh') }}</el-button>
				</div>
				<el-table :data="ruleList">
					<el-table-column prop="name" :label="t('pushName')" min-width="130" />
					<el-table-column :label="t('pushRecipients')" min-width="210"
						><template #default="{ row }">{{
							ruleSummary(row)
						}}</template></el-table-column
					>
					<el-table-column :label="t('pushDestinations')" min-width="160"
						><template #default="{ row }">{{
							row.destinations.map((d) => d.name).join(', ')
						}}</template></el-table-column
					>
					<el-table-column :label="t('tabStatus')" width="110"
						><template #default="{ row }"
							><el-switch
								:model-value="!!row.enabled"
								@change="toggleRule(row)"
								:disabled="busy" /></template
					></el-table-column>
					<el-table-column :label="t('pushValidation')" min-width="120"
						><template #default="{ row }"
							><el-tag :type="row.valid ? 'success' : 'warning'">{{
								t(row.valid ? 'pushValid' : 'pushInvalid')
							}}</el-tag></template
						></el-table-column
					>
					<el-table-column :label="t('action')" min-width="230"
						><template #default="{ row }">
							<el-button size="small" @click="editRule(row)">{{
								t('pushEdit')
							}}</el-button
							><el-button size="small" @click="editRule(row, true)">{{
								t('pushCopy')
							}}</el-button
							><el-button size="small" type="danger" @click="removeRule(row)">{{
								t('delete')
							}}</el-button>
						</template></el-table-column
					>
				</el-table>
				<el-divider>{{ t('pushSimulate') }}</el-divider>
				<el-input
					v-model="recipient"
					:placeholder="t('emailAccount')"
					clearable
				/>
				<div class="simulation" v-loading="simulating">
					<p>
						{{ t('pushMatchedRules') }}:
						{{ match?.rules.map((r) => r.name).join(', ') || '—' }}
					</p>
					<p>
						{{ t('pushFinalTargets') }}:
						{{ match?.destinations.map((d) => d.name).join(', ') || '—' }}
					</p>
				</div>
			</el-tab-pane>
			<el-tab-pane :label="t('pushLogs')" name="logs">
				<div class="toolbar">
					<el-button @click="loadLogs">{{ t('pushRefresh') }}</el-button
					><span>{{ t('pushRetention') }}</span>
				</div>
				<el-table :data="logs"
					><el-table-column
						prop="email_id"
						label="Email ID"
						width="90" /><el-table-column
						prop="recipient"
						:label="t('recipient')"
						min-width="190" /><el-table-column
						:label="t('pushDestinations')"
						min-width="140"
						><template #default="{ row }">{{
							targets.find((d) => d.id === row.destination_id)?.name ||
							row.destination_id
						}}</template></el-table-column
					><el-table-column
						prop="status"
						:label="t('tabStatus')"
						width="90" /><el-table-column
						prop="attempts"
						:label="t('pushAttempts')"
						width="90" /><el-table-column
						prop="error"
						:label="t('pushError')"
						min-width="220" /><el-table-column
						prop="created_at"
						:label="t('pushTime')"
						min-width="170"
				/></el-table>
			</el-tab-pane>
		</el-tabs>
		<el-dialog
			class="push-management-dialog"
			v-model="destinationShow"
			:title="t('pushDestinations')"
			width="min(680px, 94vw)"
			@closed="targetForm.config = {}"
		>
			<el-form label-position="top" @submit.prevent>
				<el-form-item :label="t('pushName')"
					><el-input v-model="targetForm.name" maxlength="100"
				/></el-form-item>
				<el-form-item :label="t('pushType')"
					><el-select
						v-model="targetForm.type"
						:disabled="!!targetForm.id"
						@change="resetConfig"
						><el-option
							v-for="type in ['telegram', 'email', 'webhook']"
							:key="type"
							:label="type"
							:value="type" /></el-select
				></el-form-item>
				<template v-if="targetForm.type === 'telegram'">
					<el-form-item label="Bot Token"
						><el-input
							v-model="targetForm.config.token"
							type="password"
							show-password
							:placeholder="
								targetForm.config.hasToken ? t('pushKeepSecret') : ''
							"
							autocomplete="new-password"
						/><el-checkbox
							v-if="targetForm.config.hasToken"
							v-model="targetForm.config.clearToken"
							>{{ t('pushClearSecret') }}</el-checkbox
						></el-form-item
					>
					<el-form-item label="Chat IDs"
						><el-input-tag v-model="targetForm.config.chatIds"
					/></el-form-item>
					<el-form-item :label="t('pushMailViewOrigin')"
						><el-input
							v-model="targetForm.config.customDomain"
							placeholder="https://mail.example.com"
					/></el-form-item>
					<div class="option-grid">
						<el-form-item
							v-for="key in ['from', 'to', 'text']"
							:key="key"
							:label="t('pushTemplate' + key)"
							><el-select v-model="targetForm.config[key]"
								><el-option
									v-for="value in key === 'from'
										? ['show', 'only-name', 'hide']
										: ['show', 'hide']"
									:key="value"
									:label="t('pushOption' + value)"
									:value="value" /></el-select
						></el-form-item>
					</div>
					<div class="toolbar">
						<el-checkbox v-model="targetForm.config.showCode">{{
							t('pushCode')
						}}</el-checkbox
						><el-checkbox v-model="targetForm.config.viewLink">{{
							t('pushViewLink')
						}}</el-checkbox>
					</div>
				</template>
				<template v-if="targetForm.type === 'email'">
					<el-form-item :label="t('recipient')"
						><el-input-tag v-model="targetForm.config.recipients"
					/></el-form-item>
					<el-alert
						:title="t('pushVerifiedEmail')"
						type="warning"
						:closable="false"
					/>
					<a
						href="https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/"
						target="_blank"
						rel="noopener noreferrer"
						>{{ t('pushCloudflareDocs') }}</a
					>
				</template>
				<template v-if="targetForm.type === 'webhook'">
					<el-form-item label="HTTPS URL"
						><el-input
							v-model="targetForm.config.url"
							placeholder="https://api.example.com/hook"
					/></el-form-item>
					<el-form-item label="Secret / Authorization"
						><el-input
							v-model="targetForm.config.secret"
							type="password"
							show-password
							:placeholder="
								targetForm.config.hasSecret ? t('pushKeepSecret') : ''
							"
							autocomplete="new-password"
						/><el-checkbox
							v-if="targetForm.config.hasSecret"
							v-model="targetForm.config.clearSecret"
							>{{ t('pushClearSecret') }}</el-checkbox
						></el-form-item
					>
					<div class="option-grid">
						<el-form-item :label="t('webhookRetry')"
							><el-input-number
								v-model="targetForm.config.retry"
								:min="0"
								:max="2" /></el-form-item
						><el-form-item :label="t('pushTimeout')"
							><el-input-number
								v-model="targetForm.config.timeout"
								:min="1000"
								:max="5000"
								:step="1000"
						/></el-form-item>
					</div>
				</template>
				<el-form-item :label="t('tabStatus')"
					><el-switch v-model="targetForm.enabled"
				/></el-form-item>
			</el-form>
			<template #footer
				><el-button type="primary" :loading="busy" @click="submitTarget">{{
					t('save')
				}}</el-button></template
			>
		</el-dialog>
		<el-dialog
			class="push-management-dialog"
			v-model="ruleShow"
			:title="t('pushRules')"
			width="min(680px, 94vw)"
		>
			<el-form label-position="top" @submit.prevent>
				<el-form-item :label="t('pushName')"
					><el-input v-model="ruleForm.name" maxlength="100"
				/></el-form-item>
				<el-form-item :label="t('pushRecipients')"
					><el-select v-model="ruleForm.recipient_mode"
						><el-option
							v-for="mode in [
								'all_registered',
								'selected',
								'legacy_all',
								...(ruleForm.recipient_mode === 'legacy_selected'
									? ['legacy_selected']
									: []),
							]"
							:key="mode"
							:value="mode"
							:label="t('pushMode' + mode)" /></el-select
				></el-form-item>
				<el-alert
					v-if="ruleForm.recipient_mode.startsWith('legacy')"
					:title="t('pushCatchAllHelp')"
					type="warning"
					:closable="false"
				/>
				<el-form-item
					v-if="ruleForm.recipient_mode === 'selected'"
					:label="t('pushSelectMailboxes')"
					><el-select
						v-model="ruleForm.accountIds"
						multiple
						filterable
						remote
						:remote-method="searchAccounts"
						:loading="accountLoading"
						><el-option
							v-for="a in accountOptions"
							:key="a.accountId"
							:label="a.email"
							:value="a.accountId" /></el-select
				></el-form-item>
				<p v-if="ruleForm.recipient_mode === 'legacy_selected'">
					{{ ruleForm.recipients.join(', ') }}
				</p>
				<el-form-item :label="t('pushDestinations')"
					><el-select v-model="ruleForm.destinationIds" multiple filterable
						><el-option
							v-for="d in targets"
							:key="d.id"
							:label="d.name + (d.enabled ? '' : ` (${t('disabled')})`)"
							:value="d.id" /></el-select
				></el-form-item>
				<el-form-item :label="t('pushPriority')"
					><el-input-number
						v-model="ruleForm.priority"
						:min="-10000"
						:max="10000"
				/></el-form-item>
				<el-form-item :label="t('tabStatus')"
					><el-switch v-model="ruleForm.enabled"
				/></el-form-item>
			</el-form>
			<template #footer
				><el-button type="primary" :loading="busy" @click="submitRule">{{
					t('save')
				}}</el-button></template
			>
		</el-dialog>
	</div>
</template>
<script setup>
import { onMounted, reactive, ref, watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import * as api from '@/request/push';
const { t } = useI18n();
const loading = ref(false),
	busy = ref(false),
	targets = ref([]),
	ruleList = ref([]),
	logs = ref([]),
	tab = ref('destinations');
const destinationShow = ref(false),
	ruleShow = ref(false),
	testResult = ref(null),
	testing = ref('');
const targetForm = reactive({
		name: '',
		type: 'telegram',
		enabled: true,
		config: {},
	}),
	ruleForm = reactive({});
const accountOptions = ref([]),
	accountLoading = ref(false),
	recipient = ref(''),
	match = ref(null),
	simulating = ref(false);
let timer,
	sequence = 0,
	accountSequence = 0;
async function load() {
	loading.value = true;
	try {
		[targets.value, ruleList.value] = await Promise.all([
			api.destinations(),
			api.rules(),
		]);
	} finally {
		loading.value = false;
	}
}
const summary = (d) =>
	d.type === 'telegram'
		? d.config.chatIds.join(', ')
		: d.type === 'email'
			? d.config.recipients.join(', ')
			: new URL(d.config.url).origin;
const ruleSummary = (r) =>
	r.recipient_mode === 'selected'
		? r.accounts
				.map((a) => a.email + (a.is_del ? ` (${t('deleted')})` : ''))
				.join(', ')
		: r.recipient_mode === 'legacy_selected'
			? r.recipients.join(', ')
			: t('pushMode' + r.recipient_mode);
function resetConfig() {
	targetForm.config =
		targetForm.type === 'telegram'
			? {
					token: '',
					chatIds: [],
					from: 'only-name',
					to: 'show',
					text: 'show',
					customDomain: '',
					showCode: true,
					viewLink: true,
				}
			: targetForm.type === 'email'
				? { recipients: [] }
				: { url: '', secret: '', retry: 0, timeout: 5000 };
}
function editDestination(d) {
	Object.assign(
		targetForm,
		d
			? JSON.parse(JSON.stringify(d))
			: { id: null, name: '', type: 'telegram', enabled: true, config: {} },
	);
	targetForm.enabled = !!targetForm.enabled;
	if (!d) resetConfig();
	destinationShow.value = true;
}
async function run(action) {
	busy.value = true;
	try {
		await action();
		await load();
	} finally {
		busy.value = false;
	}
}
async function submitTarget() {
	await run(() => api.saveDestination({ ...targetForm }));
	destinationShow.value = false;
}
async function toggleTarget(d) {
	await run(() => api.saveDestination({ ...d, enabled: !d.enabled }));
}
async function removeTarget(d) {
	try {
		await ElMessageBox.confirm(t('pushDeleteTargetHelp'), t('delete'));
	} catch {
		return;
	}
	await run(() => api.deleteDestination(d.id));
}
async function test(d) {
	try {
		await ElMessageBox.confirm(t('pushTestConfirm'), t('pushTest'));
	} catch {
		return;
	}
	testing.value = d.id;
	testResult.value = null;
	try {
		testResult.value = await api.testDestination(d.id);
	} finally {
		testing.value = '';
	}
}
async function searchAccounts(search = '') {
	const current = ++accountSequence;
	accountLoading.value = true;
	try {
		const result = await api.mailboxes({ search, size: 100 });
		if (current !== accountSequence) return;
		const selected = accountOptions.value.filter((a) =>
			ruleForm.accountIds?.includes(a.accountId),
		);
		accountOptions.value = [
			...new Map(
				[...selected, ...result.list].map((a) => [a.accountId, a]),
			).values(),
		];
	} finally {
		if (current === accountSequence) accountLoading.value = false;
	}
}
async function editRule(r, copy = false) {
	Object.assign(
		ruleForm,
		r
			? JSON.parse(JSON.stringify(r))
			: {
					id: null,
					name: '',
					enabled: true,
					recipient_mode: 'selected',
					priority: 0,
					accountIds: [],
					destinationIds: [],
					recipients: [],
				},
	);
	ruleForm.enabled = !!ruleForm.enabled;
	if (copy) {
		ruleForm.id = null;
		ruleForm.name += ' ' + t('pushCopy');
	}
	accountOptions.value = (r?.accounts || []).map((a) => ({
		accountId: a.account_id,
		email: a.email,
	}));
	ruleShow.value = true;
	await searchAccounts();
}
async function submitRule() {
	await run(() => api.saveRule({ ...ruleForm }));
	ruleShow.value = false;
}
async function toggleRule(r) {
	await run(() => api.saveRule({ ...r, enabled: !r.enabled }));
}
async function removeRule(r) {
	try {
		await ElMessageBox.confirm(t('pushDeleteRuleHelp'), t('delete'));
	} catch {
		return;
	}
	await run(() => api.deleteRule(r.id));
}
async function loadLogs() {
	logs.value = await api.deliveryLogs();
}
watch(tab, (value) => {
	if (value === 'logs') loadLogs();
});
watch(recipient, (value) => {
	const current = ++sequence;
	clearTimeout(timer);
	match.value = null;
	simulating.value = false;
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return;
	simulating.value = true;
	timer = setTimeout(async () => {
		try {
			const result = await api.simulate(value);
			if (current === sequence) match.value = result;
		} finally {
			if (current === sequence) simulating.value = false;
		}
	}, 300);
});
onBeforeUnmount(() => {
	clearTimeout(timer);
	sequence++;
	accountSequence++;
});
onMounted(load);
</script>
<style scoped>
.push-manager {
	min-width: 0;
}
.toolbar {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
	align-items: center;
	margin: 12px 0;
}
.el-select {
	width: 100%;
}
.option-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 12px;
}
.result-text {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.simulation {
	overflow-wrap: anywhere;
}
.el-alert {
	margin: 10px 0;
}
@media (max-width: 767px) {
	.option-grid {
		grid-template-columns: 1fr;
	}
	.toolbar .el-button {
		margin-left: 0;
	}
}
</style>
