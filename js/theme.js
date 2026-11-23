/* Light and dark themes.
   Loaded in the head, before the stylesheet, so the saved choice is on the
   root before the first paint. Dark is the default and the only fallback: a
   missing or unreadable store, or a value this file does not know, starts
   dark rather than following the system preference. */

const themeRoot = document.documentElement;

/*
 * Storage can throw on access as well as on write, so the read is guarded and
 * a refusal is simply no saved theme.
 */
function readStoredTheme() {
    try {
        return window.localStorage.getItem(storageKeys.theme);
    } catch {
        return null;
    }
}

function persistTheme(theme) {
    try {
        window.localStorage.setItem(storageKeys.theme, theme);
    } catch {
        /* The theme still applies; only the choice is lost at the reload. */
    }
}

function applyTheme(theme) {
    themeRoot.dataset.theme = theme;
}

applyTheme(readStoredTheme() === "light" ? "light" : "dark");

/* ---------- Accent colour (initial paint) ---------- */

const defaultAccent = "#1a7f37";

/* The wheel and the store both speak a six-digit hex colour, nothing else. */
function validAccent(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/*
 * The ink sits on an accent fill (a primary dialog button, the pressed
 * toolbar state), so it is derived rather than chosen: black or white,
 * whichever clears WCAG by more against the accent's relative luminance.
 */
function accentInk(hex) {
    const value = hex.slice(1);

    const linear = (start) => {
        const c = parseInt(value.slice(start, start + 2), 16) / 255;

        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };

    const luminance =
        0.2126 * linear(0) + 0.7152 * linear(2) + 0.0722 * linear(4);

    const againstBlack = (luminance + 0.05) / 0.05;
    const againstWhite = 1.05 / (luminance + 0.05);

    return againstBlack >= againstWhite ? "#111" : "#fff";
}

function accentRgb(hex) {
    const value = hex.slice(1);
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);

    return `${r}, ${g}, ${b}`;
}

function readStoredAccent() {
    try {
        return window.localStorage.getItem(storageKeys.accent);
    } catch {
        return null;
    }
}

/* Inline on the root before first paint, so custom accents never flash green. */
function applyAccentRoot(hex) {
    themeRoot.style.setProperty("--accent", hex);
    themeRoot.style.setProperty("--accent-ink", accentInk(hex));
    themeRoot.style.setProperty("--accent-rgb", accentRgb(hex));
}

const initialAccent = readStoredAccent();
applyAccentRoot(validAccent(initialAccent) ? initialAccent : defaultAccent);

/*
 * The toggle is in the Settings dialog, which does not exist yet in the head.
 * Its state is the theme itself rather than a separate flag, so a restored
 * light theme opens with the switch already on.
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
