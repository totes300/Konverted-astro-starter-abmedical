import { escapeXml } from "./xml";

/** `loc` is absolute, already built with `absoluteUrl()`. */
export type SitemapEntry = { loc: string; lastmod: string };

// Google ignores <changefreq> and <priority>, so entries carry only the URL and a content-driven lastmod.
function renderEntry({ loc, lastmod }: SitemapEntry): string {
  return ["  <url>", `    <loc>${escapeXml(loc)}</loc>`, `    <lastmod>${escapeXml(lastmod)}</lastmod>`, "  </url>"].join("\n");
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map(renderEntry).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
