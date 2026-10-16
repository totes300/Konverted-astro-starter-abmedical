// Runs ./request-guard against this deployment's Basic Auth env, the CMS toggle and the middleware's preview session.
import type { APIContext } from "astro";
import { isExactRoutePath } from "~/features/api/exact-path";
import { basicAuthCredentials } from "~/features/auth/gates";
import { getSanityBasicAuthState } from "~/features/auth/sanity-basic-auth-proxy";
import { IS_DEV } from "~/features/utils/constants";
import { checkFormRequest, type FormRequestVerdict, readFormData } from "./request-guard";
import { formRefused, formRequestAnswer } from "./response";

async function formRequestVerdict({ request, locals, routePattern }: APIContext): Promise<FormRequestVerdict> {
  if (!isExactRoutePath(request.url, routePattern)) {
    return "path";
  }

  return checkFormRequest(request.headers, {
    isDev: IS_DEV,
    isSiteWideBasicAuthEnabled: async () => (await getSanityBasicAuthState()).siteWideEnabled,
    credentials: basicAuthCredentials(),
    draftSession: locals.draftSession === true,
  });
}

/** First call in a public form endpoint: the body, or the answer to send back instead of reading it. */
export async function readFormPost(context: APIContext): Promise<FormData | Response> {
  const answer = formRequestAnswer(await formRequestVerdict(context));

  if (answer) {
    return answer;
  }

  return (await readFormData(context.request)) ?? formRefused();
}
