const Tiktok = require('@tobyg74/tiktok-api-dl');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const http = require('http');
const { CustomError } = require('./errors');

class TikTokDownloader {
  constructor() {
    this.tempDir = '/tmp';
    // /tmp directory already exists in most systems, no need to create
  }

  /**
   * Download file from URL
   * @param {string} url - URL to download from
   * @param {string} filepath - Path to save the file
   * @returns {Promise<string>} - Path to downloaded file
   */
  downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
      // Validate URL parameter
      if (!url || typeof url !== 'string') {
        reject(new Error(`Invalid URL provided: ${url}`));
        return;
      }

      const client = url.startsWith('https://') ? https : http;
      const file = fs.createWriteStream(filepath);

      client.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve(filepath);
        });

        file.on('error', (err) => {
          fs.unlink(filepath, () => {}); // Delete the file on error
          reject(err);
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Sanitize filename for safe filesystem usage
   * @param {string} filename - Original filename
   * @returns {string} - Sanitized filename
   */
  sanitizeFilename(filename) {
    if (!filename) return 'unknown';
    return filename.replace(/[^a-z0-9.-]/gi, '_').substring(0, 100);
  }

  /**
   * Generate unique filename
   * @param {string} author - Video author
   * @param {string} desc - Video description
   * @param {string} id - Video ID
   * @param {string} extension - File extension
   * @returns {string} - Generated filename
   */
  generateFilename(author, desc, id, extension) {
    const timestamp = Date.now();
    const sanitizedAuthor = this.sanitizeFilename(author || 'unknown');
    const sanitizedDesc = this.sanitizeFilename(desc || 'video');
    return `${sanitizedAuthor}_${sanitizedDesc}_${id}_${timestamp}.${extension}`;
  }

  /**
   * Download TikTok content (video and images only, no audio)
   * @param {string} url - TikTok URL
   * @param {string} version - API version (v1, v2, v3)
   * @returns {Promise<Object>} - Download result
   */
  async downloadTikTokContent(url, version = 'v1') {
    try {
      if (!url) {
        throw new CustomError("TikTok URL is required", 400);
      }

      console.log(`📥 Starting TikTok download for: ${url}`);

      // Get TikTok content info using the API
      const result = await Tiktok.Downloader(url, {
        version: version,
        showOriginalResponse: false
      });

      if (result.status !== 'success') {
        throw new CustomError(`Failed to extract TikTok content: ${result.message}`, 400);
      }

      const { result: data } = result;
      const downloadedFiles = [];

      // Debug: Log the data structure we received
      console.log(`📊 TikTok API returned data type: ${data.type}`);
      console.log(`📊 Video data available: ${!!(data.video && data.video.downloadAddr)}`);
      console.log(`📊 Images data available: ${!!(data.images && data.images.length > 0)}`);

      // Download video if it exists
      if (data.type === 'video' && data.video) {
        let videoUrl = null;
        
        // Try downloadAddr first, then fallback to playAddr
        if (data.video.downloadAddr && data.video.downloadAddr.length > 0) {
          videoUrl = data.video.downloadAddr[0];
          console.log(`📊 Using downloadAddr: ${videoUrl}`);
        } else if (data.video.playAddr && data.video.playAddr.length > 0) {
          videoUrl = data.video.playAddr[0];
          console.log(`📊 Using playAddr as fallback: ${videoUrl}`);
        }
        
        // Validate video URL
        if (!videoUrl || typeof videoUrl !== 'string') {
          console.error(`❌ No valid video URL found. downloadAddr: ${data.video.downloadAddr}, playAddr: ${data.video.playAddr}`);
          throw new CustomError('No valid video URL found in TikTok API response', 400);
        }

        const filename = this.generateFilename(
          data.author?.username,
          data.desc,
          data.id,
          'mp4'
        );
        const filepath = path.join(this.tempDir, filename);

        console.log(`🎥 Downloading video: ${filename}`);
        console.log(`🔗 Video URL: ${videoUrl}`);

        try {
          await this.downloadFile(videoUrl, filepath);
          const stats = await fs.stat(filepath);
          downloadedFiles.push({
            type: 'video',
            filename: filename,
            filepath: filepath,
            size: stats.size,
            url: videoUrl
          });
          console.log(` Video downloaded: ${filepath}`);
        } catch (error) {
          console.error(`❌ Video download failed: ${error.message}`);
          throw new CustomError(`Video download failed: ${error.message}`, 500);
        }
      }

      // Download images if it's a slide post
      if (data.type === 'image' && data.images && data.images.length > 0) {
        console.log(`🖼️ Downloading ${data.images.length} images`);
        console.log(`📝 Image post metadata:`);
        console.log(`   Caption: ${data.desc || 'No caption'}`);
        console.log(`   Author: ${data.author?.username || 'Unknown'}`);
        console.log(`   Music: ${data.music?.title || 'No music'} by ${data.music?.author || 'Unknown'}`);
        if (data.statistics) {
          console.log(`   Stats: ${data.statistics.playCount || 0} plays, ${data.statistics.shareCount || 0} shares`);
        }

        for (let i = 0; i < data.images.length; i++) {
          const imageUrl = data.images[i];
          
          // Validate image URL
          if (!imageUrl || typeof imageUrl !== 'string') {
            console.error(`❌ Invalid image URL received for image ${i + 1}: ${imageUrl}`);
            continue; // Skip this image and continue with others
          }

          const filename = this.generateFilename(
            data.author?.username,
            data.desc,
            `${data.id}_img${i + 1}`,
            'jpg'
          );
          const filepath = path.join(this.tempDir, filename);

          try {
            await this.downloadFile(imageUrl, filepath);
            const stats = await fs.stat(filepath);
            downloadedFiles.push({
              type: 'image',
              filename: filename,
              filepath: filepath,
              size: stats.size,
              url: imageUrl
            });
            console.log(` Image ${i + 1} downloaded: ${filepath}`);
          } catch (error) {
            console.error(`❌ Image ${i + 1} download failed: ${error.message}`);
            // Continue with other images instead of failing completely
          }
        }
      }

      if (downloadedFiles.length === 0) {
        throw new CustomError("No downloadable content found or all downloads failed", 404);
      }

      // Calculate total size
      const totalSize = downloadedFiles.reduce((sum, file) => sum + file.size, 0);

      return {
        success: true,
        message: `Successfully downloaded ${downloadedFiles.length} file(s)`,
        data: {
          tiktok_info: {
            id: data.id,
            description: data.desc,
            author: data.author?.username,
            type: data.type,
            statistics: data.statistics,
            music: data.music ? {
              title: data.music.title,
              author: data.music.author,
              album: data.music.album,
              playUrl: data.music.playUrl
            } : null,
            // Additional metadata for better content analysis
            hashtags: data.textExtra?.filter(item => item.hashtagName)?.map(item => item.hashtagName) || [],
            mentions: data.textExtra?.filter(item => item.userUniqueId)?.map(item => item.userUniqueId) || [],
            createTime: data.createTime,
            duration: data.video?.duration || null
          },
          downloads: downloadedFiles,
          summary: {
            total_files: downloadedFiles.length,
            total_size_bytes: totalSize,
            total_size_mb: (totalSize / 1024 / 1024).toFixed(2),
            download_directory: this.tempDir
          }
        }
      };

    } catch (error) {
      console.error('❌ TikTok download error:', error);
      
      if (error instanceof CustomError) {
        throw error;
      }
      
      throw new CustomError(`Failed to download TikTok content: ${error.message}`, 500);
    }
  }

  /**
   * Clean up downloaded files
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
   * Get TikTok video info without downloading
   * @param {string} url - TikTok URL
   * @param {string} version - API version
   * @returns {Promise<Object>} - Video metadata
   */
  async getTikTokInfo(url, version = 'v1') {
    try {
      if (!url) {
        throw new CustomError("TikTok URL is required", 400);
      }

      console.log(`ℹ️ Getting TikTok info for: ${url}`);

      const result = await Tiktok.Downloader(url, {
        version: version,
        showOriginalResponse: false
      });

      if (result.status !== 'success') {
        throw new CustomError(`Failed to extract TikTok content: ${result.message}`, 400);
      }

      const { result: data } = result;

      return {
        success: true,
        data: {
          id: data.id,
          description: data.desc,
          author: data.author?.username,
          type: data.type,
          statistics: data.statistics,
          music: data.music ? {
            title: data.music.title,
            author: data.music.author
          } : null,
          video_available: data.type === 'video' && data.video && data.video.downloadAddr,
          images_available: data.type === 'image' && data.images && data.images.length > 0,
          images_count: data.type === 'image' ? data.images?.length || 0 : 0
        }
      };

    } catch (error) {
      console.error('❌ TikTok info error:', error);
      
      if (error instanceof CustomError) {
        throw error;
      }
      
      throw new CustomError(`Failed to get TikTok info: ${error.message}`, 500);
    }
  }
}

module.exports = TikTokDownloader;
