// The contact form's notification email as pure functions, so its header rules have tests.
export const MAX_SENDER_NAME_LENGTH = 100;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_RECIPIENTS = 50;

const MAX_ADDRESS_LENGTH = 254;
const ADDRESS = /^[^\s\p{Cc}@<>,;]+@[^\s\p{Cc}@<>,;]+\.[^\s\p{Cc}@<>,;]+$/u;
const HEADER_UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}<>]/gu;
const NAMED_SENDER = /^([^<>]*)<([^<>]*)>$/;
const FORMAT_CHARACTERS = /\p{Cf}/gu;

export type NotificationRow = [label: string, value: string];

export type NotificationEmail = { from: string; to: [string]; subject: string; html: string };

/** For any CMS, env or visitor string that becomes a mail header: no control characters, line breaks or angle brackets, capped. */
export function headerSafe(value: string | null | undefined, maxLength: number): string {
  return (value ?? "")
    .slice(0, maxLength * 4)
    .replace(HEADER_UNSAFE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isAddress(value: string): boolean {
  return value.length <= MAX_ADDRESS_LENGTH && ADDRESS.test(value);
}

/** `RESEND_EMAIL_FROM` as `name@domain` or `Name <name@domain>`; null when neither, so nothing is sent from a bad header. */
export function formatSender(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, MAX_SENDER_NAME_LENGTH + MAX_ADDRESS_LENGTH + 4);
  const named = NAMED_SENDER.exec(trimmed);

  if (!named) {
    return isAddress(trimmed) ? trimmed : null;
  }

  const address = (named[2] ?? "").trim();

  if (!isAddress(address)) {
    return null;
  }

  const name = headerSafe(named[1], MAX_SENDER_NAME_LENGTH);

  return name ? `${name} <${address}>` : address;
}

/** Studio validation is UI only, so an API write could store anything in the recipient list. */
export function pickRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byAddress = new Map<string, string>();

  for (const entry of value) {
    // Invisible format characters (zero-width, bidi) can make one address read as another.
    const address = typeof entry === "string" ? entry.replace(FORMAT_CHARACTERS, "").trim() : "";

    if (isAddress(address) && !byAddress.has(address.toLowerCase())) {
      byAddress.set(address.toLowerCase(), address);
    }
  }

  return [...byAddress.values()].slice(0, MAX_RECIPIENTS);
}

/** One email per recipient, so no recipient sees another's address. */
export function notificationEmails(from: string, recipients: string[], subject: string, html: string): NotificationEmail[] {
  return recipients.map((recipient) => ({ from, to: [recipient], subject, html }));
}

/** Plain text, not HTML-escaped: a subject is never rendered as markup. */
export function notificationSubject(firstName: string, lastName: string): string {
  return headerSafe(`New contact form submission from ${firstName} ${lastName}`, MAX_SUBJECT_LENGTH);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function notificationHtml(rows: NotificationRow[], message: string): string {
  const lines = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<strong>${escapeHtml(label)}</strong>: ${escapeHtml(value)}`)
    .join("<br />\n        ");

  return `
      <p>
        ${lines}<br />
        <strong>Message</strong>:<br />
        ${escapeHtml(message).replace(/\r?\n/g, "<br />")}
      </p>
    `;
}

/** Races a promise that cannot be aborted (the Resend SDK takes no signal); the loser keeps running but nothing waits on it. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
