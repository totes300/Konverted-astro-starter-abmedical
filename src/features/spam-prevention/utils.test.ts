import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SUBMISSION_TIME, MIN_SUBMISSION_TIME } from "./constants";
import { detectSpam } from "./utils";

test("detectSpam: filled honeypot is spam", () => {
  assert.equal(detectSpam({ honeypotValue: "https://spam.example" }), "Invalid submission");
  assert.equal(detectSpam({ honeypotValue: "   " }), null, "whitespace-only honeypot is not spam");
});

test("detectSpam: submission timing bounds", () => {
  assert.equal(detectSpam({ submissionTime: MIN_SUBMISSION_TIME - 1 }), "Please take your time filling out the form");
  assert.equal(detectSpam({ submissionTime: MAX_SUBMISSION_TIME + 1 }), "Form session expired. Please refresh and try again");
  assert.equal(detectSpam({ submissionTime: MIN_SUBMISSION_TIME + 500 }), null);
});

test("detectSpam: FormData string values work (the transport used by the contact form)", () => {
  assert.equal(detectSpam({ honeypotValue: "", submissionTime: "800" }), "Please take your time filling out the form");
  assert.equal(detectSpam({ honeypotValue: "", submissionTime: String(MIN_SUBMISSION_TIME + 1) }), null);
});

test("detectSpam: missing values are no signal, not spam", () => {
  assert.equal(detectSpam({}), null);
  assert.equal(detectSpam({ honeypotValue: null, submissionTime: null }), null);
  assert.equal(detectSpam({ submissionTime: "" }), null);
  assert.equal(detectSpam({ submissionTime: "not-a-number" }), null);
});

test("detectSpam: custom bounds override the defaults", () => {
  assert.equal(detectSpam({ submissionTime: 100 }, { minSubmissionTime: 50 }), null);
  assert.equal(
    detectSpam({ submissionTime: 100 }, { minSubmissionTime: 10, maxSubmissionTime: 50 }),
    "Form session expired. Please refresh and try again"
  );
});

test("detectSpam strict: a script that omits the honeypot and the timing is spam", () => {
  const strict = { strict: true };

  assert.equal(detectSpam({}, strict), "Something went wrong. Please try again.", "retryable, a resubmit after hydration passes");
  assert.notEqual(detectSpam({ honeypotValue: null, submissionTime: null }, strict), null);
  assert.notEqual(detectSpam({ honeypotValue: "", submissionTime: null }, strict), null, "timing missing");
  assert.notEqual(detectSpam({ submissionTime: String(MIN_SUBMISSION_TIME + 500) }, strict), null, "honeypot missing");
});

test("detectSpam strict: malformed timing is spam", () => {
  const strict = { strict: true };

  for (const submissionTime of ["", "   ", "not-a-number", "NaN", Number.NaN, new Blob(["5000"])]) {
    assert.notEqual(detectSpam({ honeypotValue: "", submissionTime }, strict), null, String(submissionTime));
  }

  assert.equal(
    detectSpam({ honeypotValue: "", submissionTime: "Infinity" }, strict),
    "Form session expired. Please refresh and try again"
  );
  assert.equal(detectSpam({ honeypotValue: "", submissionTime: "-1" }, strict), "Please take your time filling out the form");
});

test("detectSpam strict: what the form sends passes", () => {
  const strict = { strict: true };
  const fillTime = MIN_SUBMISSION_TIME + 500;

  assert.equal(detectSpam({ honeypotValue: "", submissionTime: String(fillTime) }, strict), null);
  assert.equal(detectSpam({ honeypotValue: "", submissionTime: fillTime }, strict), null);
  assert.equal(
    detectSpam({ honeypotValue: "https://spam.example", submissionTime: String(fillTime) }, strict),
    "Invalid submission"
  );
});

test("detectSpam: default mode still treats a non-string timing as no signal", () => {
  assert.equal(detectSpam({ honeypotValue: "", submissionTime: new Blob(["5"]) }), null);
});

/** Every object `console.warn` received while `run` ran. */
function loggedObjects(run: () => void): Record<string, unknown>[] {
  const realWarn = console.warn;
  const logged: unknown[] = [];

  console.warn = (...args: unknown[]) => {
    logged.push(...args);
  };

  try {
    run();
  } finally {
    console.warn = realWarn;
  }

  return logged.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
}

test("detectSpam: a logged submitted value is capped", () => {
  const huge = "x".repeat(1_000_000);

  const [honeypot] = loggedObjects(() => detectSpam({ honeypotValue: huge }));
  const [timing] = loggedObjects(() => detectSpam({ honeypotValue: "", submissionTime: huge }, { strict: true }));

  assert.equal(String(honeypot?.honeypotValue).length, 100);
  assert.equal(String(timing?.submissionTime).length, 100);
});
