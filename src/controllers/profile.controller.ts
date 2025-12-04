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
}

export default ProfileController;

