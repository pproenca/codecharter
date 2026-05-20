# Codemap deep links

Codemaps will use `codemap://<mapLevel>/<geohash>` as the canonical portable URI form of a Map Address, with optional metadata such as path, line range, or name in query parameters. This format is deterministic, easy for Codex and other tools to parse, and can appear consistently in hooks, logs, PR comments, saved names, browser routes, and agent activity events.

## Considered Options

- Canonical `codemap://` URI with structured level and geohash.
- Web-app routes as the only deep-link format.
- Human breadcrumb strings as canonical addresses.

## Consequences

Browser URLs can wrap or resolve `codemap://` links, but the URI itself remains the cross-tool contract. Human-readable breadcrumbs may be displayed alongside the link, but they are metadata rather than the canonical address.
