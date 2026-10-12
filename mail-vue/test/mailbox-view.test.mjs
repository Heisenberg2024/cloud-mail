import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
import {computed, effectScope, reactive, ref, watch} from 'vue';
import {parse} from 'vue/compiler-sfc';
import {createPinia, defineStore, setActivePinia} from 'pinia';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const withoutImports = code => code.replace(/import\s+[\s\S]*?from\s*['"][^'"]+['"];?/g, '');
function setup(path, bindings, returned) {
  const code = parse(source(path)).descriptor.scriptSetup.content;
  const scope = effectScope();
  const defaults = {
    computed, reactive, ref, watch, nextTick: tick,
    onMounted() {}, onActivated() {}, onUnmounted() {}, defineOptions() {},
    defineExpose() {}, defineEmits: () => () => {},
    useI18n: () => ({t: key => key}),
    localStorage: {getItem: () => null, setItem() {}},
    window: {addEventListener() {}, getSelection: () => ({toString: () => ''})},
    innerWidth: 1280, DOMRect: {fromRect: value => value},
    sleep: async () => {}, fromNow: value => value,
    useScroll: () => ({arrivedState: reactive({bottom: false})}),
    EmailUnreadEnum: {UNREAD: 0, READ: 1},
    ...bindings,
  };
  const result = scope.run(() => new Function(...Object.keys(defaults), `${withoutImports(code)}\nreturn {${returned}};`)(...Object.values(defaults)));
  return {...result, stop: () => scope.stop()};
}
function emailStore() {
  setActivePinia(createPinia());
  const code = withoutImports(source('../src/store/email.js')).replace('export const useEmailStore =', 'return');
  return new Function('defineStore', 'EmailUnreadEnum', code)(defineStore, {UNREAD: 0, READ: 1})();
}

test('mailbox refresh starts during an old page request and discards its late list, cursor and count', async () => {
  const requests = [];
  const props = {timeSort: 0, type: 'all-email', getEmailList: () => {
    const request = deferred(); requests.push(request); return request.promise;
  }};
  const view = setup('../src/components/email-scroll/index.vue', {
    defineProps: () => props, useEmailStore: () => reactive({}),
    useUiStore: () => reactive({}), useSettingStore: () => ({settings: {}}),
  }, 'refreshList, emailList, latestEmail, total, loading');
  view.refreshList();
  assert.equal(requests.length, 2);
  const response = id => ({list: [{emailId: id, status: 0, createTime: ''}], total: id, latestEmail: {emailId: id}});
  requests[1].resolve(response(20)); await tick();
  requests[0].resolve(response(10)); await tick();
  assert.deepEqual(view.emailList.map(row => row.emailId), [20]);
  assert.equal(view.latestEmail.value.emailId, 20);
  assert.equal(view.total.value, 20);
  assert.equal(view.loading.value, false);
  view.stop();
});

test('read-only mailbox list never invokes read, star or deletion callbacks', () => {
  let writes = 0;
  const write = () => { writes++; };
  const props = {readOnly: true, timeSort: 0, type: 'all-email', emailRead: write, emailDelete: write, starAdd: write, starCancel: write,
    getEmailList: () => new Promise(() => {})};
  const view = setup('../src/components/email-scroll/index.vue', {
    defineProps: () => props, useEmailStore: () => reactive({}),
    useUiStore: () => reactive({}), useSettingStore: () => ({settings: {}}),
  }, 'starChange, handleRead, emailRead, rightDelete, handleDelete');
  view.starChange({emailId: 10}); view.handleRead(); view.emailRead(10); view.rightDelete(10); view.handleDelete();
  assert.equal(writes, 0);
  view.stop();
});

test('invalidated user-detail responses cannot refill the cache or replace administrator detail', async () => {
  const store = emailStore();
  const full = deferred();
  await store.fetchList(mode => mode ? full.promise : Promise.resolve({list: [{emailId: 10}]}));
  store.invalidateDetails(true);
  store.contentData.delType = 'readonly';
  store.contentData.email = {emailId: 10, text: 'Fresh administrator detail', attList: [{key: 'fresh'}]};
  full.resolve({list: [{emailId: 10, text: 'Stale body', attList: [{key: 'stale'}]}]});
  await tick();
  assert.deepEqual(store.detailMap, {});
  store.applyFullList([{emailId: 10, text: 'Another user view'}]);
  assert.equal(store.contentData.email.text, 'Fresh administrator detail');
  assert.equal(store.contentData.email.attList[0].key, 'fresh');
});

test('administrator mailbox switches isolate pending bodies/attachments and retain the owned sending account', async () => {
  const state = ref({name: 'all-email', query: {accountId: '2'}});
  const route = new Proxy({}, {get: (_, key) => state.value[key]});
  const store = emailStore();
  const accountStore = reactive({currentAccountId: 1, currentAccount: {accountId: 1, userId: 1}, managedAccount: {}, ownershipVersion: 0});
  const requests = [], lists = [];
  const view = setup('../src/views/all-email/index.vue', {
    useRoute: () => route, router: {push: async next => {state.value = next;}},
    useEmailStore: () => store, useAccountStore: () => accountStore,
    useUserStore: () => ({user: {type: 0}}), useUiStore: () => reactive({}),
    useSettingStore: () => ({settings: {autoRefresh: 0}}),
    adminAccountList: async ({accountId}) => ({list: [{accountId, userId: accountId + 10, email: `box${accountId}@example.com`}]}),
    allEmailList: async query => {lists.push(query); return {list: []};},
    allEmailDetail: query => {const request = deferred(); requests.push({...request, query}); return request.promise;},
  }, 'jumpContent, getEmailList, params, refreshBefore');
  const first = view.jumpContent({emailId: 10}); await tick();
  state.value = {name: 'all-email', query: {accountId: '3'}};
  await view.getEmailList(0, 50);
  assert.equal(lists.at(-1).accountId, 3);
  const second = view.jumpContent({emailId: 12}); await tick();
  requests[1].resolve({emailId: 12, text: 'Mailbox B', attList: [{key: 'B'}]}); await second;
  requests[0].resolve({emailId: 10, text: 'Mailbox A', attList: [{key: 'A'}]}); await first;
  assert.equal(store.contentData.email.text, 'Mailbox B');
  assert.equal(store.contentData.email.attList[0].key, 'B');
  assert.equal(store.contentData.showUnread, false);
  assert.equal(store.contentData.delType, 'readonly');
  assert.equal(accountStore.currentAccountId, 1);
  state.value = {name: 'all-email', query: {accountId: '3'}};
  view.params.type = 'send';
  view.refreshBefore(); await view.getEmailList(0, 50);
  assert.equal(lists.at(-1).accountId, 3);
  assert.equal(lists.at(-1).type, 'send');
  view.stop();
});

test('independent-login upgrade refreshes mailbox ownership views and falls back to the owned main mailbox', async () => {
  const accountStore = reactive({currentAccountId: 2, currentAccount: {accountId: 2, userId: 1}, ownershipVersion: 0});
  const main = {accountId: 1, userId: 1};
  let owner = 1, reads = 0;
  const view = setup('../src/components/mailbox-manager/index.vue', {
    defineProps: () => reactive({modelValue: false}),
    useRouter: () => ({push() {}}), useUserStore: () => ({user: {account: main}}),
    useAccountStore: () => accountStore,
    enableLogin: async () => {owner = 2;},
    mailboxes: async () => {reads++; return {list: [{accountId: 2, userId: owner, independent: 1}], total: 1};},
  }, 'upgrade, form, list');
  Object.assign(view.form, {accountId: 2, password: 'test-password', confirmPassword: 'test-password', roleId: 1});
  await view.upgrade();
  assert.equal(accountStore.currentAccountId, 1);
  assert.equal(accountStore.currentAccount.userId, 1);
  assert.equal(accountStore.ownershipVersion, 1);
  assert.equal(reads, 1);
  assert.equal(view.list.value[0].userId, 2);
  view.stop();
});

test('returning to the mailbox picker opens the sidebar after navigation and polling tolerates the absent list', async () => {
  const state = ref({name: 'all-email', query: {accountId: '2'}});
  const route = new Proxy({}, {get: (_, key) => state.value[key]});
  const ui = reactive({accountShow: true});
  const waits = [deferred(), deferred()];
  let waitIndex = 0, unmount;
  const view = setup('../src/views/all-email/index.vue', {
    useRoute: () => route, router: {push: async next => {state.value = next; ui.accountShow = false;}},
    useEmailStore: emailStore,
    useAccountStore: () => reactive({managedAccount: {}, ownershipVersion: 0}),
    useUserStore: () => ({user: {type: 0}}), useUiStore: () => ui,
    useSettingStore: () => ({settings: {autoRefresh: 2}}),
    sleep: () => waits[waitIndex++].promise, onUnmounted: fn => {unmount = fn;},
  }, 'latest, sysEmailScroll, backToMailboxes');
  view.sysEmailScroll.value = null;
  const polling = view.latest();
  await view.backToMailboxes();
  assert.equal(ui.accountShow, true);
  assert.equal(route.query.mailboxes, 'all');
  waits[0].resolve(); await tick();
  unmount(); waits[1].resolve(); await polling;
  view.stop();
});

test('reselecting an owned mailbox keeps its cached body, while switching mailboxes invalidates old details', () => {
  const accountStore = reactive({currentAccountId: 1, currentAccount: {accountId: 1}, mailboxView: 'mine', managedAccount: {}, ownershipVersion: 0});
  let invalidations = 0;
  const view = setup('../src/layout/account/index.vue', {
    useRouter: () => ({currentRoute: {value: {name: 'email'}}}),
    useUserStore: () => ({user: {type: 0, account: {accountId: 1}}}),
    useAccountStore: () => accountStore,
    useEmailStore: () => ({invalidateDetails() {invalidations++;}}),
    useUiStore: () => reactive({}), useSettingStore: () => ({settings: {}, domainList: ['@example.com']}),
    hasPerm: () => false,
  }, 'changeAccount');
  view.changeAccount({accountId: 1});
  assert.equal(invalidations, 0);
  view.changeAccount({accountId: 2});
  assert.equal(invalidations, 1);
  assert.equal(accountStore.currentAccountId, 2);
  view.stop();
});
