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
    if (typeof currentAccentHex === "string") {
        applyAccentRoot(currentAccentHex);
    }
}

/* ---------- Accent colour (initial paint) ---------- */

const defaultAccent = "#1a7f37";
let currentAccentHex = defaultAccent;

/* The wheel and the store both speak a six-digit hex colour, nothing else. */
function validAccent(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function hexToRgbTuple(hex) {
    const value = hex.slice(1);

    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
    ];
}

function rgbTupleToHex(r, g, b) {
    const toHex = (n) =>
        Math.round(Math.max(0, Math.min(255, n)))
            .toString(16)
            .padStart(2, "0");

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function relativeLuminance(r, g, b) {
    const linear = (channel) => {
        const c = channel / 255;

        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(lumA, lumB) {
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);

    return (lighter + 0.05) / (darker + 0.05);
}

/*
 * The ink sits on an accent fill (a primary dialog button, the pressed
 * toolbar state), so it is derived rather than chosen: black or white,
 * whichever clears WCAG by more against the accent's relative luminance.
 */
function accentInk(hex) {
    const [r, g, b] = hexToRgbTuple(hex);
    const luminance = relativeLuminance(r, g, b);

    const againstBlack = (luminance + 0.05) / 0.05;
    const againstWhite = 1.05 / (luminance + 0.05);

    return againstBlack >= againstWhite ? "#111" : "#fff";
}

function accentRgb(hex) {
    const [r, g, b] = hexToRgbTuple(hex);

    return `${r}, ${g}, ${b}`;
}

/*
 * Mixes a custom accent toward a high-contrast target (light text on dark
 * panels, dark text on light panels) until it meets the target WCAG contrast
 * ratio, so extreme custom accents stay readable for text and focus rings.
 */
function accessibleAccentColor(hex, isLight, minRatio) {
    const [r, g, b] = hexToRgbTuple(hex);
    const bg = isLight ? [255, 255, 255] : [38, 42, 49];
    const target = isLight ? [28, 31, 36] : [228, 231, 235];
    const bgLum = relativeLuminance(bg[0], bg[1], bg[2]);

    if (contrastRatio(relativeLuminance(r, g, b), bgLum) >= minRatio) {
        return hex;
    }

    let low = 0;
    let high = 1;

    for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        const mr = r + (target[0] - r) * mid;
        const mg = g + (target[1] - g) * mid;
        const mb = b + (target[2] - b) * mid;

        if (contrastRatio(relativeLuminance(mr, mg, mb), bgLum) >= minRatio) {
            high = mid;
        } else {
            low = mid;
        }
    }

    return rgbTupleToHex(
        r + (target[0] - r) * high,
        g + (target[1] - g) * high,
        b + (target[2] - b) * high,
    );
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
    currentAccentHex = hex;
    const isLight = themeRoot.dataset.theme === "light";

    themeRoot.style.setProperty("--accent", hex);
    themeRoot.style.setProperty("--accent-ink", accentInk(hex));
    themeRoot.style.setProperty("--accent-rgb", accentRgb(hex));
    themeRoot.style.setProperty(
        "--accent-text",
        accessibleAccentColor(hex, isLight, 4.5),
    );
    themeRoot.style.setProperty(
        "--accent-focus",
        accessibleAccentColor(hex, isLight, 3.0),
    );
}

applyTheme(readStoredTheme() === "light" ? "light" : "dark");
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
        const isLight = themeRoot.dataset.theme === "light";

        themeToggle.setAttribute("aria-checked", String(isLight));
        themeToggle.title = isLight
            ? "Switch to dark mode"
            : "Switch to light mode";
    }

    themeToggle.addEventListener("click", () => {
        const next = themeRoot.dataset.theme === "light" ? "dark" : "light";

        applyTheme(next);
        syncThemeToggle();
        persistTheme(next);
    });

    syncThemeToggle();
});
