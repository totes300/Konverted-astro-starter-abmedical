# Contact Form Notifications

The contact form stores every accepted submission in Sanity and can email a notification for it through Resend. The form's validation plumbing is shared with every form on the site, see [Forms](./forms.md); the bot checks are in [Spam Prevention](./spam-prevention.md).

## Behavior

The form POSTs `FormData` to `/api/contact-form` (`src/pages/api/contact-form.ts`), which runs, in order:

1. **Request check.** `readFormPost` refuses a post to any spelling but the exact `/api/contact-form` path (as the URL parser resolves it), anything that is not the `multipart/form-data` body the form sends, and anything over 64 KB, each with "Something went wrong. Please try again." (`400`), the text the strict spam check also answers. When **Protect entire site** is on in the CMS, a post without the Basic Auth credentials or a verified preview session gets the pages' `401` Basic challenge: the middleware never gates `/api/`, so the endpoint asks for what a page would. A failed read of that setting, or the switch on with no `BASIC_AUTH_*` credentials set, answers `503`. Details: [Forms](./forms.md#the-endpoint).
2. **Strict spam check.** A request without the honeypot or the timing field is refused before anything else runs.
3. **Server-side validation.** The endpoint re-runs the form's schema, so every field is capped and checked even when the browser is bypassed (see [Field rules](#field-rules)).
4. **The write.** The submission is stored as a `contactFormSubmission` document, with an 8 second timeout. If it fails, the visitor sees "Failed to submit form. Please try again later." (`500`) and nothing is mailed. A write that timed out on this side may still have landed, so that case answers `504` with "We may have received this already. Please wait a moment before sending it again." instead (`formWriteFailed` in `src/features/forms/response.ts`); a visitor who resends anyway can still leave two documents.
5. **The notification**, only once the write has succeeded, and after the response: it runs in `waitUntil` from `@vercel/functions`, so the visitor gets the success answer first and a slow or failing Resend never holds the request. The recipients are read with the view token, not the edit token the write uses, from the published Settings document by its `_id`, with a 2 second timeout; the send has a 5 second one. A failure at either step is logged server-side, no email goes out, and the submission still counts as received.

On Vercel, `waitUntil` work runs inside the function's duration limit; the timeouts above add up to 15 seconds, well inside it. The Resend SDK cannot abort a request, so the send's timeout stops the waiting, not the request. Outside Vercel (`astro dev`, a plain Node server) `waitUntil` finds no request context and does nothing, and the send simply runs on in the long-lived process. On another serverless host, which may freeze a function once it has answered, swap in that platform's own `waitUntil`.

## Configuration

Set these environment variables in your deployment:

```env
RESEND_API_KEY=your-resend-api-key
RESEND_EMAIL_FROM=notifications@your-domain.com
```

Both are optional at runtime. If either is missing, no notification email is sent.

`RESEND_EMAIL_FROM` is either a bare address (`notifications@your-domain.com`) or a named sender (`Acme <notifications@your-domain.com>`). Line breaks and angle brackets are stripped from the name, and anything else (two addresses, a malformed address) skips the email with a logged error rather than sending a broken header.

## Recipients in Sanity

Recipients are managed in the Settings singleton (**Settings → Email Notifications**), field `contactFormNotificationEmails`.

- The endpoint reads the singleton **by `_id`** (`siteSettings`), published only. Reading the first document of the type would let a second `siteSettings` document, created through the API, redirect visitors' personal data to another inbox.
- Studio validation is UI only, so the endpoint re-checks the list: invisible Unicode format characters (zero-width spaces, bidi controls) are stripped, only well-formed addresses are used, duplicates are dropped, and at most 50 are sent to.
- Each recipient gets their own email, sent together in one Resend batch call (`resend.batch.send`, up to 100 per call), so no recipient sees another's address. There is no `cc` or `bcc`.

## The email

- The subject is `New contact form submission from <first name> <last name>`. It is plain text, not HTML-escaped (an `&` in a name stays `&`), with control characters, line breaks and angle brackets stripped, and capped at 200 characters, so a visitor's name cannot add a header.
- Every value in the body is HTML-escaped. The visitor's address only ever appears in the body; it is never a `to`, `cc` or `reply-to`, so the form cannot be used to send email to an address a visitor typed.

## Field rules

`validate-contact-form.ts` is imported by both the custom element and the endpoint. Every field is capped on the server:

| Field            | Rule                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| First, last name | required, 100 characters                                                          |
| Email            | required, 254 characters, email shape                                             |
| Phone dial code  | one of the codes `FormPhone` renders (`src/components/Form/dial-codes.ts`), or blank |
| Phone            | digits and separators, 20 characters                                              |
| Topic, budget    | one of the listed options (budget may be blank)                                   |
| Start date       | blank or `YYYY-MM-DD`                                                             |
| Services         | at least one, at most one of each listed service, deduplicated                    |
| Message          | 10 to 1,000 characters                                                            |
| Consent          | the checkbox's `on`                                                               |

Unknown fields are dropped by the schema, and the endpoint sets `_id` and `_type` after spreading the submission, so a request cannot set them or any other document field. Add a cap to every new field you add.

## Where submissions live

New submissions are written with a dotted id, `contactFormSubmission.<uuid>`, built by `apiOnlyDocumentId()` in `sanity/constants.ts` (any new server-written type uses it too; `sanity/api-only-documents.test.ts` fails on a hand-built id). Sanity never serves documents with a dot in their id to unauthenticated requests, so even a **public** dataset does not expose them to anonymous reads. The Studio lists them as before (**Form Submissions**, filtered by `_type`), and they can be opened and deleted there but not edited.

Submissions created before this change keep their original root ids, and a public dataset serves those to anyone who queries for them. Either make the dataset private (`npm run sanity:cli -- dataset visibility set <dataset> private`; the server clients already read with a token, but check any read you added) or delete the old submissions from the Studio.

The write runs with client retries off: a write that times out may still land, and a retry would store the submission twice.

## Tokens

- The endpoint writes with `SANITY_API_EDIT_TOKEN`, which can edit anything in the project; a dedicated robot token that can only create `contactFormSubmission` documents (a custom role, on Sanity plans that offer them) is recommended for this write.

## Rate limiting

Every accepted submission costs a Sanity write and one email per recipient, and nothing in the code limits how often. Before launch, add the Vercel Firewall rule described in [Spam Prevention](./spam-prevention.md#rate-limiting): method `POST` and a path ending in `contact-form` (not "equals": `/api/x/../contact-form` reaches the endpoint as the exact path), 30 requests per 600 seconds per IP, respond `429`.

## Implementation Notes

- Endpoint: `src/pages/api/contact-form.ts`
- Request check, with tests: `src/features/forms/request-guard.ts` and the exact-path check in `src/features/api/exact-path.ts`, called through `readFormPost` (`src/features/forms/form-post.ts`)
- Header, recipient and body helpers, with tests: `src/features/page-builder/sections/ContactFormSection/notification.ts`
- Field rules: `src/features/page-builder/sections/ContactFormSection/validate-contact-form.ts`, with tests beside it. The form is `novalidate` and the element reports these rules inline, so an empty or malformed field never reaches the endpoint; the endpoint re-runs them because a client can be bypassed.
- Form UI: `src/features/page-builder/sections/ContactFormSection/ContactFormSection.astro` + the `ContactFormElement` custom element colocated beside it (`ContactFormElement.ts`), which submits via fetch and adds the spam-prevention timing metadata. The submit button ships `disabled` and the element enables it when it upgrades, because the endpoint refuses the native post a browser makes without it; with JavaScript off the button stays disabled and a `<noscript>` line says the form needs JavaScript (see [Forms](./forms.md#the-element)).
- Uses a typed query + generated type from `sanity/types.ts`
