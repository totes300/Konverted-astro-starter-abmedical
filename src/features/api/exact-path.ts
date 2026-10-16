/** The path as the URL parser resolves it, nothing decoded; Astro also routes spellings to an endpoint that a firewall rule misses. */
export function isExactRoutePath(rawUrl: string, routePattern: string): boolean {
  return new URL(rawUrl).pathname === routePattern;
}
