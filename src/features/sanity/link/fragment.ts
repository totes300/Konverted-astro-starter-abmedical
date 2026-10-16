// Coarse prefix check (no trim, no backslash test) against runnable schemes; renderers still use `safeHref`.
const SAFE_HREF_FILTER = `(string::startsWith(@, "/") && !string::startsWith(@, "//"))
    || string::startsWith(@, "?")
    || string::startsWith(@, "#")
    || string::startsWith(lower(@), "http://")
    || string::startsWith(lower(@), "https://")
    || string::startsWith(lower(@), "mailto:")
    || string::startsWith(lower(@), "tel:")`;

export const LinkFragment = `
  type,
  "openInNewTab": coalesce(openInNewTab, false),
  "canDownload": select(
    type == "file" => coalesce(canDownload, false),
    true => false
  ),
  "href": coalesce([select(
    type == "internal" => coalesce(
      select(
        defined(internal.sectionTarget) && defined(internal.link->pageBuilder.sectionsArray) => internal.link->uri.current + '#' + coalesce(
          internal.link->pageBuilder.sectionsArray[_key == ^.internal.sectionTarget][0].sectionSettings.sectionHash.current,
          internal.link->pageBuilder.sectionsArray[_key == ^.internal.sectionTarget][0]._key,
        ),
        true => internal.link->uri.current,
      ),
      ""
    ),
    type == "external" => coalesce(external, ""),
    type == "email" => "mailto:" + coalesce(email, ""),
    type == "phone" => "tel:" + coalesce(phone, ""),
    type == "file" => coalesce(file.asset->url, ""),
    type == "params" => coalesce(paramsHref, ""),
    true => ""
  )][${SAFE_HREF_FILTER}][0], ""),
  "text": coalesce(
    customText,
    select(
      type == "internal" => coalesce(
        select(
          defined(internal.sectionTarget) && defined(internal.link->pageBuilder.sectionsArray) => coalesce(
            internal.link->pageBuilder.sectionsArray[_key == ^.internal.sectionTarget][0].sectionSettings.sectionTitle,
            internal.link->title,
          ),
          true => internal.link->title,
        ),
        internal.link->uri.current,
        ""
      ),
      type == "external" => coalesce(external, ""),
      type == "email" => coalesce(email, ""),
      type == "phone" => coalesce(phone, ""),
      type == "file" => coalesce(file.asset->originalFilename, ""),
      type == "params" => coalesce(paramsHref, ""),
      true => ""
    ),
    "",
  )
`;

export type LinkFragmentResult = {
  type?: string;
  href: string;
  text: string;
  canDownload: boolean;
  openInNewTab: boolean;
};

// The `^` hops above resolve against the body's own scopes, not the caller's, so they survive here.
export const LinkFn = `fn frag::link($value) = $value{${LinkFragment}};`;

/** Pass `@` where the link is the object being projected. */
export const link = (path: string) => `frag::link(${path})`;
