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

describe("ServiceNow [code] serializer", () => {
    it("serializes plain prose paragraphs and preserves leading indentation", async () => {
        await app.resetEditor("<p>  indented first</p><p>second line</p>");
        const body = await app.evaluate(() => serializedBody());
        assert.equal(body, "  indented first\nsecond line");
    });

    it("tidies trailing whitespace and collapses 3+ blank lines in prose", async () => {
        await app.resetEditor(
            "<p>alpha   </p><p><br></p><p><br></p><p><br></p><p>beta\t</p>",
        );
        const body = await app.evaluate(() => serializedBody());
        assert.equal(body, "alpha\n\nbeta");
    });

    it("serializes inline formatting tags into [code] blocks", async () => {
        await app.resetEditor(
            "<p><strong>bold</strong> <em>italic</em> <del>strike</del> <ins>under</ins> <code>fn()</code></p>",
        );
        const body = await app.evaluate(() => serializedBody());
        assert.equal(
            body,
            "[code]<b>bold</b>[/code] [code]<em>italic</em>[/code] [code]<strike>strike</strike>[/code] [code]<u>under</u>[/code] [code]<b><code>fn()</code></b>[/code]",
        );
    });

    it("serializes links with safe hrefs, escapes brackets, preserves IPv6, and unwraps invalid hrefs", async () => {
        await app.resetEditor(
            '<p><a href="https://example.com/a[1]">ok</a> <a href="http://[::1]:8080/x">v6</a> <a href="javascript:alert(1)">bad</a> <a href="https://example.com"></a></p>',
        );
        const body = await app.evaluate(() => serializedBody());
        assert.equal(
            body,
            '[code]<a href="https://example.com/a%5B1%5D">ok</a>[/code] [code]<a href="http://[::1]:8080/x">v6</a>[/code] [code]bad[/code]',
        );
    });

    it("validates hrefs in normalizeHref", async () => {
        const results = await app.evaluate(() => ({
            https: normalizeHref("https://example.com/path?a=1"),
            http: normalizeHref("http://localhost:3000"),
            mailto: normalizeHref("mailto:user@example.com"),
            tel: normalizeHref("tel:+1-555-0100"),
            hash: normalizeHref("#section"),
            path: normalizeHref("/incident.do?sys_id=123"),
            js: normalizeHref("javascript:alert(1)"),
            data: normalizeHref("data:text/html,hi"),
            protoRel: normalizeHref("//evil.example/x"),
            slashBackslash: normalizeHref("/\\evil.example"),
            whitespace: normalizeHref("https://example.com/a b"),
            emptyHash: normalizeHref("#"),
        }));

        assert.equal(results.https, "https://example.com/path?a=1");
        assert.equal(results.http, "http://localhost:3000");
        assert.equal(results.mailto, "mailto:user@example.com");
        assert.equal(results.tel, "tel:+1-555-0100");
        assert.equal(results.hash, "#section");
        assert.equal(results.path, "/incident.do?sys_id=123");
        assert.equal(results.js, "");
        assert.equal(results.data, "");
        assert.equal(results.protoRel, "");
        assert.equal(results.slashBackslash, "");
        assert.equal(results.whitespace, "");
        assert.equal(results.emptyHash, "");
    });

    it("serializes headings h1-h6, blockquotes, and lists", async () => {
        await app.resetEditor(
            "<h1>Title</h1><h3>Sub</h3><blockquote>Line 1<br>Line 2<br></blockquote><ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul><ol><li>First</li></ol>",
        );
        const body = await app.evaluate(() => serializedBody());
        assert.equal(
            body,
            [
                "[code]<h1>Title</h1>[/code]",
                "[code]<h3>Sub</h3>[/code]",
                "[code]<blockquote>Line 1<p></p>Line 2</blockquote>[/code]",
                "[code]<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>[/code]",
                "[code]<ol><li>First</li></ol>[/code]",
            ].join("\n"),
        );
    });

    it("normalizes typographic punctuation inside code/pre only and escapes HTML", async () => {
        await app.resetEditor(
            "<p><b>\u201cquoted\u201d \u2014 prose</b> <code>\u201ccode\u201d \u2013 \u2014 \u2026</code></p><pre>const s = \u2018hi\u2019;<br>if (a &lt; b) {}</pre>",
        );
        const body = await app.evaluate(() => serializedBody());
        assert.equal(
            body,
            '[code]<b>\u201cquoted\u201d \u2014 prose</b>[/code] [code]<b><code>"code" - -- ...</code></b>[/code]\n[code]<pre><code>const s = \'hi\';\nif (a &lt; b) {}</code></pre>[/code]',
        );
    });

    it("neutralizes [code] and [/code] delimiters in prose even when split across nodes", async () => {
        await app.resetEditor("<p>[co<b></b>de]hello[/CODE]</p>");
        const body = await app.evaluate(() => serializedBody());
        assert.equal(body, "[\u200bcode]hello[\u200b/CODE]");
    });

    it("escapes [code] and [/code] delimiters inside [code] regions with &#91;", async () => {
        await app.resetEditor(
            "<p><b>[code]x[/code]</b></p><pre>echo [CODE]test[/code]</pre>",
        );
        const body = await app.evaluate(() => serializedBody());
        assert.equal(
            body,
            "[code]<b>&#91;code]x&#91;/code]</b>[/code]\n[code]<pre><code>echo &#91;CODE]test&#91;/code]</code></pre>[/code]",
        );
    });

    it("renders preview mirror safely, stripping disallowed tags and attributes", async () => {
        const result = await app.evaluate(() => {
            const container = document.createElement("div");
            container.append(
                mirrorNodes(
                    'Plain\nLine 2\n[code]<b onclick="alert(1)">ok</b><script>evil()</script><a href="https://example.com" class="x">link</a><a href="javascript:alert(1)">nope</a>[/code]',
                ),
            );
            return container.innerHTML;
        });

        assert.equal(
            result,
            'Plain<br>Line 2<br><b>ok</b><a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>nope',
        );
    });
});
