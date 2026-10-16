import assert from "node:assert/strict";
import { test } from "node:test";
import { contactForm } from "./validate-contact-form";

const VALID = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phoneDialCode: "+44",
  phone: "20 7946 0000",
  topic: "general",
  startDate: "2026-11-01",
  budget: "",
  services: ["design"],
  message: "Hello there, a valid message.",
  consent: "on",
};

function formData(values: Record<string, string | string[]>) {
  const data = new FormData();

  for (const [name, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      data.append(name, entry);
    }
  }

  return data;
}

function errorsFor(values: Record<string, string | string[]>) {
  const result = contactForm.check(formData(values));

  return result.ok ? {} : result.fieldErrors;
}

test("contact form: a real submission passes", () => {
  assert.equal(contactForm.check(formData(VALID)).ok, true);
});

test("contact form: every free-text field is capped on the server", () => {
  assert.ok(errorsFor({ ...VALID, firstName: "a".repeat(101) }).firstName);
  assert.ok(errorsFor({ ...VALID, lastName: "a".repeat(101) }).lastName);
  assert.ok(errorsFor({ ...VALID, email: `${"a".repeat(250)}@example.com` }).email);
  assert.ok(errorsFor({ ...VALID, phone: "1".repeat(21) }).phone);
  assert.ok(errorsFor({ ...VALID, message: "a".repeat(1001) }).message);
});

test("contact form: the dial code is one FormPhone renders, or blank", () => {
  assert.ok(errorsFor({ ...VALID, phoneDialCode: "+1".padEnd(1_000_003, "1") }).phoneDialCode);
  assert.ok(errorsFor({ ...VALID, phoneDialCode: "+1\r\nBcc: victim@example.com" }).phoneDialCode);
  assert.equal(errorsFor({ ...VALID, phoneDialCode: "" }).phoneDialCode, undefined);
  assert.equal(errorsFor({ ...VALID, phoneDialCode: "+971" }).phoneDialCode, undefined);
});

test("contact form: services are capped to the options and deduplicated", () => {
  assert.ok(errorsFor({ ...VALID, services: Array.from({ length: 50_000 }, () => "design") }).services);
  assert.equal(contactForm.check(formData({ ...VALID, services: ["design", "not-a-service"] })).ok, false);

  const result = contactForm.check(formData({ ...VALID, services: ["design", "design", "seo"] }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.data.services, ["design", "seo"]);
});

test("contact form: unknown keys never reach the stored document", () => {
  const result = contactForm.check(formData({ ...VALID, _id: "siteSettings", _type: "siteSettings" }));

  assert.equal(result.ok, true);
  assert.equal(result.ok && "_id" in result.data, false);
  assert.equal(result.ok && "_type" in result.data, false);
});

test("contact form: the caps leave the derived required flags as they were", () => {
  const { field } = contactForm;

  assert.equal(field("services").required, true);
  assert.equal(field("email").required, true);
  assert.equal(field("phoneDialCode").required, false);
  assert.equal(field("phone").required, false);
  assert.equal(field("budget").required, false);
});
