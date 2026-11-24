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
 * in code, a statement-leading language keyword, uppercase SQL clauses, a
 * call, an assignment, or non-list indentation.
 */
const codeShapes = [
    /[;{}]|=>|==|!=|:=|<=|>=/,
    /^\s*(?:def|function|class|return|import|const|let|var|public|private|protected|static|async|await|export|package|using)\b/,
    /^\s*from\s+[\w.]+\s+import\b/,
    /^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|INNER\s+JOIN|LEFT\s+JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\b/,
    /\b(?:console|printf|require)\s*\(/,
    /[A-Za-z_$][\w$]*\(/,
    /\w\s*[=<>!]=?\s*\S/,
    /^\s+(?![-*+]\s|\d+[.)]\s)\S/,
];

const codeComments = /^\s*(?:#|\/\/|--|;|%)/;
const markdownHeading = /^#{1,6}\s+\S/;
const markdownListOrQuote = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s)/;

/*
 * A plain-text paste that is really a code sample should not be run through
 * the markdown parser, whatever its comment lines look like. It counts as
 * code when there are at least two lines and every non-empty line is either
 * a comment or one of the shapes above, with at least one shape rather than
 * only comments (or at least two shapes when a Markdown-like `# ` heading is
 * present).
 */
function looksLikeCode(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");

    if (lines.length < 2) return false;

    let definite = 0;
    let hasHeadingLikeComment = false;

    for (const line of lines) {
        if (codeComments.test(line)) {
            if (markdownHeading.test(line)) hasHeadingLikeComment = true;
            continue;
        }

        if (markdownListOrQuote.test(line)) return false;

        if (!codeShapes.some((pattern) => pattern.test(line))) {
            return false;
        }

        definite++;
    }

    return hasHeadingLikeComment ? definite >= 2 : definite >= 1;
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
