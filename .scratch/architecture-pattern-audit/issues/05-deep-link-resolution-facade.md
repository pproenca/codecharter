Title: Keep deep-link resolution results aligned with resolved address semantics
Status: ready-for-agent
Labels: architecture, follow-up

## Problem

The CLI deep-link resolver parsed a `codecharter://` link kind and then resolved path and range metadata to a map address. When the parsed link kind was less specific than the metadata, for example `codecharter://file/...&lines=2-4`, the public JSON result reported `kind: "file"` while the resolved address was a `lineRange`.

## Pattern Check

Candidate pattern: Facade.

Facade applies because `resolveDeepLink` is the CLI entry point that hides parsing, metadata conversion, map loading, and address resolution behind one public operation. The subsystem is not already simple at the CLI boundary, and callers do not need fine-grained control over the intermediate parsed link. Adapter was rejected because this repo owns both the link parser and the address resolver interfaces, so the right fix is to keep the facade result coherent rather than add a translation object.

## Progress

Added a public CLI behavior test for resolving a file deep link with line metadata. The resolver now returns the resolved address `targetType` as the result kind for non-annotation links, keeping `kind` and `address.targetType` aligned.
