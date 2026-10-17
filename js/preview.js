/* Preview dialog and journal timestamp.
   Split out of app.js, lines 3855-3910. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Preview dialog ---------- */

/*
 * The journal timestamp: local date and time with a space separator, as the
 * captured instance renders it (2026-10-16 16:17:40).
 */
function formatJournalTime(date) {
    const pad = (n) => String(n).padStart(2, "0");

    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
}

/*
 * The field is rendered as the dialog opens rather than on every keystroke
 * behind a closed one, which is what makes it never a frame behind the entry:
 * the render is taken from the editor at the moment it is shown. showModal
 * throws on a dialog that is already open, so the open state is checked
 * rather than assumed.
 */
function openPreviewDialog() {
    if (previewDialog.open) return;

    /* Nothing to show: the dialog does not open over an empty entry. */
    if (editorIsEmpty()) return;

    renderMirror(serializedBody());

    /* The timestamp is the current local time, taken as the dialog opens. */
    const now = new Date();
    journalTime.dateTime = now.toISOString();
    journalTime.textContent = formatJournalTime(now);

    previewOpen = true;
    previewDialog.showModal();

    /* The scroll well keeps its position while the dialog is closed, so a
       preview scrolled to the bottom would reopen there. Each open starts at
       the top. */
    mirrorBody.scrollTop = 0;
}

previewBtn.addEventListener("click", openPreviewDialog);

closeOnBackdrop(previewDialog, () => {
    previewDialog.close();
});

/* Every way out comes through here: the button, Escape, the backdrop, or a
   form method=dialog in some later version of this. */
previewDialog.addEventListener("close", () => {
    previewOpen = false;
});
