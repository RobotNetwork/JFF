/* Shared helpers: escaping and notices.
   Split out of app.js, lines 3550-3618. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Helpers ---------- */

function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/*
 * A line that carries code rather than prose: punctuation that only appears
 * in code, a language keyword, a call, an assignment, or indentation.
 */
const codeShapes = [
    /[;{}]|=>|==|!=|:=|<=|>=/,
    /\b(?:def|function|class|return|import|from|const|let|var|public|private|protected|static|void|int|float|double|bool|string|true|false|null|nil|print|printf|echo|console|require|await|async|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|GROUP|ORDER)\b/i,
    /[A-Za-z_$][\w$]*\s*\(/,
    /\w\s*[=<>!]=?\s*\S/,
    /^\s+\S/,
];

const codeComments = /^\s*(?:#|\/\/|--|;|%)/;

/*
 * A plain-text paste that is really a code sample should not be run through
 * the markdown parser, whatever its comment lines look like. It counts as
 * code when there are at least two lines and every non-empty line is either
 * a comment or one of the shapes above, with at least one shape rather than
 * only comments.
 */
function looksLikeCode(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");

    if (lines.length < 2) return false;

    let definite = false;

    for (const line of lines) {
        if (codeComments.test(line)) continue;

        if (!codeShapes.some((pattern) => pattern.test(line))) {
            return false;
        }

        definite = true;
    }

    return definite;
}

function looksLikeMarkdown(text) {
    const blockMarker = new RegExp(
        `^(#{1,${headingLevels.length}}\\s|[-*+]\\s|\\d+[.)]\\s|>\\s|\`\`\`)`,
        "m",
    );
    const inlineMarker =
        /(\*\*[^*]+\*\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/;

    if (!blockMarker.test(text) && !inlineMarker.test(text)) {
        return false;
    }

    return !looksLikeCode(text);
}
