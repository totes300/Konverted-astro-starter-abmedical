import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSender,
  headerSafe,
  MAX_RECIPIENTS,
  MAX_SUBJECT_LENGTH,
  notificationEmails,
  notificationHtml,
  notificationSubject,
  pickRecipients,
  withTimeout,
} from "./notification";

test("headerSafe: strips CR, LF and angle brackets, and caps the length", () => {
  assert.equal(headerSafe("Hi\r\nBcc: victim@example.com", 100), "Hi Bcc: victim@example.com");
  assert.equal(headerSafe("<script>", 100), "script");
  assert.equal(headerSafe("a".repeat(1_000_000), 10), "a".repeat(10));
  assert.equal(headerSafe(null, 10), "");
});

test("headerSafe: strips NUL, NEL and the Unicode line separators", () => {
  assert.equal(headerSafe("a\u0085Bcc: x@y.z b c\u0000d", 100), "a Bcc: x@y.z b c d");
  assert.equal(headerSafe("a\u2028b\u2029c\u007fd\te", 100), "a b c d e");
});

test("notificationSubject: a first name with an inner CRLF cannot add a header", () => {
  const subject = notificationSubject("Eve\r\nBcc: victim@example.com", "<x>");

  assert.doesNotMatch(subject, /[\r\n<>]/);
  assert.equal(subject, "New contact form submission from Eve Bcc: victim@example.com x");
  assert.ok(notificationSubject("a".repeat(500), "b").length <= MAX_SUBJECT_LENGTH);
});

test("notificationSubject: plain text, not HTML-escaped", () => {
  assert.equal(notificationSubject("Tom & Jerry", "O'Brien"), "New contact form submission from Tom & Jerry O'Brien");
  assert.equal(notificationSubject("Se\u00e1n", "O'Brien"), "New contact form submission from Se\u00e1n O'Brien");
});

test("formatSender: accepts a bare address or a named sender", () => {
  assert.equal(formatSender("notifications@example.com"), "notifications@example.com");
  assert.equal(formatSender("Acme <notifications@example.com>"), "Acme <notifications@example.com>");
  assert.equal(formatSender('"Acme, Inc" <notifications@example.com>'), '"Acme, Inc" <notifications@example.com>');
  assert.equal(formatSender(" <notifications@example.com>"), "notifications@example.com");
});

test("formatSender: refuses header injection and malformed values", () => {
  assert.equal(formatSender(undefined), null);
  assert.equal(formatSender(""), null);
  assert.equal(formatSender("not-an-address"), null);
  assert.equal(formatSender("a@example.com\r\nBcc: victim@example.com"), null);
  assert.equal(formatSender("Acme <a@example.com>, Evil <b@example.com>"), null);
  assert.equal(formatSender("a@b.com;c@d.com"), null);
  assert.equal(formatSender("Acme <a@b.com,c@d.com>"), null);
  assert.equal(formatSender("a@b.com,c.d"), null);
  assert.equal(formatSender("a\u0000@example.com"), null);
  assert.equal(formatSender("Acme\r\nBcc: victim@example.com <a@example.com>"), "Acme Bcc: victim@example.com <a@example.com>");
});

test("pickRecipients: only well-formed addresses, deduplicated and capped", () => {
  assert.deepEqual(pickRecipients(undefined), []);
  assert.deepEqual(pickRecipients("a@example.com"), []);
  assert.deepEqual(pickRecipients(["a@example.com", " a@example.com ", null, 42, "b@example.com"]), [
    "a@example.com",
    "b@example.com",
  ]);
  assert.deepEqual(pickRecipients(["a@example.com\r\nBcc: victim@example.com", "<a@example.com>", "a@b"]), []);
  assert.deepEqual(pickRecipients([`${"a".repeat(300)}@example.com`]), []);
  assert.deepEqual(pickRecipients(["A@B.CO", "a@b.co"]), ["A@B.CO"], "deduplicated case-insensitively");
  assert.deepEqual(pickRecipients(["a@b.com,c@d.com", "a@b.com;c@d.com"]), []);
  assert.equal(pickRecipients(Array.from({ length: 200 }, (_, i) => `r${i}@example.com`)).length, MAX_RECIPIENTS);
});

test("pickRecipients: strips invisible format characters before checking and deduplicating", () => {
  assert.deepEqual(pickRecipients(["\u200ba@example.com", "a@exam\u200bple.com", "\ufeffa@example.com", "a@example.com\u2060"]), [
    "a@example.com",
  ]);
  assert.deepEqual(pickRecipients(["\u202eac@example.com", "b\u200d@example.com"]), ["ac@example.com", "b@example.com"]);
  assert.deepEqual(pickRecipients(["\u200b\u200c\u200d"]), []);
});

test("notificationEmails: one email per recipient, so no one sees another recipient", () => {
  const emails = notificationEmails("Acme <n@example.com>", ["a@example.com", "b@example.com"], "Subject", "<p>x</p>");

  assert.equal(emails.length, 2);
  assert.deepEqual(
    emails.map((email) => email.to),
    [["a@example.com"], ["b@example.com"]]
  );

  for (const email of emails) {
    assert.deepEqual(Object.keys(email).sort(), ["from", "html", "subject", "to"], "no cc, bcc or reply-to");
  }

  assert.deepEqual(notificationEmails("n@example.com", [], "Subject", ""), []);
});

test("notificationHtml: every value is escaped", () => {
  const html = notificationHtml(
    [
      ["Name", "<img src=x onerror=alert(1)>"],
      ["Empty", ""],
    ],
    "line one\r\nline <two>"
  );

  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /Empty/);
  assert.match(html, /line one<br \/>line &lt;two&gt;/);
});

test("withTimeout: a hung promise rejects after the budget", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10, "hung"), /hung timed out after 10ms/);
  assert.equal(await withTimeout(Promise.resolve("ok"), 1000, "fast"), "ok");
});
