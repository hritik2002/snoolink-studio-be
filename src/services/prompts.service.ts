import { createSupabaseClient } from "../lib/supabase.client";

export interface PromptRow {
  id: string;
  model: string;
  prompt: string;
  creator: string;
  created_at: string;
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);


export function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export class PromptsService {
  private supabase = createSupabaseClient();

  async list(): Promise<PromptRow[]> {
    const { data, error } = await this.supabase
      .from("prompts")
      .select("id, model, prompt, creator, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []) as PromptRow[];
  }

  async getByModel(model: string): Promise<PromptRow | null> {
    const { data, error } = await this.supabase
      .from("prompts")
      .select("id, model, prompt, creator, created_at")
      .eq("model", model)
      .single();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    return data as PromptRow;
  }

  async create(model: string, prompt: string, creator: string): Promise<PromptRow> {
    const { data, error } = await this.supabase
      .from("prompts")
      .insert({ model: model.trim(), prompt: prompt.trim(), creator: creator.trim() })
      .select("id, model, prompt, creator, created_at")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("A prompt with this model name already exists.");
      throw error;
    }
    return data as PromptRow;
  }
}

export const promptsService = new PromptsService();
