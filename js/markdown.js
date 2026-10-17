/* Markdown to HTML.
   Split out of app.js, lines 1201-1342. Load order matters: keep the
   <script> tag for this file where index.html puts it. */

/* ---------- Markdown to HTML ---------- */

function markdownToHtml(markdown) {
    const lines = markdown.split(/\r?\n/);
    const result = [];
    let list = null;
    let fence = null;

    const closeList = () => {
        if (!list) return;

        result.push(`</${list}>`);
        list = null;
    };

    const closeFence = () => {
        result.push(
            `<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`,
        );

        fence = null;
    };

    const inline = (text) => {
        const tokens = [];

        const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;

        /*
         * Code spans and links are held as placeholders so the emphasis
         * passes cannot rewrite text inside them, and so link URLs are
         * escaped exactly once. Emphasis delimiters are anchored to word
         * boundaries so that prose containing bare asterisks survives. NUL
         * is the placeholder delimiter, so any that arrived in the text is
         * removed before tokenizing, and an index that does not resolve
         * falls back to the literal match rather than to undefined.
         */
        const held = text
            .replace(/\u0000/g, "")
            .replace(
                /`([^`]+)`/g,
                (_, code) => hold(`<code>${escapeHtml(code)}</code>`),
            )
            .replace(
                /\[([^\]]+)\]\(([^\s)]+?(?:\([^)]*\)[^\s)]*)*)\)/g,
                (_, label, url) => {
                    const href = normalizeHref(url);

                    if (!href) return label;

                    return hold(
                        `<a href="${escapeAttr(href)}">${escapeHtml(
                            label,
                        )}</a>`,
                    );
                },
            );

        return escapeHtml(held)
            .replace(
                /(^|[^*\w])\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*(?![\w*])/g,
                "$1<b>$2</b>",
            )
            .replace(
                /(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g,
                "$1<em>$2</em>",
            )
            .replace(/~~([^~]+)~~/g, "<strike>$1</strike>")
            .replace(
                /\u0000(\d+)\u0000/g,
                (match, index) => tokens[Number(index)] ?? match,
            );
    };

    for (const line of lines) {
        let match;

        /*
         * Fenced code is consumed line by line. A single regular expression
         * over the whole document cannot tell a fence that opens a block
         * from a run of backticks inside a sentence.
         */
        if (fence) {
            if (/^\s*```\s*$/.test(line)) {
                closeFence();
            } else {
                fence.push(line);
            }

            continue;
        }

        if (/^\s*```[\w-]*\s*$/.test(line)) {
            closeList();
            fence = [];
        } else if ((match = line.match(headingHashPattern))) {
            /*
             * ServiceNow renders each heading level as written, so the hash
             * count maps straight to the tag rather than collapsing to h3.
             */
            closeList();

            const level = match[1].length;

            result.push(`<h${level}>${inline(match[2])}</h${level}>`);
        } else if ((match = line.match(/^>\s?(.*)$/))) {
            closeList();
            result.push(
                `<blockquote>${inline(match[1])}</blockquote>`,
            );
        } else if ((match = line.match(/^[-*+]\s+(.*)$/))) {
            if (list !== "ul") {
                closeList();
                result.push("<ul>");
                list = "ul";
            }

            result.push(`<li>${inline(match[1])}</li>`);
        } else if ((match = line.match(/^\d+[.)]\s+(.*)$/))) {
            if (list !== "ol") {
                closeList();
                result.push("<ol>");
                list = "ol";
            }

            result.push(`<li>${inline(match[1])}</li>`);
        } else if (line.trim() === "") {
            closeList();
            result.push("");
        } else {
            closeList();
            result.push(`<p>${inline(line)}</p>`);
        }
    }

    if (fence) closeFence();

    closeList();

    return result.join("");
}
