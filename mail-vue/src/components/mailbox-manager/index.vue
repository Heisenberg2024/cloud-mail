<template>
	<el-dialog
		class="mailbox-management-dialog"
		v-model="show"
		:title="t('mailboxManagement')"
		width="min(1000px, 96vw)"
	>
		<div class="toolbar">
			<el-input
				v-model="search"
				:placeholder="t('pushMailboxSearch')"
				clearable
				@keyup.enter="reload"
			/><el-button @click="reload">{{ t('pushSearch') }}</el-button>
		</div>
		<el-table :data="list" v-loading="loading" max-height="480">
			<el-table-column
				prop="email"
				:label="t('emailAccount')"
				min-width="190"
			/>
			<el-table-column
				prop="ownerEmail"
				:label="t('mailboxOwner')"
				min-width="190"
			/>
			<el-table-column :label="t('perm')" min-width="110"
				><template #default="{ row }">{{
					row.isAdmin ? t('admin') : row.roleName
				}}</template></el-table-column
			>
			<el-table-column :label="t('mailboxLoginStatus')" min-width="140"
				><template #default="{ row }"
					><el-tag :type="row.independent ? 'success' : 'info'">{{
						t(row.independent ? 'mailboxIndependent' : 'mailboxAttached')
					}}</el-tag
					><span v-if="row.independent && row.userStatus">
						({{ t('disabled') }})</span
					></template
				></el-table-column
			>
			<el-table-column :label="t('action')" min-width="240"
				><template #default="{ row }">
					<el-button
						v-if="!row.independent"
						size="small"
						type="primary"
						@click="openUpgrade(row)"
						>{{ t('mailboxEnableLogin') }}</el-button
					>
					<template v-else
						><el-button size="small" @click="openReset(row)">{{
							t('chgPwd')
						}}</el-button
						><el-button
							v-if="!row.isAdmin"
							size="small"
							@click="openRole(row)"
							>{{ t('perm') }}</el-button
						><el-button v-if="!row.isAdmin" size="small" @click="status(row)">{{
							t(row.userStatus ? 'enable' : 'disable')
						}}</el-button></template
					>
				</template></el-table-column
			>
		</el-table>
		<el-pagination
			class="pagination"
			v-model:current-page="page"
			:page-size="30"
			:total="total"
			:pager-count="5"
			layout="prev,pager,next,total"
			@current-change="load"
		/>
		<el-dialog
			class="mailbox-management-dialog"
			v-model="upgradeShow"
			:title="t('mailboxEnableLogin')"
			width="min(520px, 94vw)"
			append-to-body
			@closed="
				form.password = '';
				form.confirmPassword = '';
			"
		>
			<el-alert
				:title="t('mailboxTransferWarning')"
				type="warning"
				:closable="false"
			/>
			<p>{{ t('mailboxDraftWarning') }}</p>
			<el-form label-position="top">
				<el-form-item :label="t('emailAccount')"
					><el-input :model-value="form.email" disabled
				/></el-form-item>
				<el-form-item :label="t('password')"
					><el-input
						v-model="form.password"
						type="password"
						show-password
						autocomplete="new-password"
				/></el-form-item>
				<el-form-item :label="t('mailboxConfirmPassword')"
					><el-input
						v-model="form.confirmPassword"
						type="password"
						show-password
						autocomplete="new-password"
				/></el-form-item>
				<el-form-item :label="t('perm')"
					><el-select v-model="form.roleId"
						><el-option
							v-for="r in roles"
							:key="r.roleId"
							:label="r.name"
							:value="r.roleId" /></el-select
				></el-form-item>
				<el-form-item :label="t('enable')"
					><el-switch v-model="form.enabled"
				/></el-form-item>
			</el-form>
			<template #footer
				><el-button type="primary" :loading="busy" @click="upgrade">{{
					t('save')
				}}</el-button></template
			>
		</el-dialog>
		<el-dialog
			class="mailbox-management-dialog"
			v-model="resetShow"
			:title="t('chgPwd')"
			width="min(520px, 94vw)"
			append-to-body
			@closed="resetPassword = ''"
		>
			<el-input
				v-model="resetPassword"
				type="password"
				show-password
				:placeholder="t('mailboxPasswordHelp')"
				autocomplete="new-password"
			/>
			<template #footer
				><el-button type="primary" :loading="busy" @click="reset">{{
					t('save')
				}}</el-button></template
			>
		</el-dialog>
		<el-dialog
			class="mailbox-management-dialog"
			v-model="roleShow"
			:title="t('perm')"
			width="min(520px, 94vw)"
			append-to-body
		>
			<el-select v-model="selectedRole"
				><el-option
					v-for="r in roles"
					:key="r.roleId"
					:label="r.name"
					:value="r.roleId"
			/></el-select>
			<template #footer
				><el-button type="primary" :loading="busy" @click="changeRole">{{
					t('save')
				}}</el-button></template
			>
		</el-dialog>
	</el-dialog>
</template>
<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUserStore } from '@/store/user';
import { useAccountStore } from '@/store/account';
import { mailboxes, enableLogin } from '@/request/push';
import { roleSelectUse } from '@/request/role';
import { userSetPwd, userSetStatus, userSetType } from '@/request/user';
const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue', 'changed']);
const show = computed({
		get: () => props.modelValue,
		set: (v) => emit('update:modelValue', v),
	}),
	{ t } = useI18n(),
	userStore = useUserStore();
const search = ref(''),
	list = ref([]),
	total = ref(0),
	page = ref(1),
	loading = ref(false),
	busy = ref(false),
	roles = ref([]),
	upgradeShow = ref(false),
	resetShow = ref(false),
	roleShow = ref(false),
	selectedRole = ref(1),
	selectedUser = ref(0),
	resetPassword = ref('');
const accountStore = useAccountStore();
const form = reactive({});
let sequence = 0;
async function load() {
	const current = ++sequence;
	loading.value = true;
	try {
		const result = await mailboxes({
			search: search.value,
			page: page.value,
			size: 30,
		});
		if (current !== sequence) return;
		list.value = result.list;
		total.value = result.total;
	} finally {
		if (current === sequence) loading.value = false;
	}
}
function reload() {
	page.value = 1;
	load();
}
function openUpgrade(row) {
	Object.assign(form, {
		accountId: row.accountId,
		email: row.email,
		password: '',
		confirmPassword: '',
		roleId:
			roles.value.find((r) => r.isDefault)?.roleId || roles.value[0]?.roleId,
		enabled: true,
	});
	upgradeShow.value = true;
}
async function run(action) {
	busy.value = true;
	try {
		await action();
		await load();
		emit('changed');
	} finally {
		busy.value = false;
	}
}
async function upgrade() {
	if (
		form.password?.length < 8 ||
		form.password?.length > 128 ||
		form.password !== form.confirmPassword
	) {
		ElMessage.warning(t('mailboxPasswordHelp'));
		return;
	}
	await run(async () => {
		await enableLogin({ ...form });
		if (accountStore.currentAccountId === form.accountId) {
			accountStore.currentAccount = userStore.user.account;
			accountStore.currentAccountId = userStore.user.account.accountId;
		}
		accountStore.ownershipVersion++;
	});
	upgradeShow.value = false;
}
function openReset(row) {
	selectedUser.value = row.userId;
	resetPassword.value = '';
	resetShow.value = true;
}
async function reset() {
	await run(() =>
		userSetPwd({ userId: selectedUser.value, password: resetPassword.value }),
	);
	resetShow.value = false;
}
function openRole(row) {
	selectedUser.value = row.userId;
	selectedRole.value = row.roleId;
	roleShow.value = true;
}
async function changeRole() {
	await run(() =>
		userSetType({ userId: selectedUser.value, type: selectedRole.value }),
	);
	roleShow.value = false;
}
async function status(row) {
	try {
		await ElMessageBox.confirm(t('mailboxDisableHelp'), t('tabStatus'));
	} catch {
		return;
	}
	await run(() =>
		userSetStatus({ userId: row.userId, status: row.userStatus ? 0 : 1 }),
	);
}
watch(show, async (visible) => {
	if (visible) {
		roles.value = await roleSelectUse();
		reload();
	} else {
		sequence++;
		loading.value = false;
	}
});
</script>
<style scoped>
.toolbar {
	display: flex;
	gap: 10px;
	margin-bottom: 14px;
}
.toolbar .el-input {
	max-width: 450px;
}
.pagination {
	margin-top: 16px;
	overflow: auto;
}
.el-select {
	width: 100%;
}
.el-alert {
	margin-bottom: 12px;
}
p {
	overflow-wrap: anywhere;
}
@media (max-width: 767px) {
	.toolbar {
		flex-wrap: wrap;
	}
}
</style>
