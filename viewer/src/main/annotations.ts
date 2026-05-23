export type AnnotationDeleteResult =
  | { deleted: true; missing?: false }
  | { deleted: true; missing: true };

export type AnnotationRequestEnvironment = {
  readonly fetch?: typeof fetch;
};

export async function deleteAnnotationRequest(
  id: string,
  environment: AnnotationRequestEnvironment = {},
): Promise<AnnotationDeleteResult> {
  const fetchAnnotation = environment.fetch ?? fetch;
  const response = await fetchAnnotation(`/api/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.ok) return await response.json() as AnnotationDeleteResult;
  if (response.status === 404) return { deleted: true, missing: true };
  throw new Error(await response.text());
}
