export class VideoDatabase {
  constructor() {
    this.videos = new Map();
  }

  store(id, videoData) {
    this.videos.set(id, videoData);
  }

  get(id) {
    return this.videos.get(id);
  }

  getAll() {
    return Array.from(this.videos.values());
  }

  findByVideoId(videoId) {
    return this.getAll().find((video) => video.videoId === videoId);
  }

  update(id, updates) {
    const existing = this.get(id);
    if (existing) {
      this.store(id, { ...existing, ...updates });
    }
  }

  delete(id) {
    return this.videos.delete(id);
  }

  deleteByVideoId(videoId) {
    const entry = Array.from(this.videos.entries()).find(
      ([_, video]) => video.videoId === videoId
    );
    if (entry) {
      return this.delete(entry[0]);
    }
    return false;
  }
}
