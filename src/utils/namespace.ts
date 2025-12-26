/**
 * Creates a safe Pinecone namespace from a user ID and resource type
 * 
 * Pinecone namespace requirements:
 * - Alphanumeric characters, hyphens, underscores
 * - Maximum 64 characters
 * - Must be unique per user and resource type
 * 
 * @param userId - The user's unique identifier (UUID from Supabase)
 * @param resourceType - The type of resource ("image" or "video")
 * @returns A safe namespace string like "user-{sanitized-user-id}-images" or "user-{sanitized-user-id}-videos"
 */
export function createUserNamespace(userId: string, resourceType: "image" | "video" = "image"): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const typeSuffix = resourceType === "video" ? "videos" : "images";
  const namespace = `user-${sanitized}-${typeSuffix}`;
  return namespace.substring(0, 64);
}

/**
 * Creates a collection-aware Pinecone namespace with resource type
 * Format: {sanitized-userId}-{resourceType}-{sanitized-collectionName}
 * 
 * @param userId - The user's unique identifier
 * @param collectionName - The collection name
 * @param resourceType - The type of resource ("image" or "video")
 * @returns A namespace string like "abc123-image-default" or "abc123-video-mumbai-travels"
 */
export function createCollectionNamespace(
  userId: string, 
  collectionName: string,
  resourceType: "image" | "video"
): string {
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const sanitizedName = collectionName.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const namespace = `${sanitizedUserId}-${resourceType}-${sanitizedName}`;
  return namespace.substring(0, 64);
}

