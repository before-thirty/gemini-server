const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { CustomError } = require('./errors');

class VideoService {
  constructor() {
    this.tempDir = '/tmp';
    // /tmp directory already exists in most systems, no need to create
  }

  /**
   * Download video from URL
   * @param {string} videoUrl - URL of the video to download
   * @param {string} filename - Name for the downloaded file
   * @returns {Promise<string>} - Path to downloaded file
   */
  async downloadVideo(videoUrl, filename = null) {
    try {
      if (!filename) {
        filename = `video_${Date.now()}.mp4`;
      }
      
      const filePath = path.join(this.tempDir, filename);
      
      console.log(`Downloading video from: ${videoUrl}`);
      
      const response = await axios({
        method: 'GET',
        url: videoUrl,
        responseType: 'stream',
        timeout: 60000, // 60 seconds timeout
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(` Video downloaded to: ${filePath}`);
          resolve(filePath);
        });
        writer.on('error', reject);
      });
    } catch (error) {
      console.error('Error downloading video:', error.message);
      throw new CustomError(`Failed to download video: ${error.message}`, 500);
    }
  }

  /**
   * Download media file (image or video) from URL
   * @param {string} mediaUrl - URL of the media to download
   * @param {string} filename - Name for the downloaded file
   * @returns {Promise<string>} - Path to downloaded file
   */
  async downloadMedia(mediaUrl, filename = null) {
    try {
      if (!filename) {
        // Generate filename based on URL and timestamp
        const urlParts = mediaUrl.split('/');
        const filePart = urlParts[urlParts.length - 1].split('?')[0];
        filename = `${filePart}_${Date.now()}`;
      }
      
      const filePath = path.join(this.tempDir, filename);
      
      console.log(`Downloading media from: ${mediaUrl}`);
      
      const response = await axios({
        method: 'GET',
        url: mediaUrl,
        responseType: 'stream',
        timeout: 60000, // 60 seconds timeout
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(` Media downloaded to: ${filePath}`);
          resolve(filePath);
        });
        writer.on('error', reject);
      });
    } catch (error) {
      console.error('Error downloading media:', error.message);
      throw new CustomError(`Failed to download media: ${error.message}`, 500);
    }
  }

  /**
   * Download multiple media assets
   * @param {Array<Object>} mediaAssets - Array of media assets with type and url
   * @param {string} postId - Post ID for naming files
   * @returns {Promise<Array<string>>} - Array of paths to downloaded files
   */
  async downloadMediaAssets(mediaAssets, postId) {
    try {
      const downloadedPaths = [];
      
      for (let i = 0; i < mediaAssets.length; i++) {
        const asset = mediaAssets[i];
        const filename = `${postId}_${i}.${asset.type === 'video' ? 'mp4' : 'jpg'}`;
        const filePath = await this.downloadMedia(asset.url, filename);
        downloadedPaths.push({
          type: asset.type,
          path: filePath
        });
      }
      
      return downloadedPaths;
    } catch (error) {
      console.error('Error downloading media assets:', error.message);
      throw new CustomError(`Failed to download media assets: ${error.message}`, 500);
    }
  }

  /**
   * Compress video using FFmpeg to reduce file size for Gemini
   * @param {string} inputPath - Path to input video file
   * @param {string} outputPath - Path for compressed video output
   * @returns {Promise<string>} - Path to compressed video
   */
  async compressVideo(inputPath, outputPath = null) {
    try {
      if (!outputPath) {
        const inputName = path.basename(inputPath, path.extname(inputPath));
        outputPath = path.join(this.tempDir, `${inputName}_compressed.mp4`);
      }

      console.log('Compressing video for Gemini processing...');

      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .videoBitrate('1000k')
          .audioBitrate('96k')
          .videoFilters('scale=-2:240') // Scale to 240p height
          .addOptions([
            '-preset veryfast',
            '-crf 28',
            '-movflags +faststart'
          ])
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`Compression progress: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            console.log(` Video compressed successfully: ${outputPath}`);
            resolve(outputPath);
          })
          .on('error', (err) => {
            console.error('FFmpeg error:', err.message);
            reject(new CustomError(`Video compression failed: ${err.message}`, 500));
          })
          .save(outputPath);
      });
    } catch (error) {
      console.error('Error in video compression:', error.message);
      throw new CustomError(`Video compression failed: ${error.message}`, 500);
    }
  }

  /**
   * Get video file information
   * @param {string} filePath - Path to video file
   * @returns {Promise<Object>} - Video metadata
   */
  async getVideoInfo(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(new CustomError(`Failed to get video info: ${err.message}`, 500));
        } else {
          resolve(metadata);
        }
      });
    });
  }

  /**
   * Clean up temporary files
   * @param {string[]} filePaths - Array of file paths to delete
   */
  async cleanup(filePaths) {
    try {
      for (const filePath of filePaths) {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          console.log(`🗑️ Cleaned up file: ${filePath}`);
        }
      }
    } catch (error) {
      console.error('Error during cleanup:', error.message);
    }
  }

  /**
   * Clean up all files in temp directory
   */
  async cleanupAll() {
    try {
      const files = await fs.readdir(this.tempDir);
      const filePaths = files.map(file => path.join(this.tempDir, file));
      await this.cleanup(filePaths);
      console.log('🗑️ All temporary files cleaned up');
    } catch (error) {
      console.error('Error during cleanup all:', error.message);
    }
  }
}

module.exports = VideoService;
