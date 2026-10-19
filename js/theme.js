/* Light and dark themes.
   Loaded in the head, before the stylesheet, so the saved choice is on the
   root before the first paint. Dark is the default and the only fallback: a
   missing or unreadable store, or a value this file does not know, starts
   dark rather than following the system preference. */

const themeKey = "jff.theme.v1";
const themeRoot = document.documentElement;

/*
 * Storage can throw on access as well as on write, so the read is guarded and
 * a refusal is simply no saved theme.
 */
function readStoredTheme() {
    try {
        return window.localStorage.getItem(themeKey);
    } catch {
        return null;
    }
}

function persistTheme(theme) {
    try {
        window.localStorage.setItem(themeKey, theme);
    } catch {
        /* The theme still applies; only the choice is lost at the reload. */
    }
}

function applyTheme(theme) {
    themeRoot.dataset.theme = theme;
}

applyTheme(readStoredTheme() === "light" ? "light" : "dark");

/*
 * The toggle is in the header, which does not exist yet in the head. Its
 * state is the theme itself rather than a separate flag, so a restored light
 * theme opens with the switch already on.
 */
document.addEventListener("DOMContentLoaded", () => {
    const themeToggle = document.getElementById("themeToggle");

    function syncThemeToggle() {
        themeToggle.setAttribute(
            "aria-checked",
            String(themeRoot.dataset.theme === "light"),
        );
    }

    themeToggle.addEventListener("click", () => {
        const next = themeRoot.dataset.theme === "light" ? "dark" : "light";

        applyTheme(next);
        syncThemeToggle();
        persistTheme(next);
    });

    syncThemeToggle();
});
