/**
 * Creates a safe Pinecone namespace from a user ID
 * 
 * Pinecone namespace requirements:
 * - Alphanumeric characters, hyphens, underscores
 * - Maximum 64 characters
 * - Must be unique per user
 * 
 * @param userId - The user's unique identifier (UUID from Supabase)
 * @returns A safe namespace string like "user-{sanitized-user-id}"
 */
export function createUserNamespace(userId: string): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const namespace = `user-${sanitized}`;
  return namespace.substring(0, 64);
}

