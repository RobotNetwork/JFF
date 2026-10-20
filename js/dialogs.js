/* Link dialog and the shortcut reference dialog.
   Split out of app.js, lines 649-967. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Link dialog ---------- */

/*
 * The link being built or edited while the dialog is open. Null outside it.
 * The range is the cloned selection, editing is the link the command was run
 * on, and href stays empty until the form is submitted, which is what
 * separates a confirmed link from a cancelled one.
 */
let pendingLink = null;

/*
 * A press that starts on the dialog box rather than on the form is a press on
 * the backdrop: the box is transparent and unpadded, so anything between the
 * form and the edge is backdrop. Tracking where the press began keeps a text
 * selection dragged out of a field, or off the shortcut list, from being read
 * as a click outside, which would close the dialog and throw the field away.
 */
function closeOnBackdrop(dialog, close) {
    let pressed = false;

    dialog.addEventListener("pointerdown", (event) => {
        pressed = event.target === dialog;
    });

    dialog.addEventListener("click", (event) => {
        if (pressed && event.target === dialog) close();

        pressed = false;
    });

    /* Escape and the dialog's own buttons close it too, and a press that was
       in flight when they did must not be judged later. */
    dialog.addEventListener("close", () => {
        pressed = false;
    });
}

function openLinkDialog(range, anchor) {
    const href = anchor ? normalizeHref(anchor.getAttribute("href") || "") : "";

    pendingLink = {
        range,
        collapsed: range.collapsed,
        editing: anchor,
        remove: false,
        href: "",
        text: "",
    };

    linkError.hidden = true;
    linkUrl.value = href;
    linkText.value = "";

    /* An existing selection already supplies the link text. */
    linkTextRow.hidden = !range.collapsed;

    /* There is only something to remove when a link was run on. */
    linkRemove.hidden = !anchor;

    linkDialog.showModal();
    linkUrl.focus();

    /* The caret lands after the URL rather than on all of it, so a correction
       does not start by wiping the value. */
    linkUrl.setSelectionRange(href.length, href.length);
}

function restoreLinkSelection(range) {
    editor.focus();

    const selection = window.getSelection();

    selection.removeAllRanges();
    selection.addRange(range);
}

/*
 * Removing a link keeps the text it held. The range the dialog was opened
 * with points into the children, which survive the unwrap, so the caret is
 * already sitting where the link was.
 */
function removeLink(anchor) {
    if (!anchor || !anchor.isConnected) return;

    anchor.replaceWith(...anchor.childNodes);
}

function closeLinkDialog() {
    if (linkDialog.open) linkDialog.close();
}

linkForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!pendingLink) return;

    const href = normalizeHref(linkUrl.value);

    if (!href) {
        linkError.hidden = false;
        linkUrl.focus();
        return;
    }

    /*
     * The URL is validated before it reaches the DOM, so the editor never
     * holds a link the serializer would have to reject anyway.
     */
    pendingLink.href = href;
    pendingLink.text = linkText.value.trim();

    closeLinkDialog();
});

linkCancel.addEventListener("click", closeLinkDialog);

/* Removal is a decision of its own, so it leaves through the same close path
   as Insert rather than sharing the form's submit validation. */
linkRemove.addEventListener("click", () => {
    if (!pendingLink) return;

    pendingLink.remove = true;
    closeLinkDialog();
});

closeOnBackdrop(linkDialog, closeLinkDialog);

/*
 * The dialog is already closed by the time this runs, whether it went
 * through the form, Escape, or the backdrop, so the editor can take focus
 * back and the deferred command can finish.
 */
linkDialog.addEventListener("close", () => {
    const pending = pendingLink;

    pendingLink = null;
    linkError.hidden = true;

    if (!pending) return;

    restoreLinkSelection(pending.range);

    if (pending.remove) {
        removeLink(pending.editing);

        queueSnapshot();
        render();
        updateToolbarState();
        return;
    }

    if (!pending.href) return;

    /*
     * The command was run on a link, so that link's href is replaced rather
     * than a second one built around the selection: the words being looked
     * at already belong to the link, and createLink would build another one
     * over them.
     */
    if (pending.editing) {
        pending.editing.setAttribute("href", pending.href);

        queueSnapshot();
        render();
        updateToolbarState();
        return;
    }

    if (pending.collapsed) {
        const text = pending.text || pending.href;

        insertHtmlAtCursor(
            `<a href="${escapeAttr(pending.href)}">${escapeHtml(text)}</a>&nbsp;`,
        );
        return;
    }

    document.execCommand("createLink", false, pending.href);

    queueSnapshot();
    render();
    updateToolbarState();
});

/* ---------- Shortcut reference ---------- */

/*
 * The reference is built from editingShortcuts, so a chord recorded there
 * appears here without a second edit, and the name comes from the toolbar
 * button that runs the same command, so a command has one name.
 */
const extraShortcuts = [
    // example:
    // {
    //     keys: "KEY",
    //     label: "description",
    // },
];

/* A code names the physical key, which is not the character it produces. */
const chordKeys = {
    Digit1: "1",
    Digit2: "2",
    Digit3: "3",
    Digit4: "4",
    Digit5: "5",
    Digit6: "6",
    Digit7: "7",
    Digit8: "8",
    Backquote: "`",
    Backslash: "\\",
    Period: ">",
    Slash: "/",
};

/*
 * The name of a shortcut: the label of the control that runs the same
 * command, so a command has one name. A shortcut with no control - undo and
 * redo - carries its own.
 */
function shortcutName(shortcut) {
    if (shortcut.label) return shortcut.label;

    const selector = shortcut.val
        ? `button[data-cmd="${shortcut.cmd}"][data-val="${shortcut.val}"]`
        : `button[data-cmd="${shortcut.cmd}"]:not([data-val])`;
    /* Copy and Help sit outside the toolbar, so the search is not limited to
       it; the label on whichever button runs the command is its name. */
    const button = document.querySelector(selector);

    return (
        (button && button.getAttribute("aria-label")) || shortcut.cmd
    );
}

function chordLabel(shortcut) {
    const parts = ["Ctrl"];

    if (shortcut.shift) parts.push("Shift");
    if (shortcut.alt) parts.push("Alt");

    parts.push(
        shortcut.code
            ? chordKeys[shortcut.code] || shortcut.code
            : shortcut.key.toUpperCase(),
    );

    return parts.join("+");
}

/* The chord and name of a numbered run, as one entry. Six heading rows would
   repeat the same chord shape, so the reference reads the range instead. */
function shortcutRange(shortcut, count) {
    const chord = chordLabel(shortcut);
    const name = shortcutName(shortcut);

    return [
        `${chord.slice(0, chord.lastIndexOf("+") + 1)}1-${count}`,
        `${name.replace(/\s*\d+$/, "")} 1-${count}`,
    ];
}

function buildShortcutList() {
    const headingShortcuts = editingShortcuts.filter(
        (shortcut) =>
            shortcut.alt &&
            shortcut.cmd === "formatBlock" &&
            headingLevels.includes(shortcut.val),
    );
    const rows = [];

    for (const shortcut of editingShortcuts) {
        if (!headingShortcuts.includes(shortcut)) {
            rows.push([chordLabel(shortcut), shortcutName(shortcut)]);
        } else if (shortcut === headingShortcuts[0]) {
            /*
             * The table keeps one entry per heading level so matching stays
             * exact; the reference shows the levels on one line.
             */
            rows.push(shortcutRange(shortcut, headingShortcuts.length));
        }
    }

    rows.push(...extraShortcuts.map(({ keys, label }) => [keys, label]));

    for (const [keys, label] of rows) {
        const item = document.createElement("li");
        const chord = document.createElement("span");
        const name = document.createElement("span");

        chord.className = "shortcut-keys";
        chord.textContent = keys;
        name.textContent = label;

        item.append(chord, name);
        shortcutList.append(item);
    }
}

/*
 * The entry recording a command, or null. The value narrows it: Ctrl+Alt+1 is
 * the h1 command, not the blockquote one.
 */
function shortcutFor(cmd, value) {
    return editingShortcuts.find(
        (entry) =>
            entry.cmd === cmd &&
            (value === undefined
                ? entry.val === undefined
                : entry.val === value),
    );
}

/*
 * The hover text of every button that carries an aria-label: the label names
 * it, and the chord comes from the table the dialog is built from. Tooltips
 * used to spell the chords out by hand, so rebinding one in the table left
 * the tooltip advertising the old key.
 */
function buildTooltips() {
    for (const button of document.querySelectorAll("button[aria-label]")) {
        const { cmd, val } = button.dataset;
        const shortcut = cmd ? shortcutFor(cmd, val) : null;
        const name = button.getAttribute("aria-label");

        button.title = shortcut ? `${name} (${chordLabel(shortcut)})` : name;
    }
}
