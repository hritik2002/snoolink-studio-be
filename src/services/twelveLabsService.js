import axios from "axios";
import { TwelveLabs } from "twelvelabs-js";
import { VideoDatabase } from "./videoDatabase.js";

const BASE_URL = "https://api.twelvelabs.io/v1.2";

export class TwelveLabsService {
  constructor(apiKey) {
    this.apiKey = process.env.TWELVE_LABS_API_KEY;
    this.indexId = process.env.TWELVE_LABS_INDEX_ID;
    this.client = new TwelveLabs({
      apiKey: this.apiKey,
    });
    this.database = new VideoDatabase();

    this.baseUrl = "https://api.twelvelabs.io/v1.3";
  }

  async createIndex(name, engines = ["marengo2.6"]) {
    return await this.client.indexes.create({ name, engines });
  }

  async getIndexes() {
    const indexes = [];

    const url = `${this.baseUrl}/indexes`;
    const options = {
      method: "GET",
      headers: { "x-api-key": this.apiKey },
    };

    const response = await axios(url, options);
    const { data: indexesData } = response.data;

    for await (const index of indexesData) {
      indexes.push(index);
    }

    return indexes;
  }

  async getIndex(indexName) {
    const url = `${this.baseUrl}/indexes`;
    const options = {
      method: "GET",
      headers: { "x-api-key": this.apiKey },
      params: { index_name: indexName },
    };

    const response = await axios(url, options);
    const { data: indexData } = response.data;

    return indexData;
  }

  async uploadVideo({ videoUrl, indexId, language = "en" }) {
    const task = await this.client.tasks.create({
      indexId,
      videoUrl,
      language,
    });

    const videoData = {
      id: task.id,
      taskId: task.id,
      videoUrl,
      indexId,
      status: task.status,
      uploadedAt: new Date().toISOString(),
    };

    return { task, videoData };
  }

  async getTask(taskId) {
    const task = await this.client.tasks.retrieve(taskId);

    if (this.database.get(taskId)) {
      const updates = { status: task.status };
      if (task.videoId) updates.videoId = task.videoId;
      this.database.update(taskId, updates);
    }

    return task;
  }

  async getTasks() {
    const tasks = [];
    for await (const task of this.client.tasks.list()) {
      tasks.push(task);
    }
    return tasks;
  }

  async analyzeVideo(videoId) {
    const video = await this.client.analyze({
      videoId,
      prompt:
        "Chapterize this video & please return the chapters in a json format",
    });

    return video;
  }

  async searchVideos(searchParams) {
    const url = "https://api.twelvelabs.io/v1.3/search";
    const form = new FormData();
    form.append("query_media_type", "");
    form.append("query_media_url", "");
    form.append("query_media_file", "<file1>");
    form.append("query_text", searchParams.query);
    form.append("index_id", this.indexId);
    form.append("adjust_confidence_level", "0.5");
    form.append("group_by", "clip");
    form.append("threshold", "");
    form.append("sort_option", "score");
    form.append("operator", "or");
    form.append("page_limit", "10");
    form.append("include_user_metadata", "");
    form.append("search_options", "visual");
    form.append("search_options", "audio");

    const options = {
      method: "POST",
      headers: { "x-api-key": this.apiKey },
    };
    options.body = form;
    try {
      const response = await fetch(url, options);
      const data = await response.json();

      return data;
    } catch (error) {
      console.error(error);

      return error;
    }
  }

  async getVideo(videoId) {
    const video = await this.client.video.retrieve(videoId);
    return {
      ...video,
      metadata: this.database.findByVideoId(videoId) || null,
    };
  }

  async getVideos(indexId) {
    if (!indexId) {
      return this.database.getAll();
    }

    const videos = [];
    for await (const video of this.client.video.list({ indexId })) {
      videos.push(video);
    }
    return videos;
  }

  async updateVideo(videoId, updateData) {
    return await this.client.video.update(videoId, updateData);
  }

  async deleteVideo(videoId) {
    await this.client.video.delete(videoId);
    this.database.deleteByVideoId(videoId);
  }

  async summarizeVideo(videoId, type = "summary") {
    return await this.client.generate.summarize({ videoId, type });
  }

  async generateText(videoId) {
    return await this.client.generate.text({ videoId });
  }
}
