import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";

export class SupabaseService {
  private supabaseClient: SupabaseClient;
  constructor() {
    this.supabaseClient = createClient(
      CONFIG.supabase.supabaseUrl,
      CONFIG.supabase.supabaseKey
    );
  }

  // ============ Resource Methods ============

  async getImages(userId: string, collectionName?: string) {
    let query = this.supabaseClient
      .from("collections")
      .select("*")
      .eq("user_id", userId)
      .eq("resource_type", "image");

    if (collectionName) {
      query = query.eq("collection_name", collectionName);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    return data.map((image) => ({
      id: image.id,
      imageUrl: image.resource_url,
      description: image.description,
      collectionName: image.collection_name,
      createdAt: image.created_at,
    }));
  }

  async postImages(
    images: { id: string; description: string; imageUrl: string }[],
    userId: string,
    collectionName: string = "Default"
  ): Promise<{ id: number }[] | null> {
    const { data, error } = await this.supabaseClient
      .from("collections")
      .insert(
        images.map((image) => ({
          resource_url: image.imageUrl,
          description: image.description,
          resource_type: "image",
          user_id: userId,
          collection_name: collectionName,
        }))
      )
      .select();

    if (error) throw error;

    return data?.map((d) => ({ id: d.id })) || null;
  }

  async getVideos(userId: string, collectionName?: string) {
    let query = this.supabaseClient
      .from("collections")
      .select("*")
      .eq("user_id", userId)
      .eq("resource_type", "video");

    if (collectionName) {
      query = query.eq("collection_name", collectionName);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    return data.map((video) => ({
      id: video.id,
      videoUrl: video.resource_url,
      description: video.description,
      collectionName: video.collection_name,
      createdAt: video.created_at,
    }));
  }

  async postVideos(
    videos: { id: string; description: string; videoUrl: string }[],
    userId: string,
    collectionName: string = "Default"
  ): Promise<{ id: number }[] | null> {
    const { data, error } = await this.supabaseClient
      .from("collections")
      .insert(
        videos.map((video) => ({
          resource_url: video.videoUrl,
          description: video.description,
          resource_type: "video",
          user_id: userId,
          collection_name: collectionName,
        }))
      )
      .select();

    if (error) throw error;

    return data?.map((d) => ({ id: d.id })) || null;
  }

  // ============ Profile Methods ============

  async getProfile(userId: string) {
    const { data: profileData, error: profileError } = await this.supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (!profileError && profileData) {
      return {
        id: profileData.id,
        name: profileData.name || null,
        email: profileData.email || null,
      };
    }

    try {
      const { data: userData, error: userError } =
        await this.supabaseClient.auth.admin.getUserById(userId);

      if (userError) throw userError;

      return {
        id: userData.user.id,
        name: userData.user.user_metadata?.name || null,
        email: userData.user.email || null,
      };
    } catch (error) {
      return {
        id: userId,
        name: null,
        email: null,
      };
    }
  }

  async updateProfile(
    userId: string,
    profileData: { name?: string; email?: string }
  ) {
    const { data: profileTableData, error: profileError } =
      await this.supabaseClient
        .from("profiles")
        .upsert(
          {
            id: userId,
            name: profileData.name,
            email: profileData.email,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        )
        .select()
        .single();

    if (!profileError && profileTableData) {
      return profileTableData;
    }

    try {
      const { data: updateData, error: updateError } =
        await this.supabaseClient.auth.admin.updateUserById(userId, {
          user_metadata: {
            name: profileData.name,
          },
        });

      if (updateError) throw updateError;

      return {
        id: updateData.user.id,
        name: updateData.user.user_metadata?.name || null,
        email: updateData.user.email || null,
      };
    } catch (error: any) {
      throw new Error(`Failed to update profile: ${error.message}`);
    }
  }

  /**
   * Ensures user profile exists and is synced with auth user data
   * This is called after OAuth login to store user data
   */
  async ensureProfile(userId: string): Promise<void> {
    try {
      // Get user data from auth
      const { data: userData, error: userError } =
        await this.supabaseClient.auth.admin.getUserById(userId);

      if (userError) throw userError;

      const user = userData.user;
      const name =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.user_metadata?.display_name ||
        null;
      const email = user.email || null;

      // Try to upsert in profiles table
      const { error: upsertError } = await this.supabaseClient
        .from("profiles")
        .upsert(
          {
            id: userId,
            name: name,
            email: email,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );

      // If profiles table doesn't exist or upsert fails, update user_metadata as fallback
      if (upsertError) {
        await this.supabaseClient.auth.admin.updateUserById(userId, {
          user_metadata: {
            name: name,
            ...user.user_metadata,
          },
        });
      }
    } catch (error: any) {
      // Silently fail - profile will be created on first access
      console.error("Failed to ensure profile:", error);
    }
  }

  // ============ Collection Methods ============

  /**
   * Get Pinecone namespace for a collection
   * Format: {user_id}/{collection_name}
   */
  getPineconeNamespace(userId: string, collectionName: string): string {
    const sanitizedName = collectionName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    return `${userId}/${sanitizedName}`;
  }

  /**
   * Get all collections (distinct collection names) for a user with counts
   */
  async getCollections(userId: string) {
    // Get distinct collection names with counts
    const { data, error } = await this.supabaseClient
      .from("collections")
      .select("collection_name, resource_type, resource_url")
      .eq("user_id", userId);

    if (error) throw error;

    // Group by collection_name and compute counts
    const collectionMap = new Map<string, {
      imageCount: number;
      videoCount: number;
      thumbnailUrl: string | null;
      oldestDate: string | null;
    }>();

    for (const row of data) {
      const existing = collectionMap.get(row.collection_name) || {
        imageCount: 0,
        videoCount: 0,
        thumbnailUrl: null,
        oldestDate: null,
      };

      if (row.resource_type === "image") {
        existing.imageCount++;
        // Use first image as thumbnail
        if (!existing.thumbnailUrl) {
          existing.thumbnailUrl = row.resource_url;
        }
      } else if (row.resource_type === "video") {
        existing.videoCount++;
      }

      collectionMap.set(row.collection_name, existing);
    }

    // Convert to array
    const collections = Array.from(collectionMap.entries()).map(([name, stats]) => ({
      name,
      pineconeNamespace: this.getPineconeNamespace(userId, name),
      imageCount: stats.imageCount,
      videoCount: stats.videoCount,
      thumbnailUrl: stats.thumbnailUrl,
    }));

    return collections;
  }

  /**
   * Get a single collection info by name
   */
  async getCollection(userId: string, collectionName: string) {
    const { data, error } = await this.supabaseClient
      .from("collections")
      .select("*")
      .eq("user_id", userId)
      .eq("collection_name", collectionName);

    if (error) throw error;

    const imageCount = data.filter(r => r.resource_type === "image").length;
    const videoCount = data.filter(r => r.resource_type === "video").length;
    const firstImage = data.find(r => r.resource_type === "image");

    return {
      name: collectionName,
      pineconeNamespace: this.getPineconeNamespace(userId, collectionName),
      imageCount,
      videoCount,
      thumbnailUrl: firstImage?.resource_url || null,
    };
  }

  /**
   * Rename a collection (update all resources with old name to new name)
   */
  async renameCollection(userId: string, oldName: string, newName: string) {
    const { data, error } = await this.supabaseClient
      .from("collections")
      .update({ 
        collection_name: newName,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("collection_name", oldName)
      .select();

    if (error) throw error;

    return {
      name: newName,
      pineconeNamespace: this.getPineconeNamespace(userId, newName),
      updatedCount: data.length,
    };
  }

  /**
   * Delete a collection (delete all resources with that collection name)
   */
  async deleteCollection(userId: string, collectionName: string) {
    const { error, count } = await this.supabaseClient
      .from("collections")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("collection_name", collectionName);

    if (error) throw error;
    return { success: true, deletedCount: count || 0 };
  }

  /**
   * Get resources in a collection
   */
  async getCollectionResources(
    userId: string,
    collectionName: string,
    resourceType?: "image" | "video"
  ) {
    let query = this.supabaseClient
      .from("collections")
      .select("*")
      .eq("user_id", userId)
      .eq("collection_name", collectionName);

    if (resourceType) {
      query = query.eq("resource_type", resourceType);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) throw error;

    return data.map((resource) => ({
      id: resource.id,
      resourceUrl: resource.resource_url,
      resourceType: resource.resource_type,
      description: resource.description,
      collectionName: resource.collection_name,
      createdAt: resource.created_at,
    }));
  }

  /**
   * Move resources to a different collection
   */
  async moveResourcesToCollection(
    userId: string,
    resourceIds: number[],
    targetCollectionName: string
  ) {
    const { data, error } = await this.supabaseClient
      .from("collections")
      .update({ 
        collection_name: targetCollectionName,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .in("id", resourceIds)
      .select();

    if (error) throw error;
    return data;
  }

  /**
   * Delete resources by IDs
   */
  async deleteResources(userId: string, resourceIds: number[]) {
    const { error, count } = await this.supabaseClient
      .from("collections")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .in("id", resourceIds);

    if (error) throw error;
    return { success: true, deletedCount: count || 0 };
  }

  /**
   * Post images to a specific collection
   */
  async postImagesToCollection(
    images: { id: string; description: string; imageUrl: string }[],
    userId: string,
    collectionName: string
  ): Promise<{ id: number }[] | null> {
    return this.postImages(images, userId, collectionName);
  }

  /**
   * Post videos to a specific collection
   */
  async postVideosToCollection(
    videos: { id: string; description: string; videoUrl: string }[],
    userId: string,
    collectionName: string
  ): Promise<{ id: number }[] | null> {
    return this.postVideos(videos, userId, collectionName);
  }
}
