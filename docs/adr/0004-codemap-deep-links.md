# CodeCharter deep links

CodeCharter uses `codecharter://<kind>/<locator>` as the canonical portable URI form of a Map Address or Named Place, with optional metadata such as path, line range, bounds, or name in query parameters. The parser still accepts legacy `codemap://` links for compatibility, but new docs, prompts, tests, generated activity, and clipboard output should emit `codecharter://`.

## Considered Options

- Canonical `codecharter://` URI with structured kind and locator.
- Accept legacy `codemap://` as input only.
- Web-app routes as the only deep-link format.
- Human breadcrumb strings as canonical addresses.

## Consequences

Browser URLs can wrap or resolve `codecharter://` links, but the URI itself remains the cross-tool contract. Human-readable breadcrumbs may be displayed alongside the link, but they are metadata rather than the canonical address.
