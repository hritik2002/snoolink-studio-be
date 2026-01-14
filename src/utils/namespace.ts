/**
 * Namespace formats:
 * - Collection namespace: {userId}-{resourceType}-{collectionName}
 *   Examples: "abc123-image-default", "abc123-video-travel"
 * 
 * - Legacy namespace (for backward compatibility): user-{userId}-{resourceType}s
 *   Examples: "user-abc123-images", "user-abc123-videos"
 */

/**
 * Creates a collection-aware Pinecone namespace
 * Format: {userId}-{resourceType}-{collectionName}
 * 
 * @param userId - The user's unique identifier
 * @param collectionName - The collection name
 * @param resourceType - "image" or "video"
 * @returns Namespace like "abc123-image-default" or "abc123-video-travel"
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

/**
 * Creates namespaces for multiple collections
 * @param userId - The user's unique identifier
 * @param collections - Array of collection names
 * @param resourceType - "image" or "video"
 * @returns Array of namespaces
 */
export function createCollectionNamespaces(
  userId: string,
  collections: string[],
  resourceType: "image" | "video"
): string[] {
  return collections.map(collectionName => 
    createCollectionNamespace(userId, collectionName, resourceType)
  );
}

/**
 * Creates a legacy namespace (for backward compatibility)
 * Format: user-{userId}-{resourceType}s
 * 
 * @param userId - The user's unique identifier
 * @param resourceType - "image" or "video"
 * @returns Legacy namespace like "user-abc123-images" or "user-abc123-videos"
 */
export function createUserNamespace(
  userId: string, 
  resourceType: "image" | "video" = "image"
): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const typeSuffix = resourceType === "video" ? "videos" : "images";
  const namespace = `user-${sanitized}-${typeSuffix}`;
  return namespace.substring(0, 64);
}
