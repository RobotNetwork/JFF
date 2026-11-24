import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./harness.mjs";

let app;

before(async () => {
    app = await startApp();
});

after(async () => {
    if (!app) return;
    assert.deepEqual(app.pageErrors, [], "Expected no uncaught page errors");
    await app.close();
});

describe("Rich text sanitizer and normalizer", () => {
    it("drops unsafe and non-text media elements including video, audio, and canvas", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml(
                "<p>Hello</p><script>alert(1)</script><style>body{}</style><iframe src='x'>no</iframe><video>fallback v</video><audio>fallback a</audio><canvas>fallback c</canvas><svg><text>svg</text></svg><img src='a.png'><p>World</p>",
            ),
        );

        assert.equal(res.html, "<p>Hello</p><p>World</p>");
        assert.equal(res.dropped, 6);
    });

    it("returns empty html when payload contains only dropped media", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml('<!--StartFragment--><img src="shot.png"><!--EndFragment-->'),
        );

        assert.equal(res.html, "");
        assert.equal(res.dropped, 1);
    });

    it("strips HTML comments, event handlers, and invalid hrefs while preserving valid links", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml(
                '<!--StartFragment--><p class="x" onclick="evil()">Hi <a href="https://example.com" title="t" onclick="x()">good</a> <a href="javascript:alert(1)">bad</a></p>',
            ),
        );

        assert.equal(
            res.html,
            '<p>Hi <a href="https://example.com">good</a> bad</p>',
        );
    });

    it("normalizes inline CSS formatting to semantic tags and unwraps font-weight:normal", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml(
                '<b style="font-weight:normal"><span style="font-weight:700">bold</span> <span style="font-style:italic">ital</span> <span style="text-decoration:line-through">strike</span> <span style="text-decoration-line:underline">under</span></b>',
            ),
        );

        assert.equal(
            res.html,
            "<strong>bold</strong> <em>ital</em> <strike>strike</strike> <u>under</u>",
        );
    });

    it("distributes inline formatting wrappers over block children", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml(
                "<b><p>First</p><p>Second</p><pre>raw</pre><ul><li>Item</li></ul></b>",
            ),
        );

        assert.equal(
            res.html,
            '<p><b>First</b></p><p><b>Second</b></p><pre spellcheck="false">raw</pre><ul><li><b>Item</b></li></ul>',
        );
    });

    it("flattens HTML tables into tab-separated paragraphs", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml(
                "<table><tr><th>Name</th><th>Status</th></tr><tr><td>API</td><td><p>Up</p><p>OK</p></td></tr></table>",
            ),
        );

        assert.equal(res.html, "<p>Name\tStatus</p><p>API\tUp OK</p>");
    });

    it("wraps orphan list items in an unordered list", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml("<li>One</li><li>Two</li>"),
        );

        assert.equal(res.html, "<ul><li>One</li><li>Two</li></ul>");
    });

    it("collapses HTML source wrapping while preserving nbsp indentation and pre whitespace", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml(
                "<p>\n  Hello\n  world\n</p><p>&nbsp;&nbsp;indented</p><pre>line 1\n  line 2</pre>",
            ),
        );

        assert.equal(
            res.html,
            '<p>Hello world</p><p>  indented</p><pre spellcheck="false">line 1\n  line 2</pre>',
        );
    });

    it("removes empty inline formatting wrappers and sets spellcheck=false on code/pre", async () => {
        const res = await app.evaluate(() =>
            sanitizeEntryHtml("<p>a<b></b><em></em><code>x</code></p>"),
        );

        assert.equal(res.html, '<p>a<code spellcheck="false">x</code></p>');
    });

    it("normalizes <br> and nested blocks inside <pre> into plain newlines", async () => {
        await app.resetEditor("<pre><div>line 1</div><div>line 2</div><br>line 3</pre>");
        const text = await app.evaluate(() => {
            normalizeCodeBlocks(editor);
            return editor.querySelector("pre").textContent;
        });

        assert.equal(text, "line 1\nline 2\n\nline 3");
    });
});
