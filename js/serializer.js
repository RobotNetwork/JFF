/* ServiceNow [code] serializer.
   Split out of app.js, lines 2875-3347. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- ServiceNow serializer ---------- */

const inlineTags = new Set([
    "b",
    "strong",
    "i",
    "em",
    "s",
    "strike",
    "del",
    "u",
    "ins",
    "code",
    "a",
]);

const blockTags = new Set([
    "pre",
    "blockquote",
    "ul",
    "ol",
    ...headingLevels,
]);

/*
 * Elements that end a line inside a code block. Clipboard paste carries
 * line structure as <br>, rich text paste carries it as whole blocks, and
 * neither survives textContent.
 */
const codeBreakTags = new Set([
    "br",
    "p",
    "div",
    "li",
    "blockquote",
    ...headingLevels,
]);

const codeBreakSelector = [...codeBreakTags].join(", ");

/*
 * The delimiter ServiceNow reads as a code region. The three places that
 * spell it out - minting it in wrapCode, splitting it back out in codeRegion,
 * and breaking one typed as prose in serializeText - all derive from these,
 * so the wire format has one definition and no site can drift alone.
 */
const codeTag = "code";
const codeOpen = `[${codeTag}]`;
const codeClose = `[/${codeTag}]`;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/*
 * split() keeps the captured [code] regions at odd indices. Only the prose
 * is tidied, so code keeps its trailing whitespace and blank lines.
 * Matching is case-insensitive to align with ServiceNow's [code] parser.
 */
const codeRegion = new RegExp(
    `(${escapeRegExp(codeOpen)}[\\s\\S]*?${escapeRegExp(codeClose)})`,
    "i",
);

/* A delimiter typed as prose or inside HTML, whole, so it can be neutralized. */
const typedCodeDelimiter = new RegExp(
    `${escapeRegExp(codeOpen)}|${escapeRegExp(codeClose)}`,
    "gi",
);

/*
 * Inside [code] ServiceNow renders HTML, so replacing the leading bracket of
 * any case-insensitive [code] or [/code] delimiter with its numeric entity
 * prevents it from terminating the outer region while rendering the literal
 * ASCII bracket in ServiceNow and the preview.
 */
function escapeCodeDelimiters(html) {
    return html.replace(typedCodeDelimiter, (delimiter) =>
        delimiter.replace("[", "&#91;"),
    );
}

function wrapCode(html) {
    return html ? `${codeOpen}${escapeCodeDelimiters(html)}${codeClose}` : "";
}

function normalizeHref(value) {
    const href = value.trim();

    if (!href || /[\s\u0000-\u001f]/.test(href)) return "";

    if (/^https?:\/\/[^/\\]/i.test(href)) {
        try {
            const url = new URL(href);
            return url.hostname ? href : "";
        } catch {
            return "";
        }
    }

    if (/^mailto:[^\s@]+@[^\s@]+/i.test(href)) return href;

    if (/^tel:[+\d().\-*#]+$/i.test(href) && /\d/.test(href)) return href;

    if (href.startsWith("#") && href.length > 1) return href;

    /*
     * A single leading slash is a same-site path. Two of them, or a slash
     * followed by a backslash, is resolved off-host by the browser.
     */
    if (
        href.startsWith("/") &&
        !href.startsWith("//") &&
        !href.startsWith("/\\")
    ) {
        return href;
    }

    return "";
}

function isAbsoluteHref(href) {
    return /^(?:https?:\/\/|mailto:|tel:)/i.test(href);
}

/*
 * Word and Outlook autocorrect run before the paste reaches the browser, so
 * a code sample arrives with typographic punctuation: curly quotes, en and
 * em dashes, an ellipsis. Those characters break the code once it is pasted
 * out of ServiceNow, and inside [code] a straight ASCII character is what
 * was meant. Outside it the journal shows the text as written, which is
 * proper typography in prose, so this is scoped to code.
 */
const codeTypography = [
    [/\u200b|\u200c|\u200d|\ufeff/g, ""],
    [/\u00a0/g, " "],
    [/\u2018|\u2019|\u201b/g, "'"],
    [/\u201c|\u201d|\u201f/g, '"'],
    [/\u2026/g, "..."],
    [/\u2013/g, "-"],
    [/\u2014/g, "--"],
];

function normalizeCodePunctuation(text) {
    return codeTypography.reduce(
        (value, [pattern, replacement]) =>
            value.replace(pattern, replacement),
        text,
    );
}

function neutralizeProseDelimiters(text) {
    /*
     * Outside [code] the journal shows the text as written, so escaping
     * there would display entities instead of the characters typed. A
     * delimiter written as literal prose would still mint a live region
     * downstream, though, so a zero-width space after the bracket breaks it
     * for the renderer while staying invisible. The zero-width spaces that
     * hold a caret beside an inline code span are invisible too, and they are
     * dropped before the delimiters are rewritten. Running this on assembled
     * prose chunks prevents split text nodes or empty inline elements from
     * forging a live [code] or [/code] delimiter.
     */
    return text
        .replace(/\u200b/g, "")
        .replace(typedCodeDelimiter, (delimiter) =>
            delimiter.replace("[", "[\u200b"),
        );
}

function serializeText(node, insideCode, inCodeElement = false) {
    const text = node.textContent.replace(/\u00a0/g, " ");

    if (insideCode) {
        /*
         * Inside [code] ServiceNow renders HTML, so literal characters must
         * be escaped and [code]/[/code] delimiters neutralized as entities.
         * Typographic punctuation normalization (curly quotes, dashes, zero-
         * width characters) is scoped to actual <code>/<pre> elements so
         * formatted prose and ZWJ emojis survive intact.
         */
        const clean = inCodeElement
            ? normalizeCodePunctuation(text)
            : text.replace(/\u200b/g, "");

        return escapeCodeDelimiters(escapeHtml(clean));
    }

    return neutralizeProseDelimiters(text);
}

/*
 * A paragraph-like block inside [code]: its own end supplies the line break,
 * so no separator is needed between blocks of another kind.
 */
function isParagraphBlock(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;

    const tag = node.tagName.toLowerCase();

    return tag === "p" || tag === "div";
}

/*
 * Inside [code] line structure is explicit: ServiceNow strips newlines and
 * <br>, so a paragraph is separated from its siblings by an empty <p></p>
 * rather than by a newline. Outside [code] the newline each block appends is
 * the break, and no separator is inserted.
 */
function serializeChildren(node, insideCode, inCodeElement = false) {
    let html = "";
    let previous = null;

    for (const child of node.childNodes) {
        const part = serializeNode(child, insideCode, inCodeElement);

        if (
            insideCode &&
            previous &&
            part !== "" &&
            !html.endsWith("<p></p>") &&
            (isParagraphBlock(previous) || isParagraphBlock(child))
        ) {
            html += "<p></p>";
        }

        html += part;

        if (part !== "") previous = child;
    }

    return html;
}

function codeText(element) {
    let text = "";

    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.data;
            continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = node.tagName.toLowerCase();

        if (tag === "br") {
            text += "\n";
        } else if (codeBreakTags.has(tag)) {
            if (text && !text.endsWith("\n")) {
                text += "\n";
            }

            text += `${codeText(node)}\n`;
        } else {
            text += codeText(node);
        }
    }

    return text;
}

const sentinelBrParents = new Set([
    "p",
    "div",
    "li",
    "blockquote",
    ...headingLevels,
]);

function isSentinelBr(node) {
    const parent = node.parentNode;

    if (
        !parent ||
        parent.nodeType !== Node.ELEMENT_NODE ||
        !sentinelBrParents.has(parent.tagName.toLowerCase())
    ) {
        return false;
    }

    for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE) return false;
        if (
            sibling.nodeType === Node.TEXT_NODE &&
            sibling.textContent.replace(/\u200b/g, "") !== ""
        ) {
            return false;
        }
    }

    return true;
}

function serializeHtmlElement(element, inCodeElement = false) {
    const tag = element.tagName.toLowerCase();

    if (tag === "pre") {
        /*
         * codeText descends through a <code> child and over <br> and block
         * children, so a pre keeps every sibling of its code child instead
         * of dropping all but the first. Computing it here also avoids a
         * full child walk that the switch would otherwise discard.
         */
        const text = normalizeCodePunctuation(
            codeText(element).replace(/^\n+|\n+$/g, ""),
        );

        return `<pre><code>${escapeCodeDelimiters(escapeHtml(text))}</code></pre>`;
    }

    const inner = serializeChildren(
        element,
        true,
        inCodeElement || tag === "code",
    );

    /*
     * ServiceNow keeps the level it is given, so an h1 stays an h1 instead of
     * being rewritten to h3 or demoted to bold.
     */
    if (headingLevels.includes(tag)) {
        return `<${tag}>${inner}</${tag}>`;
    }

    switch (tag) {
        case "b":
        case "strong":
            return inner ? `<b>${inner}</b>` : "";

        case "i":
        case "em":
            return inner ? `<em>${inner}</em>` : "";

        case "s":
        case "strike":
        case "del":
            return inner ? `<strike>${inner}</strike>` : "";

        case "u":
        case "ins":
            return inner ? `<u>${inner}</u>` : "";

        case "code":
            // Intentionally bold inline code for ServiceNow readability.
            return inner ? `<b><code>${inner}</code></b>` : "";

        case "blockquote":
            return `<blockquote>${inner}</blockquote>`;

        case "a": {
            const href = normalizeHref(
                element.getAttribute("href") || "",
            );

            if (!href) return inner;
            if (!inner) return "";

            const safeHref = href.replace(
                /^(https?:\/\/\[[0-9a-f:.]+\])|[\[\]]/gi,
                (match, ipv6) => ipv6 || (match === "[" ? "%5B" : "%5D"),
            );

            return `<a href="${escapeAttr(safeHref)}">${inner}</a>`;
        }

        case "ul":
        case "ol":
            return `<${tag}>${inner}</${tag}>`;

        case "li":
            return `<li>${inner}</li>`;

        case "br":
            /*
             * Browser sentinel <br> tags at the end of empty or trailing blocks
             * are placeholders for the caret, not real line breaks.
             */
            if (isSentinelBr(element)) return "";

            /*
             * ServiceNow strips ordinary newlines and <br> inside [code].
             * This is one of the few places where <p></p> is necessary.
             */
            return "<p></p>";

        case "p":
        case "div":
            return inner;

        default:
            return inner;
    }
}

function serializeNode(node, insideCode = false, inCodeElement = false) {
    if (node.nodeType === Node.TEXT_NODE) {
        return serializeText(node, insideCode, inCodeElement);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    const tag = node.tagName.toLowerCase();

    if (insideCode) {
        return serializeHtmlElement(node, inCodeElement);
    }

    if (tag === "p" || tag === "div") {
        const content = serializeChildren(node, false);

        if (!content) return "\n";

        /*
         * A block that already ends with a child's newline - a list or a
         * blockquote wrapped in a paragraph - must not add a second one,
         * which would show up as a blank line before whatever follows.
         */
        return content.endsWith("\n") ? content : `${content}\n`;
    }

    /*
     * A list item outside a list carries its own line, so a fragment of bare
     * <li> elements does not serialize as one joined line.
     */
    if (tag === "li") {
        const content = serializeChildren(node, false);

        return content ? `${content}\n` : "\n";
    }

    if (tag === "br") {
        return "\n";
    }

    if (inlineTags.has(tag) || blockTags.has(tag)) {
        const html = serializeHtmlElement(node);

        if (!html) return "";

        const suffix = blockTags.has(tag) ? "\n" : "";

        return `${wrapCode(html)}${suffix}`;
    }

    return serializeChildren(node, false);
}

function tidyProse(text) {
    return text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
}

/*
 * The preview's content, built from the serialized markup rather than from the
 * editor a second time: the entry is what ServiceNow will hold, and a preview
 * taken from anywhere else could agree with the editor while disagreeing with
 * the field.
 *
 * The [code] delimiters come off, since ServiceNow reads them rather than
 * showing them, and what they held is the HTML it renders. Everywhere else the
 * markup is kept as it is and each newline becomes the line break the captured
 * page shows: ServiceNow stores the entry and renders it, so a newline between
 * two blocks is a <br> on screen.
 */
const mirrorAllowedTags = new Set([
    "b",
    "em",
    "strike",
    "u",
    "code",
    "pre",
    "blockquote",
    "a",
    "ul",
    "ol",
    "li",
    "p",
    "br",
    ...headingLevels,
]);

function sanitizeMirrorFragment(root) {
    for (const element of [...root.querySelectorAll("*")]) {
        const tag = element.tagName.toLowerCase();

        if (!mirrorAllowedTags.has(tag)) {
            element.remove();
            continue;
        }

        for (const attribute of [...element.attributes]) {
            const isAllowedHref =
                tag === "a" &&
                attribute.name.toLowerCase() === "href" &&
                normalizeHref(attribute.value) !== "";

            if (!isAllowedHref) {
                element.removeAttribute(attribute.name);
            }
        }

        if (tag === "a") {
            if (!element.hasAttribute("href")) {
                element.replaceWith(...element.childNodes);
            } else {
                element.target = "_blank";
                element.rel = "noopener noreferrer";
            }
        }
    }
}

function mirrorNodes(body) {
    const fragment = document.createDocumentFragment();

    body.split(codeRegion).forEach((part, index) => {
        if (part === "") return;

        if (index % 2 === 0) {
            fragment.append(linesToBreaks(part));
            return;
        }

        const region = document.createElement("template");

        region.innerHTML = part.slice(codeOpen.length, -codeClose.length);
        sanitizeMirrorFragment(region.content);

        fragment.append(region.content);
    });

    return fragment;
}

/*
 * Prose with its newlines rendered as line breaks. Plain text outside [code]
 * is rendered literally by ServiceNow, so it is built directly from Text nodes
 * and <br> elements without parsing HTML.
 */
function linesToBreaks(text) {
    const lines = document.createDocumentFragment();

    text.split("\n").forEach((line, index) => {
        if (index > 0) lines.append(document.createElement("br"));
        if (line) lines.append(document.createTextNode(line));
    });

    return lines;
}

function renderMirror(body) {
    mirror.replaceChildren(mirrorNodes(body));
    mirror.classList.toggle("is-empty", body === "");
    previewRaw.textContent = body;
}

function pushProsePart(parts, text) {
    if (!text) return;

    const last = parts[parts.length - 1];

    if (last && last.type === "prose") {
        last.text += text;
    } else {
        parts.push({ type: "prose", text });
    }
}

function partsEndWithNewline(parts) {
    const last = parts[parts.length - 1];

    return Boolean(last && last.type === "prose" && last.text.endsWith("\n"));
}

/*
 * Collects top-level prose and minted [code] chunks separately so adjacent
 * prose nodes (including ones separated by empty inline elements) are merged
 * and neutralized as a single string before joining with minted [code] blocks.
 */
function collectSerializedParts(node, parts) {
    if (node.nodeType === Node.TEXT_NODE) {
        pushProsePart(parts, node.textContent.replace(/\u00a0/g, " "));
        return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
    }

    const tag = node.tagName.toLowerCase();

    if (tag === "p" || tag === "div") {
        const startLen = parts.length;
        const startTextLen =
            startLen > 0 && parts[startLen - 1].type === "prose"
                ? parts[startLen - 1].text.length
                : 0;

        for (const child of node.childNodes) {
            collectSerializedParts(child, parts);
        }

        const addedNothing =
            parts.length === startLen &&
            (startLen === 0 ||
                parts[startLen - 1].type !== "prose" ||
                parts[startLen - 1].text.length === startTextLen);

        if (addedNothing || !partsEndWithNewline(parts)) {
            pushProsePart(parts, "\n");
        }

        return;
    }

    if (tag === "li") {
        for (const child of node.childNodes) {
            collectSerializedParts(child, parts);
        }

        pushProsePart(parts, "\n");
        return;
    }

    if (tag === "br") {
        pushProsePart(parts, "\n");
        return;
    }

    if (inlineTags.has(tag) || blockTags.has(tag)) {
        const html = serializeHtmlElement(node);

        if (!html) return;

        parts.push({ type: "code", text: wrapCode(html) });

        if (blockTags.has(tag)) {
            pushProsePart(parts, "\n");
        }

        return;
    }

    for (const child of node.childNodes) {
        collectSerializedParts(child, parts);
    }
}

/*
 * What the entry serializes to. Blank lines at either end come from an empty
 * first or last block and are dropped, but the indentation of the first line is
 * not: it is what survives of a pasted snippet's leading whitespace.
 */
function serializedBody() {
    const parts = [];

    for (const child of editor.childNodes) {
        collectSerializedParts(child, parts);
    }

    return parts
        .map((part) =>
            part.type === "code"
                ? part.text
                : tidyProse(neutralizeProseDelimiters(part.text)),
        )
        .join("")
        .replace(/^[ \t]*\n+/, "")
        .replace(/\n+[ \t]*$/, "")
        .replace(/[ \t]+$/, "");
}

function render() {
    const body = serializedBody();

    /*
     * The preview is rendered only while it is open. It is a dialog that is
     * closed until it is asked for, and rebuilding a viewport nobody is
     * looking at on every keystroke is work for nothing; opening it renders
     * it, so the one on screen is the current entry either way.
     */
    if (previewOpen) renderMirror(body);

    for (const button of copyButtons) button.disabled = body === "";

    /* Nothing to show is the one reason the Preview button is out. */
    const empty = editorIsEmpty();

    previewBtn.disabled = empty;

    /* Nothing to save is the one reason the menu's Save current is out. */
    savedSaveBtn.disabled = empty;

    if (typeof updateSavedToggleState === "function") {
        updateSavedToggleState();
    }

    if (clearBtn) clearBtn.disabled = empty;

    /*
     * render() is the one hook every content change already runs, so the
     * placeholder and the saved entry are refreshed here rather than at each
     * call site.
     */
    updatePlaceholder();
    queueSave();
}
