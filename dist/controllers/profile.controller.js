import { SupabaseService } from "../services/supabaseService";
class ProfileController {
    supabaseService;
    constructor() {
        this.supabaseService = new SupabaseService();
    }
    async getProfile(userId) {
        const profile = await this.supabaseService.getProfile(userId);
        return profile;
    }
    async updateProfile(userId, profileData) {
        const updatedProfile = await this.supabaseService.updateProfile(userId, profileData);
        return updatedProfile;
    }
}
export default ProfileController;
