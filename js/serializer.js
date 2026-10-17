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

function wrapCode(html) {
    return html ? `${codeOpen}${html}${codeClose}` : "";
}

function normalizeHref(value) {
    const href = value.trim();

    if (/^(https?:|mailto:|tel:)/i.test(href)) return href;

    if (href.startsWith("#")) return href;

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

function serializeText(node, insideCode) {
    const text = node.textContent.replace(/\u00a0/g, " ");

    if (insideCode) {
        /*
         * Inside [code] ServiceNow renders HTML, so literal characters must
         * be escaped.
         */
        return escapeHtml(normalizeCodePunctuation(text));
    }

    /*
     * Outside [code] the journal shows the text as written, so escaping
     * there would display entities instead of the characters typed. A
     * delimiter written as literal prose would still mint a live region
     * downstream, though, so a zero-width space after the bracket breaks it
     * for the renderer while staying invisible. The zero-width spaces that
     * hold a caret beside an inline code span are invisible too, and they are
     * dropped before the delimiters are rewritten. This runs in the prose
     * branch only: the regions the app builds are minted later by wrapCode
     * and are left untouched.
     */
    return text
        .replace(/\u200b/g, "")
        .replace(typedCodeDelimiter, (delimiter) =>
            delimiter.replace("[", "[\u200b"),
        );
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
function serializeChildren(node, insideCode) {
    let html = "";
    let previous = null;

    for (const child of node.childNodes) {
        const part = serializeNode(child, insideCode);

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

function serializeHtmlElement(element) {
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

        return `<pre><code>${escapeHtml(text)}</code></pre>`;
    }

    const inner = serializeChildren(element, true);

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
            return `<b>${inner}</b>`;

        case "i":
        case "em":
            return `<em>${inner}</em>`;

        case "s":
        case "strike":
        case "del":
            return `<strike>${inner}</strike>`;

        case "u":
        case "ins":
            return `<u>${inner}</u>`;

        case "code":
            // Intentionally bold inline code for ServiceNow readability.
            return `<b><code>${inner}</code></b>`;

        case "blockquote":
            return `<blockquote>${inner}</blockquote>`;

        case "a": {
            const href = normalizeHref(
                element.getAttribute("href") || "",
            );

            if (!href) return inner;

            return `<a href="${escapeAttr(href)}">${inner}</a>`;
        }

        case "ul":
        case "ol":
            return `<${tag}>${inner}</${tag}>`;

        case "li":
            return `<li>${inner}</li>`;

        case "br":
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

function serializeNode(node, insideCode = false) {
    if (node.nodeType === Node.TEXT_NODE) {
        return serializeText(node, insideCode);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    const tag = node.tagName.toLowerCase();

    if (insideCode) {
        return serializeHtmlElement(node);
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
        const suffix = blockTags.has(tag) ? "\n" : "";

        return `${wrapCode(html)}${suffix}`;
    }

    return serializeChildren(node, false);
}

/*
 * split() keeps the captured [code] regions at odd indices. Only the prose
 * is tidied, so code keeps its trailing whitespace and blank lines.
 */
const codeRegion = new RegExp(
    `(${escapeRegExp(codeOpen)}[\\s\\S]*?${escapeRegExp(codeClose)})`,
);

/* A delimiter typed as prose, whole, so it can be broken in the middle. */
const typedCodeDelimiter = new RegExp(
    `${escapeRegExp(codeOpen)}|${escapeRegExp(codeClose)}`,
    "gi",
);

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
        fragment.append(region.content);
    });

    return fragment;
}

/*
 * Prose with its newlines rendered as line breaks. The newlines the serializer
 * writes are text, so only text nodes are rewritten and a tag's own content is
 * left alone; a line inside a [code] region never reaches here.
 */
function linesToBreaks(html) {
    const template = document.createElement("template");

    template.innerHTML = html;

    const walker = document.createTreeWalker(
        template.content,
        NodeFilter.SHOW_TEXT,
    );
    const texts = [];

    while (walker.nextNode()) texts.push(walker.currentNode);

    for (const node of texts) {
        if (!node.data.includes("\n")) continue;

        const lines = document.createDocumentFragment();

        node.data.split("\n").forEach((line, index) => {
            if (index > 0) lines.append(document.createElement("br"));
            if (line) lines.append(document.createTextNode(line));
        });

        node.replaceWith(lines);
    }

    return template.content;
}

function renderMirror(body) {
    mirror.replaceChildren(mirrorNodes(body));
    mirror.classList.toggle("is-empty", body === "");
}

/*
 * What the entry serializes to. Blank lines at either end come from an empty
 * first or last block and are dropped, but the indentation of the first line is
 * not: it is what survives of a pasted snippet's leading whitespace.
 */
function serializedBody() {
    return serializeChildren(editor, false)
        .split(codeRegion)
        .map((part, index) => (index % 2 ? part : tidyProse(part)))
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
    previewBtn.disabled = editorIsEmpty();

    /* Nothing to save is the one reason the menu's Save current is out. */
    savedSaveBtn.disabled = editorIsEmpty();

    /*
     * render() is the one hook every content change already runs, so the
     * placeholder and the saved entry are refreshed here rather than at each
     * call site.
     */
    updatePlaceholder();
    queueSave();
}
