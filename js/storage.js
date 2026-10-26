/* Storage keys, and the move off the old prefixed names.
   Loaded in the head, before theme.js, so every key is renamed before the
   first one is read. Nothing else defines a storage key. */

const storageKeys = {
    draft: "draft",
    savedMessages: "savedMessages",
    theme: "theme",
    accent: "accent",
    clearAfterCopy: "clearAfterCopy",
    tutorialHidden: "tutorialHidden",
};

/*
 * The keys used to read jff.entry.v1 and the like, a prefix and a version
 * that said nothing about what each one held. The values are moved to the
 * plain names once on load, before anything reads them, so an entry, the
 * saved messages, and the preferences outlive the rename.
 */
const legacyStorageKeys = {
    "jff.entry.v1": storageKeys.draft,
    "jff.saved.v1": storageKeys.savedMessages,
    "jff.theme.v1": storageKeys.theme,
    "jff.accent.v1": storageKeys.accent,
    "jff.clearAfterCopy.v1": storageKeys.clearAfterCopy,
    "jff.tutorialHidden.v1": storageKeys.tutorialHidden,
};

function migrateStorageKeys() {
    let store;

    try {
        store = window.localStorage;
    } catch {
        /* A blocked store has nothing to move, and the page still loads. */
        return;
    }

    for (const [oldKey, newKey] of Object.entries(legacyStorageKeys)) {
        try {
            const value = store.getItem(oldKey);

            if (value === null) continue;

            /* The new name is the one being read, so it outranks the old. */
            if (store.getItem(newKey) === null) store.setItem(newKey, value);

            store.removeItem(oldKey);
        } catch {
            /* The move is best effort; a full store keeps the old value. */
        }
    }
}

migrateStorageKeys();
