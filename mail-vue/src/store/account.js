    import { defineStore } from 'pinia'

export const useAccountStore = defineStore('account', {
    state: () => ({
        currentAccountId: 0,
        ownershipVersion: 0,
        mailboxView: 'mine',
        managedAccount: {},
        mailboxSearch: '',
        mailboxPage: 1,
        currentAccount: {},
        changeUserAccountName: ''
    })
})
