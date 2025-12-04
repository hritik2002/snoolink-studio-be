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

  async getImages(userId: string) {
    const { data, error } = await this.supabaseClient
      .from("resource_table")
      .select("*")
      .eq("user_id", userId)
      .eq("resource_type", "image");
    if (error) throw error;
    const images = data.map((image) => ({
      id: image.id,
      imageUrl: image.resource_url,
      description: image.description,
    }));

    return images;
  }

  async postImages(
    images: { id: string; description: string; imageUrl: string }[],
    userId: string
  ): Promise<{ id: string }[] | null> {
    const { data, error } = await this.supabaseClient
      .from("resource_table")
      .insert(
        images.map((image) => ({
          resource_url: image.imageUrl,
          description: image.description,
          resource_type: "image",
          user_id: userId,
        }))
      );
    if (error) throw error;

    return data;
  }

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
}
