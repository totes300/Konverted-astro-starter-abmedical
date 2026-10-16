import { MAX_SUBMISSION_TIME, MIN_SUBMISSION_TIME } from "~/features/spam-prevention/constants";

export type SpamPayload = {
  honeypotValue?: unknown;
  submissionTime?: unknown;
};

export type DetectSpamOptions = {
  /**
   * Minimum time (in milliseconds) before a form submission is considered legitimate.
   * @default MIN_SUBMISSION_TIME
   */
  minSubmissionTime?: number;

  /** Maximum milliseconds a submission may take and still be considered human. */
  maxSubmissionTime?: number;

  /** Missing or malformed fields count as spam; only for a form that always sends both. */
  strict?: boolean;
};

const STRICT_MISSING_MESSAGE = "Something went wrong. Please try again.";

const MAX_LOGGED_VALUE_LENGTH = 100;

function parseSubmissionTime(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : value;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isNaN(parsed) ? null : parsed;
}

/** Missing fields are "no signal" by default; `strict` makes them spam (see docs/features/spam-prevention.md). */
export function detectSpam(payload: SpamPayload, options: DetectSpamOptions = {}): string | null {
  const { minSubmissionTime = MIN_SUBMISSION_TIME, maxSubmissionTime = MAX_SUBMISSION_TIME, strict = false } = options;

  const { honeypotValue, submissionTime } = payload;

  if (typeof honeypotValue === "string" && honeypotValue.trim() !== "") {
    console.warn("Spam detected: Honeypot field filled", { honeypotValue: honeypotValue.slice(0, MAX_LOGGED_VALUE_LENGTH) });
    return "Invalid submission";
  }

  if (strict && typeof honeypotValue !== "string") {
    console.warn("Spam detected: Honeypot field missing");
    return STRICT_MISSING_MESSAGE;
  }

  const timeTaken = parseSubmissionTime(submissionTime);

  if (timeTaken === null) {
    if (strict) {
      console.warn("Spam detected: Submission time missing or malformed", {
        submissionTime:
          typeof submissionTime === "string" ? submissionTime.slice(0, MAX_LOGGED_VALUE_LENGTH) : typeof submissionTime,
      });
      return STRICT_MISSING_MESSAGE;
    }

    return null;
  }

  if (timeTaken < minSubmissionTime) {
    console.warn("Spam detected: Form submitted too quickly", { timeTaken });
    return "Please take your time filling out the form";
  }

  if (timeTaken > maxSubmissionTime) {
    console.warn("Spam detected: Form submission expired", { timeTaken });
    return "Form session expired. Please refresh and try again";
  }

  return null;
}
