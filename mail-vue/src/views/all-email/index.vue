<template>
  <div class="email-list-box">
    <div v-if="mailboxId !== undefined || mailboxPicker" class="managed-header">
      <el-button size="small" @click="backToMailboxes">{{ t('allMailboxes') }}</el-button>
      <span class="managed-title">{{ accountStore.managedAccount.email || t('mailboxChoose') }}</span>
      <el-tag type="info">{{ t('mailboxReadOnly') }}</el-tag>
      <span v-if="accountStore.managedAccount.ownerEmail" class="managed-owner">{{ t('mailboxOwner') }}: {{ accountStore.managedAccount.ownerEmail }}</span>
      <el-button v-if="accountStore.managedAccount.userId" size="small" @click="managerShow = true">{{ t('mailboxManageOwner') }}</el-button>
      <el-button size="small" @click="uiStore.accountShow = true">{{ t('selectEmail') }}</el-button>
    </div>
    <el-empty v-if="mailboxPicker" :description="t('mailboxChoose')" />
    <emailScroll v-else ref="sysEmailScroll" :key="mailboxId || 'global'" class="managed-scroll"
                 :read-only="mailboxId !== undefined"
                 :get-emailList="getEmailList"
                 :email-delete="allEmailDelete"
                 :star-add="starAdd"
                 :star-cancel="starCancel"
                 :show-star="false"
                 show-user-info
                 show-status
                 actionLeft="4px"
                 :show-account-icon="mailboxId !== undefined"
                 :time-sort="params.timeSort"
                 :item-height="65"
                 @jump="jumpContent"
                 @refresh-before="refreshBefore"
                 @right-search="rightSearch"
                 :type="'all-email'"

    >
      <template #first>
        <el-input
            v-model="searchValue"
            :placeholder="$t('searchByContent')"
            class="search-input" @keyup.enter="search"
        >
          <template #prefix>
            <div @click.stop="openSelect">
              <el-select
                  ref="mySelect"
                  v-model="params.searchType"
                  :placeholder="$t('select')"
                  class="select"
              >
                <el-option key="3" :label="$t('sender')" :value="'name'"/>
                <el-option key="4" :label="$t('subject')" :value="'subject'"/>
                <el-option v-if="mailboxId === undefined" key="1" :label="$t('user')" :value="'user'"/>
                <el-option v-if="mailboxId === undefined" key="2" :label="$t('selectEmail')" :value="'account'"/>
              </el-select>
              <div class="search-type">
                <span>{{ selectTitle }}</span>
                <Icon class="setting-icon" icon="mingcute:down-small-fill" width="20" height="20"/>
              </div>
            </div>
          </template>
        </el-input>
        <el-select v-model="params.type" placeholder="Select" class="status-select" @change="typeSelectChange">
          <el-option key="1" :label="$t('all')" value="all"/>
          <el-option key="3" :label="$t('received')" value="receive"/>
          <el-option key="2" :label="$t('sent')" value="send"/>
          <el-option v-if="mailboxId === undefined" key="4" :label="$t('selectDeleted')" value="delete"/>
          <el-option v-if="mailboxId === undefined" key="5" :label="$t('noRecipientTitle')" value="noone"/>
        </el-select>
        <Icon class="icon" icon="iconoir:search" @click="search" width="20" height="20"/>
        <Icon class="icon" @click="changeTimeSort" icon="material-symbols-light:timer-arrow-down-outline"
              v-if="params.timeSort === 0" width="28" height="28"/>
        <Icon class="icon" @click="changeTimeSort" icon="material-symbols-light:timer-arrow-up-outline" v-else
              width="28" height="28"/>
        <Icon v-if="mailboxId === undefined" class="icon clear" icon="fluent:broom-sparkle-16-regular" width="22" height="22" @click="openBathDelete"/>
      </template>
    </emailScroll>
    <mailbox-manager v-if="userStore.user.type === 0" v-model="managerShow" :user-id="accountStore.managedAccount.userId" />
    <el-dialog v-model="showBathDelete" :title="$t('clearEmail')" width="335"
               @closed="closedClear">
      <div class="clear-email">
        <el-input v-model="clearParams.sendName" :placeholder="$t('sender')" @keyup.enter="batchDelete"/>
        <el-input v-model="clearParams.subject" :placeholder="$t('subject')" @keyup.enter="batchDelete"/>
        <el-input v-model="clearParams.sendEmail" :placeholder="$t('sendEmailAddress')" @keyup.enter="batchDelete"/>
        <el-input v-model="clearParams.toEmail" :placeholder="$t('toEmail')" @keyup.enter="batchDelete"/>
        <el-date-picker popper-class="my-date-picker"
                        v-model="clearTime"
                        type="daterange"
                        :teleported="false"
                        unlink-panels
                        :range-separator="t('to')"
                        size="default"
        />
        <div class="clear-button">
          <el-select v-model="clearParams.type" style="width: 200px">
            <el-option key="eq" :label="t('equal')" value="eq"/>
            <el-option key="left" :label="t('leading')" value="left"/>
            <el-option key="include" :label="t('include')" value="include"/>
          </el-select>
          <el-button :loading="clearLoading" type="primary" @click="batchDelete">{{ t('clear') }}</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import {starAdd, starCancel} from "@/request/star.js";
import emailScroll from "@/components/email-scroll/index.vue"
import {computed, defineOptions, reactive, ref, watch, onMounted, onUnmounted} from "vue";
import {useEmailStore} from "@/store/email.js";
import {
  allEmailList,
  allEmailDetail,
  allEmailDelete,
  allEmailBatchDelete,
  allEmailLatest
} from "@/request/all-email.js";
import {Icon} from "@iconify/vue";
import router from "@/router/index.js";
import {useI18n} from 'vue-i18n';
import {toUtc} from "@/utils/day.js";
import {sleep} from "@/utils/time-utils.js";
import {useSettingStore} from "@/store/setting.js";
import { useRoute } from 'vue-router'
import {useAccountStore} from '@/store/account';
import {useUserStore} from '@/store/user';
import {useUiStore} from '@/store/ui';
import {adminAccountList} from '@/request/account';
import MailboxManager from '@/components/mailbox-manager/index.vue';

defineOptions({
  name: 'all-email'
})

const route = useRoute()
const accountStore = useAccountStore(), userStore = useUserStore(), uiStore = useUiStore();
const mailboxId = ref(route.query.accountId === undefined ? undefined : Number(route.query.accountId));
const mailboxPicker = ref(route.query.mailboxes === 'all');
const managerShow = ref(false);
let viewVersion = 0;
let detailSequence = 0;
let metadataSequence = 0;
let polling = true;
const {t} = useI18n();
const emailStore = useEmailStore();
const settingStore = useSettingStore();
const clearTime = ref('')
const sysEmailScroll = ref({})
const searchValue = ref('')
const mySelect = ref()
const showBathDelete = ref(false)
const clearLoading = ref(false)

onMounted(() => {
  if (mailboxPicker.value && userStore.user.type === 0) {
    accountStore.mailboxView = 'all';
    uiStore.accountShow = true;
  }
  loadMailbox();
  latest();
})
onUnmounted(() => { polling = false; viewVersion++; metadataSequence++; });

const openSelect = () => {
  mySelect.value.toggleMenu()
}

const params = reactive({
  timeSort: 0,
  type: 'receive',
  userEmail: null,
  accountEmail: null,
  name: null,
  subject: null,
  searchType: 'name'
})

const clearParams = reactive({
  subject: '',
  sendEmail: '',
  sendName: '',
  startTime: '',
  toEmail: '',
  endTime: '',
  type: 'eq',
})

function resetClearParams() {
  clearParams.subject = ''
  clearParams.sendEmail = ''
  clearParams.sendName = ''
  clearParams.startTime = ''
  clearParams.toEmail = ''
  clearParams.endTime = ''
}

function closedClear() {
  resetClearParams()
  clearParams.type = 'eq'
  clearParams.endTime = ''
  clearTime.value = null
}

const selectTitle = computed(() => {
  if (params.searchType === 'user') return t('user')
  if (params.searchType === 'account') return t('selectEmail')
  if (params.searchType === 'name') return t('sender')
  if (params.searchType === 'subject') return t('subject')
})

const paramsStar = localStorage.getItem('all-email-params')
if (paramsStar && mailboxId.value === undefined && !mailboxPicker.value) {
  const locaParams = JSON.parse(paramsStar)
  params.type = locaParams.type
  params.timeSort = locaParams.timeSort
  params.status = locaParams.status
  params.searchType = locaParams.searchType
}

watch(() => params, () => {
  if (mailboxId.value === undefined && !mailboxPicker.value) localStorage.setItem('all-email-params', JSON.stringify(params))
}, {
  deep: true
})

async function loadMailbox() {
  const sequence = ++metadataSequence;
  if (mailboxId.value === undefined || userStore.user.type !== 0) return;
  accountStore.mailboxView = 'all';
  accountStore.managedAccount = {};
  const data = await adminAccountList({accountId: mailboxId.value, size: 1});
  if (sequence !== metadataSequence) return;
  accountStore.managedAccount = data.list[0] || {};
}
watch(() => [route.name, route.query.accountId, route.query.mailboxes], () => {
  if (route.name !== 'all-email') return;
  const id = route.query.accountId === undefined ? undefined : Number(route.query.accountId);
  const picker = route.query.mailboxes === 'all';
  if (id === mailboxId.value && picker === mailboxPicker.value) return;
  viewVersion++;
  emailStore.contentData.email = null;
  mailboxId.value = id;
  mailboxPicker.value = picker;
  if (picker && userStore.user.type === 0) {
    accountStore.mailboxView = 'all';
    accountStore.managedAccount = {};
  }
  searchValue.value = '';
  Object.assign(params, {timeSort: 0, type: 'receive', userEmail: null, accountEmail: null, name: null, subject: null, searchType: 'name'});
  loadMailbox();
}, {flush: 'sync'});
watch(() => accountStore.ownershipVersion, () => {
  viewVersion++;
  loadMailbox();
  sysEmailScroll.value?.refreshList?.();
  if (route.name === 'content' && ['readonly', 'physics'].includes(emailStore.contentData.delType) && emailStore.contentData.email?.emailId) {
    jumpContent(emailStore.contentData.email);
  }
});
async function backToMailboxes() {
  accountStore.mailboxView = 'all';
  accountStore.managedAccount = {};
  await router.push({name: 'all-email', query: {mailboxes: 'all'}});
  uiStore.accountShow = true;
}

function openBathDelete() {
  showBathDelete.value = true
}

function batchDelete() {

  if (clearLoading.value) return

  if (clearTime.value) {
    clearParams.startTime = toUtc(clearTime.value[0]).format("YYYY-MM-DD HH:mm:ss")
    clearParams.endTime = toUtc(clearTime.value[1]).add(1, 'day').format("YYYY-MM-DD HH:mm:ss")
  }

  if (!clearParams.sendEmail && !clearParams.sendName && !clearParams.subject && !clearParams.toEmail && !clearTime.value) {
    showBathDelete.value = false
    return
  }

  ElMessageBox.confirm(
      t('delAllConfirm'),
      {
        confirmButtonText: t('confirm'),
        cancelButtonText: t('cancel'),
        type: 'warning',
      }
  ).then(() => {
    clearLoading.value = true

    allEmailBatchDelete(clearParams).then(() => {
      ElMessage({
        message: t('clearSuccess'),
        type: "success",
        plain: true
      })
      resetClearParams()
      sysEmailScroll.value.refreshList();
    }).finally(() => {
      clearLoading.value = false
    })
  })
}

function rightSearch(type, value) {
  if (mailboxId.value !== undefined && ['user', 'account'].includes(type)) return;
  params.searchType = type;
  searchValue.value = value;
  search();
}

function refreshBefore() {
  viewVersion++;
  if (mailboxId.value !== undefined) return;
  searchValue.value = null
  params.timeSort = 0
  params.type = 'receive'
  params.userEmail = null
  params.accountEmail = null
  params.name = null
  params.subject = null
  params.searchType = 'name'
}

function search() {
  viewVersion++;

  params.userEmail = null
  params.accountEmail = null
  params.name = null
  params.subject = null

  if (params.searchType === 'user') {
    params.userEmail = searchValue.value
  }

  if (params.searchType === 'account') {
    params.accountEmail = searchValue.value
  }

  if (params.searchType === 'name') {
    params.name = searchValue.value
  }

  if (params.searchType === 'subject') {
    params.subject = searchValue.value
  }

  sysEmailScroll.value.refreshList();
}

function changeTimeSort() {
  params.timeSort = params.timeSort ? 0 : 1
  search()
}

function typeSelectChange() {
  search()
}

async function jumpContent(email) {
  const sequence = ++detailSequence;
  const accountId = mailboxId.value;
  const version = viewVersion;
  // Fetch a fresh detail under the same exact scope; never use another view's cache.
  emailStore.contentData.email = {...email, content: '', text: '', attList: []};
  emailStore.contentData.delType = accountId === undefined ? 'physics' : 'readonly';
  emailStore.contentData.accountId = accountId;
  emailStore.contentData.showUnread = false;
  emailStore.contentData.showStar = false
  emailStore.contentData.showReply = false
  await router.push({name: 'content', query: accountId === undefined ? {} : {accountId}});
  const detail = await allEmailDetail({emailId: email.emailId, accountId});
  if (sequence !== detailSequence || version !== viewVersion || accountId !== mailboxId.value || route.name !== 'content' || Number(route.query.accountId || 0) !== Number(accountId || 0) || emailStore.contentData.email?.emailId !== email.emailId) return;
  emailStore.contentData.email = detail;
}


function getEmailList(emailId, size) {
  const query = {...params, accountId: mailboxId.value};
  return allEmailList({emailId, size, full: 0, ...query});
}

async function latest() {

  while (polling) {

    let autoRefresh = settingStore.settings.autoRefresh;

    await sleep(autoRefresh > 1 ? autoRefresh * 1000 : 3000);
    if (!polling) return;

    const latestId = sysEmailScroll.value?.latestEmail?.emailId

    if (autoRefresh < 2) {
      continue
    }

    if (!latestId && latestId !== 0) {
      continue
    }

    if (route.name !== 'all-email' || mailboxPicker.value) {
      continue
    }


    if (params.type !== 'receive') {
      continue
    }

    try {

      const version = viewVersion;
      const query = {...params, accountId: mailboxId.value};
      let list = await allEmailLatest(latestId, query);

      if (list.length === 0) {
        continue
      }

      if (params.type !== 'receive') {
        continue
      }

      // 确保回来之后条件没变
      if (version !== viewVersion || route.name !== 'all-email') {
        continue
      }

      for (let email of list) {
        if (version !== viewVersion || route.name !== 'all-email') break;

        sysEmailScroll.value.addItem(email)
        await sleep(50)

      }

    } catch (e) {
      if (e.code === 401 || e.code === 403) {
        settingStore.settings.autoRefresh = 0;
      }
      console.error(e)
    }

  }
}

</script>
<style>

@media (max-width: 767px) {
  .el-date-range-picker .el-picker-panel__body {
    min-width: auto;

  }

  .my-date-picker::after {
    content: "";
    position: absolute; /* 脱离文档流，不会撑开 */
    left: 0;
    right: 0;
    height: 20px;
    background: transparent; /* 方便看效果 */
  }

  .el-date-range-picker__content {
    width: 100%;
  }

  .el-date-range-picker {
    width: 300px;
  }

  .el-tooltip .el-picker_popper {
    padding-bottom: 200px;
  }

  .el-date-range-picker__content.is-left {
    border-right: 0;
  }
}

</style>
<style scoped lang="scss">
.email-list-box {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}
.managed-header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px; border-bottom: 1px solid var(--el-border-color); }
.managed-title, .managed-owner { overflow-wrap: anywhere; min-width: 0; }
.managed-owner { color: var(--el-text-color-secondary); font-size: 12px; }
.managed-scroll { flex: 1; min-height: 0; }


.search {
  padding-top: 5px;
  padding-bottom: 5px;
}

.select {
  position: absolute;
  width: 40px;
  opacity: 0;
  pointer-events: none;
}

.search-type {
  display: flex;
  color: var(--el-text-color-regular);
}

:deep(.header-actions) {
  padding-top: 8px;
  padding-bottom: 8px;
}

.search-input {
  width: 100%;
  max-width: 280px;
  height: 28px;

  .setting-icon {
    position: relative;
    top: 3px;
  }
}

.clear-email {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.clear-button {
  display: flex;
  align-items: center;
  gap: 15px;

  .el-button {
    width: 100%;
  }
}

.status-select {
  margin-bottom: 2px;
  width: 102px;

  :deep(.el-select__wrapper) {
    min-height: 28px;
  }
}

.input-with-select {
  max-width: 200px;
  border-radius: 0 4px 4px 0;
}

:deep(.input-with-select .el-input-group__append) {
  background-color: var(--el-fill-color-blank);
}

:deep(.el-select__wrapper) {
  padding: 2px 10px;
  min-height: 28px;
}

:deep(.el-date-editor.el-input__wrapper) {
  width: 303px;
}

.icon {
  cursor: pointer;
}

.clear {
  @media (max-width: 419px) {
    position: absolute;
    top: 41px;
    left: 242px;
  }
}

:deep(.reload) {
  @media (max-width: 419px) {
    position: absolute;
    top: 42px;
    left: 208px;
  }
}

:deep(.delete) {
  @media (max-width: 456px) {
    position: absolute;
    top: 43px;
    left: 294px;
  }

  @media (max-width: 419px) {
    position: absolute;
    top: 43px;
    left: 282px;
  }
}
</style>
