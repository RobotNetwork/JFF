/* ServiceNow journal markup formatter.
   Load order matters: keep the <script> tag for this file where index.html
   puts it. */

/* ---------- ServiceNow formatter ---------- */

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
 * The delimiter ServiceNow reads as a code region. Minting in wrapCode,
 * breaking typed delimiters in neutralizeProseDelimiters, and escaping them
 * inside HTML all share these constants.
 */
const codeOpen = "[code]";
const codeClose = "[/code]";
const typedCodeDelimiter = /\[\/?code\]/gi;
const openBracketCode = 91;

/*
 * Inside a code region ServiceNow renders HTML, so replacing the leading
 * bracket of any case-insensitive delimiter with its numeric entity prevents
 * it from terminating the outer region while rendering the literal bracket.
 */
function escapeCodeDelimiters(html) {
    return html.replace(typedCodeDelimiter, (delimiter) =>
        delimiter.replace("[", `&#${openBracketCode};`),
    );
}

function wrapCode(html) {
    return html ? `${codeOpen}${escapeCodeDelimiters(html)}${codeClose}` : "";
}

function wrapTag(name, inner) {
    return `<${name}>${inner}</${name}>`;
}

const emptyParagraph = wrapTag("p", "");
const zeroWidthSpace = "\u200b";
const nonBreakingSpace = "\u00a0";
const hiddenCodeCharsPattern = /[\u200b-\u200d\ufeff]/g;

/*
 * Word and Outlook autocorrect run before the paste reaches the browser, so
 * a code sample arrives with typographic punctuation: curly quotes, en and
 * em dashes, an ellipsis. Those characters break the code once it is pasted
 * out of ServiceNow, so straight ASCII replacements are scoped to code.
 */
const typographyMap = {
    "‘": "'",
    "’": "'",
    "‛": "'",
    "“": '"',
    "”": '"',
    "‟": '"',
    "…": "...",
    "–": "-",
    "—": "--",
};

function stripZeroWidth(text) {
    return text.replaceAll(zeroWidthSpace, "");
}

function normalizeSpaces(text) {
    return text.replaceAll(nonBreakingSpace, " ");
}

function normalizeCodePunctuation(text) {
    return normalizeSpaces(text.replace(hiddenCodeCharsPattern, "")).replace(
        /[‘’‛“”‟…–—]/g,
        (ch) => typographyMap[ch],
    );
}

function neutralizeProseDelimiters(text) {
    /*
     * Outside code regions the journal shows text literally, so inserting a
     * zero-width space after the bracket breaks typed delimiters for the
     * downstream parser without changing what appears on screen.
     */
    return stripZeroWidth(text).replace(typedCodeDelimiter, (delimiter) =>
        delimiter.replace("[", `[${zeroWidthSpace}`),
    );
}

function serializeCodeText(node, inCodeElement = false) {
    const text = normalizeSpaces(node.textContent);

    /*
     * Inside a code region ServiceNow renders HTML, so literal characters must
     * be escaped and delimiters neutralized as entities. Typographic
     * punctuation normalization is scoped to code/pre elements so formatted
     * prose and ZWJ emojis survive intact.
     */
    const clean = inCodeElement
        ? normalizeCodePunctuation(text)
        : stripZeroWidth(text);

    return escapeCodeDelimiters(escapeHtml(clean));
}

/*
 * A paragraph-like block inside a code region: its own end supplies the line
 * break, so no separator is needed between blocks of another kind.
 */
function isParagraphBlock(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;

    const tag = node.tagName.toLowerCase();

    return tag === "p" || tag === "div";
}

/*
 * Inside a code region line structure is explicit: ServiceNow strips newlines
 * and br tags, so a paragraph is separated from its siblings by an empty
 * paragraph element rather than a newline.
 */
function serializeChildren(node, inCodeElement = false) {
    let html = "";
    let previous = null;

    for (const child of node.childNodes) {
        const part = serializeCodeNode(child, inCodeElement);

        if (
            previous &&
            part !== "" &&
            !html.endsWith(emptyParagraph) &&
            (isParagraphBlock(previous) || isParagraphBlock(child))
        ) {
            html += emptyParagraph;
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
            stripZeroWidth(sibling.textContent) !== ""
        ) {
            return false;
        }
    }

    return true;
}

function serializeHtmlElement(element, inCodeElement = false) {
    const tag = element.tagName.toLowerCase();

    if (tag === "pre") {
        const text = normalizeCodePunctuation(
            codeText(element).replace(/^\n+|\n+$/g, ""),
        );

        return wrapTag(
            "pre",
            wrapTag("code", escapeCodeDelimiters(escapeHtml(text))),
        );
    }

    const inner = serializeChildren(element, inCodeElement || tag === "code");

    if (headingLevels.includes(tag)) {
        return wrapTag(tag, inner);
    }

    switch (tag) {
        case "b":
        case "strong":
            return inner ? wrapTag("b", inner) : "";

        case "i":
        case "em":
            return inner ? wrapTag("em", inner) : "";

        case "s":
        case "strike":
        case "del":
            return inner ? wrapTag("strike", inner) : "";

        case "u":
        case "ins":
            return inner ? wrapTag("u", inner) : "";

        case "code":
            // Intentionally bold inline code for ServiceNow readability.
            return inner ? wrapTag("b", wrapTag("code", inner)) : "";

        case "blockquote":
            return wrapTag("blockquote", inner);

        case "a": {
            const href = normalizeHref(
                element.getAttribute("href") || "",
            );

            if (!href) return inner;
            if (!inner) return "";

            const safeHref = escapeHrefBrackets(href);

            return `<a href="${escapeAttr(safeHref)}">${inner}</a>`;
        }

        case "ul":
        case "ol":
            return wrapTag(tag, inner);

        case "li":
            return wrapTag("li", inner);

        case "br":
            if (isSentinelBr(element)) return "";

            return emptyParagraph;

        case "p":
        case "div":
            return inner;

        default:
            return inner;
    }
}

function serializeCodeNode(node, inCodeElement = false) {
    if (node.nodeType === Node.TEXT_NODE) {
        return serializeCodeText(node, inCodeElement);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    return serializeHtmlElement(node, inCodeElement);
}

function tidyProse(text) {
    return text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
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
        pushProsePart(parts, normalizeSpaces(node.textContent));
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
