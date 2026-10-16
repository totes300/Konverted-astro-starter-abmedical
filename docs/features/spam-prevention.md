# Spam Prevention

Honeypot and timing checks for the site's forms, enforced again on the server with `detectSpam`.

These checks stop naive bots only. They are not rate limiting: a script that fills the fields like a browser still gets through, so add a firewall rate limit before launch (see [Rate limiting](#rate-limiting)).

## What It Includes

- Hidden honeypot field that bots often fill
- Submission timing metadata added client-side
- Server-side verification with `detectSpam`, optionally strict

## How It Works

The system combines multiple checks:

1. Honeypot field (`website`) should remain empty. It is rendered directly in the form markup (`ContactFormSection.astro`), visually hidden and `aria-hidden`, so it is always sent.
2. Minimum interaction time before submit: `MIN_SUBMISSION_TIME` (2 seconds). The shared `FormElement` base class records when the form mounted and sets the elapsed time on the `FormData` at submit.
3. Maximum submission age: `MAX_SUBMISSION_TIME` (30 minutes); an older form session asks the visitor to refresh.
4. Server-side validation through `detectSpam` in the `/api/contact-form` endpoint, in strict mode.

## Usage

Use the feature from `src/features/spam-prevention/`:

- `constants.ts`: `HONEYPOT_FIELD_NAME`, `SUBMISSION_TIME_FIELD_NAME`, and the timing thresholds
- `utils.ts`: `detectSpam({ honeypotValue, submissionTime }, options)` for server-side validation

Typical flow (see the contact form for the working example):

1. Render a visually hidden input named `HONEYPOT_FIELD_NAME` in your form
2. In the form's custom element, set `SUBMISSION_TIME_FIELD_NAME` on the `FormData` from a mount timestamp before submitting (`FormElement` does this for every form)
3. Validate on the server with `detectSpam({ honeypotValue, submissionTime }, { strict: true })` before doing anything with the submission

### Default and strict mode

By default `detectSpam` treats a missing honeypot or timing field as "no signal", so a caller without client metadata can still run it. That also means a script that simply omits both fields passes.

Pass `{ strict: true }` when your form always sends both fields. Then a missing honeypot, or a timing value that is missing, blank or not a number, is spam, answered with "Something went wrong. Please try again.":

```ts
const spamError = detectSpam(
  {
    honeypotValue: formData.get(HONEYPOT_FIELD_NAME),
    submissionTime: formData.get(SUBMISSION_TIME_FIELD_NAME),
  },
  { strict: true }
);
```

The contact form endpoint (`src/pages/api/contact-form.ts`) uses strict mode. The honeypot is markup, so it is always sent; the timing is added by `FormElement` in its submit handler. Before the spam check, the endpoint also refuses any request that is not the `multipart/form-data` body `FormElement` sends (`readFormPost`, see [Forms](./forms.md#the-endpoint)). A browser posts natively, as `application/x-www-form-urlencoded` and without the timing, when **the element's script has not loaded yet** or **JavaScript is off**, and the endpoint would refuse that post. So the form never makes one: `SubmitButton` ships `disabled` and `FormElement` enables it when it upgrades, and a `<noscript>` line tells a no-JS visitor the form needs JavaScript (see [Forms](./forms.md#the-element)). If your audience needs no-JS submissions, that form's endpoint has to accept the urlencoded content type, drop `strict` (and accept that a script omitting both fields passes), answer a native post with a page rather than JSON, and the button has to ship enabled.

The server logs each verdict with `console.warn`, capping any submitted value it echoes at 100 characters.

## Limits

- **The timing is client-reported.** `_submissionTime` is a number the browser writes, so any script can send a plausible value. Strict mode only stops scripts that skip the field.
- For forms that matter, add one of:
  - A server-issued, signed start timestamp (the same HMAC pattern as `src/features/auth/draft-session.ts`), rendered with the form and checked in the endpoint.
  - [Vercel BotID](https://vercel.com/docs/botid) or Cloudflare Turnstile, verified inside the endpoint before any write.

## Rate limiting

Every accepted contact form submission writes a Sanity document with the edit token and sends one email per configured recipient, and `/api/contact-form` is a public POST endpoint that any script can call. Nothing in the code limits how often. On Vercel, add a Firewall rate limit (Project → Firewall → Configure → New Rule):

| Field     | Value                                                                    |
| --------- | ------------------------------------------------------------------------ |
| Condition | Request method is `POST` **and** request path ends with `contact-form`   |
| Action    | Rate limit, fixed window, keyed on IP, respond `429`                     |
| Limit     | 30 requests per 600 seconds                                              |

Firewall rules apply without a redeploy, and the dashboard stages them until you publish from **Review Changes**. Size the limit from real use: a visitor who fixes a field and resends uses two or three. Add every form endpoint you add to the same rule, by the end of its path. Off Vercel, use your platform's equivalent, or verify Turnstile in the endpoint.

"Ends with" rather than "equals": the endpoint itself refuses every spelling of its path other than the exact `/api/contact-form` (`/api/contact-form/`, `/api//contact-form`, `/api/contact%2Dform`; see [Forms](./forms.md#the-endpoint)), but the URL parser resolves dot segments (also written `%2e`) and turns a backslash into a slash before the endpoint sees the path. So `/api/x/../contact-form` or `/api\contact-form` reaches the endpoint as the exact path, and an "equals" rule that reads the path as sent would never count it. Dot segments and backslashes can only come before the last segment of a path the endpoint accepts, so every post it reads ends with the literal `contact-form`, and the rule counts each one.

Never give a webhook path (`/api/revalidate`, `/api/cache-purge`) a rate limit of its own: a burst of publishes can exceed it, and a webhook answered with `429` leaves published content stale.

### Preview endpoints

`/api/draft-mode/enable` needs a rule of its own, which lives with draft mode (trimming the forms feature keeps it): see [Draft Mode and Visual Editing](../sanity/draft-mode-and-visual-editing.md#rate-limit-the-handshake).

## What It Blocks

- Bots that fill hidden fields
- Instant submissions, and submissions older than 30 minutes
- Scripts that skip the client and omit the fields (strict mode only)
- Scripts that do not send the multipart body the form sends, or that post to a spelling of the endpoint's path that does not resolve to the exact one (the contact form endpoint)

It does not block a script that sends a plausible timing and an empty honeypot. That is what the rate limit and BotID or Turnstile are for.
