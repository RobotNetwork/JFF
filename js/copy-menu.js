/* Copy settings menu.
   Split out of app.js, lines 3706-3854. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Copy settings menu ---------- */

/*
 * The one copy preference is a checkable item in each Copy button's menu
 * rather than a checkbox of its own. It is held here and mirrored onto every
 * item's aria-checked, which is also what draws the checkmark.
 */
let clearAfterCopyEnabled = false;

function setClearAfterCopy(enabled) {
    clearAfterCopyEnabled = enabled;

    for (const item of clearAfterCopyItems) {
        item.setAttribute("aria-checked", String(enabled));
    }
}

/*
 * The panel is wider than the control it hangs from, and the control lands at
 * the start of a toolbar row as soon as the toolbar wraps, which would hang a
 * right-aligned panel past the left edge of the window. Right-aligned is the
 * resting state; an open menu whose left edge would leave the window opens to
 * the right of its control instead.
 */
const menuGutter = 8;

function setCopyMenuOpen(menu, toggle, open, focusItem = false) {
    menu.hidden = !open;

    /* Cleared first, so every open measures the resting position. */
    menu.style.left = "";
    menu.style.right = "";

    if (open && menu.getBoundingClientRect().left < menuGutter) {
        menu.style.left = "0";
        menu.style.right = "auto";
    }

    toggle.setAttribute("aria-expanded", String(open));

    if (open && focusItem) {
        menu.querySelector(".clear-after-copy-item").focus();
    }
}

function closeCopyMenus() {
    for (const { menu, toggle } of copyMenuControls) {
        if (!menu.hidden) setCopyMenuOpen(menu, toggle, false);
    }
}

/*
 * Two Copy controls run the one command: the toolbar's and the preview head's.
 * Each carries its own menu and they share the setting between them, so the
 * preference reads the same in both places. Both toggles are wired directly:
 * the toolbar's is not the heading toggle, which the toolbar handler owns.
 */
const copyMenuControls = copyDropdowns.map((dropdown) => {
    const toggle = dropdown.querySelector(".copy-toggle");
    const menu = dropdown.querySelector(".copy-menu");
    const item = dropdown.querySelector(".clear-after-copy-item");

    toggle.addEventListener("click", (event) => {
        const opening = menu.hidden;

        closeCopyMenus();

        /* Keyboard activation opens onto the item, so a second Enter may toggle it. */
        if (opening) setCopyMenuOpen(menu, toggle, true, event.detail === 0);
    });

    item.addEventListener("click", () => {
        setClearAfterCopy(!clearAfterCopyEnabled);
        setCopyMenuOpen(menu, toggle, false);
        toggle.focus();
    });

    /* Escape returns to the toggle; Tab closes and moves on, as with the toolbar. */
    menu.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            setCopyMenuOpen(menu, toggle, false);
            toggle.focus();
            return;
        }

        if (event.key === "Tab") setCopyMenuOpen(menu, toggle, false);
    });

    return { menu, toggle };
});

/*
 * The legacy command is the fallback for navigator.clipboard being undefined
 * on a non-secure origin, and for a rejected write. It works from a temporary
 * selection, so the reader's own selection is left alone.
 */
function copyViaExecCommand(text) {
    const area = document.createElement("textarea");

    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.top = "-1000px";

    document.body.appendChild(area);
    area.select();

    let copied = false;

    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }

    area.remove();

    return copied;
}

/*
 * Reached by the button and by the chord, so the copy itself is not the
 * button's handler.
 */
async function copyOutput() {
    closeCopyMenus();

    const text = serializedBody();

    let copied = false;

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            copied = true;
        }
    } catch {
        copied = false;
    }

    if (!copied) copied = copyViaExecCommand(text);

    showNotice(
        copied
            ? "Copied to clipboard!"
            : "Could not copy markdown to clipboard.",
    );

    /* The one-step loop: copy and the entry resets itself for the next one. */
    if (copied && clearAfterCopyEnabled) clearEntry();
}
