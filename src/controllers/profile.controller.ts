import { SupabaseService } from "../services/supabaseService";

class ProfileController {
  private supabaseService: SupabaseService;
  constructor() {
    this.supabaseService = new SupabaseService();
  }

  async getProfile(userId: string) {
    const profile = await this.supabaseService.getProfile(userId);
    return profile;
  }

  async updateProfile(
    userId: string,
    profileData: { name?: string; email?: string }
  ) {
    const updatedProfile = await this.supabaseService.updateProfile(
      userId,
      profileData
    );
    return updatedProfile;
  }

  /**
   * Ensures user profile exists and is synced with auth data
   * Called after OAuth login to store user data
   */
  async ensureProfile(userId: string) {
    await this.supabaseService.ensureProfile(userId);
  }
}

export default ProfileController;

