/** Private execution is inspected only through its scoped result projection. */
export const isPrivateExecutionRoom = (id: string): boolean => id.startsWith('_investigation-') || id.startsWith('_agent-request-');
