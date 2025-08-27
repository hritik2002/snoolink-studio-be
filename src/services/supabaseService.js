import { createClient } from "@supabase/supabase-js";

export class SupabaseService {
  constructor() {
    this.client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    this.table = "videos_table";
  }

  async insertVideo({ twelveLabsVideoId, videoUrl }) {
    const { data: insertedData, error } = await this.client
      .from(this.table)
      .insert([
        {
          twelve_labs_video_id: twelveLabsVideoId,
          video_url: videoUrl,
        },
      ])
      .select()
      .single();

    if (error) throw new Error(`Supabase Insert Error: ${error.message}`);
    return insertedData;
  }

  async getVideoById(id) {
    const { data, error } = await this.client
      .from(this.table)
      .select("*")
      .eq("twelve_labs_video_id", id)
      .single();

    if (error) throw new Error(`Supabase Fetch Error: ${error.message}`);
    return data;
  }

  async getVideosByIds(ids) {
    const { data, error } = await this.client
      .from(this.table)
      .select("*")
      .in("twelve_labs_video_id", ids);

    return data;
  }


  async getAllVideos() {
    const { data, error } = await this.client.from(this.table).select("*");

    if (error) throw new Error(`Supabase Fetch Error: ${error.message}`);
    return data;
  }


  async updateVideoUrl(id, videoUrl) {
    const { data, error } = await this.client
      .from(this.table)
      .update({ video_url: videoUrl })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Supabase Update Error: ${error.message}`);
    return data;
  }


  async deleteVideo(id) {
    const { error } = await this.client.from(this.table).delete().eq("id", id);

    if (error) throw new Error(`Supabase Delete Error: ${error.message}`);
    return true;
  }
}
