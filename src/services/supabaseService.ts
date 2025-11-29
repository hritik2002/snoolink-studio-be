import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";

export class SupabaseService {
  private supabaseClient: SupabaseClient;
  constructor() {
    console.log("CONFIG.supabase.supabaseUrl, CONFIG.supabase.supabaseKey", {
      ...CONFIG.supabase,
    });
    this.supabaseClient = createClient(
      CONFIG.supabase.supabaseUrl,
      CONFIG.supabase.supabaseKey
    );
  }

  async getImages() {
    const { data, error } = await this.supabaseClient
      .from("resource_table")
      .select("*");
    if (error) throw error;
    const images = data
      .filter((image) => image.resource_type === "image")
      .map((image) => ({
        id: image.id,
        imageUrl: image.resource_url,
        description: image.description,
      }));

    return images;
  }

  async postImages(
    images: { id: string; description: string; imageUrl: string }[]
  ): Promise<{ id: string }[] | null> {
    const { data, error } = await this.supabaseClient
      .from("resource_table")
      .insert(
        images.map((image) => ({
          resource_url: image.imageUrl,
          description: image.description,
          resource_type: "image",
          user_id: "123",
        }))
      );
    if (error) throw error;

    return data;
  }
}
