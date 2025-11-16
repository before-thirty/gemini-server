const express = require('express');
const Tiktok = require('@tobyg74/tiktok-api-dl');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Ensure /tmp directory exists
const tmpDir = '/tmp';
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Helper function to download file from URL
const downloadFile = (url, filepath) => {
  return new Promise((resolve, reject) => {
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
};

// Helper function to sanitize filename
const sanitizeFilename = (filename) => {
  return filename.replace(/[^a-z0-9.-]/gi, '_').substring(0, 100);
};

// Helper function to generate unique filename
const generateFilename = (author, desc, id, extension) => {
  const timestamp = Date.now();
  const sanitizedAuthor = sanitizeFilename(author || 'unknown');
  const sanitizedDesc = sanitizeFilename(desc || 'video');
  return `${sanitizedAuthor}_${sanitizedDesc}_${id}_${timestamp}.${extension}`;
};

// Route: Download TikTok content to /tmp folder
app.post('/api/download', async (req, res) => {
  try {
    const { url, version = 'v1' } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "TikTok URL is required"
      });
    }

    console.log(`📥 Starting download for: ${url}`);

    // Get TikTok content info
    const result = await Tiktok.Downloader(url, {
      version: version,
      showOriginalResponse: false
    });

    if (result.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: "Failed to extract TikTok content",
        error: result.message
      });
    }

    const { result: data } = result;
    const downloadedFiles = [];

    // Download video if it exists
    if (data.type === 'video' && data.video && data.video.downloadAddr) {
      const videoUrl = data.video.downloadAddr[0];
      const filename = generateFilename(
        data.author?.username,
        data.desc,
        data.id,
        'mp4'
      );
      const filepath = path.join(tmpDir, filename);

      console.log(`🎥 Downloading video: ${filename}`);

      try {
        await downloadFile(videoUrl, filepath);
        downloadedFiles.push({
          type: 'video',
          filename: filename,
          filepath: filepath,
          size: fs.statSync(filepath).size
        });
        console.log(` Video downloaded: ${filepath}`);
      } catch (error) {
        console.error(`❌ Video download failed: ${error.message}`);
      }
    }

    // Download images if it's a slide post
    if (data.type === 'image' && data.images && data.images.length > 0) {
      console.log(`🖼️ Downloading ${data.images.length} images`);

      for (let i = 0; i < data.images.length; i++) {
        const imageUrl = data.images[i];
        const filename = generateFilename(
          data.author?.username,
          data.desc,
          `${data.id}_img${i + 1}`,
          'jpg'
        );
        const filepath = path.join(tmpDir, filename);

        try {
          await downloadFile(imageUrl, filepath);
          downloadedFiles.push({
            type: 'image',
            filename: filename,
            filepath: filepath,
            size: fs.statSync(filepath).size
          });
          console.log(` Image ${i + 1} downloaded: ${filepath}`);
        } catch (error) {
          console.error(`❌ Image ${i + 1} download failed: ${error.message}`);
        }
      }
    }

    // Download audio if available
    if (data.music && data.music.playUrl && data.music.playUrl[0]) {
      const audioUrl = data.music.playUrl[0];
      const filename = generateFilename(
        data.music.author || data.author?.username,
        data.music.title,
        data.id,
        'mp3'
      );
      const filepath = path.join(tmpDir, filename);

      console.log(`🎵 Downloading audio: ${filename}`);

      try {
        await downloadFile(audioUrl, filepath);
        downloadedFiles.push({
          type: 'audio',
          filename: filename,
          filepath: filepath,
          size: fs.statSync(filepath).size
        });
        console.log(` Audio downloaded: ${filepath}`);
      } catch (error) {
        console.error(`❌ Audio download failed: ${error.message}`);
      }
    }

    if (downloadedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No downloadable content found or all downloads failed"
      });
    }

    // Calculate total size
    const totalSize = downloadedFiles.reduce((sum, file) => sum + file.size, 0);

    res.json({
      success: true,
      message: `Successfully downloaded ${downloadedFiles.length} file(s) to /tmp/`,
      data: {
        tiktok_info: {
          id: data.id,
          description: data.desc,
          author: data.author?.username,
          type: data.type,
          statistics: data.statistics
        },
        downloads: downloadedFiles,
        summary: {
          total_files: downloadedFiles.length,
          total_size_bytes: totalSize,
          total_size_mb: (totalSize / 1024 / 1024).toFixed(2),
          download_directory: tmpDir
        }
      }
    });

  } catch (error) {
    console.error('❌ Download error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to download TikTok content",
      error: error.message
    });
  }
});

// Route: List downloaded files in /tmp
app.get('/api/downloads', (req, res) => {
  try {
    const files = fs.readdirSync(tmpDir)
      .filter(file => file.includes('_') && (file.endsWith('.mp4') || file.endsWith('.jpg') || file.endsWith('.mp3')))
      .map(file => {
        const filepath = path.join(tmpDir, file);
        const stats = fs.statSync(filepath);
        return {
          filename: file,
          filepath: filepath,
          size: stats.size,
          size_mb: (stats.size / 1024 / 1024).toFixed(2),
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created)); // Sort by newest first

    res.json({
      success: true,
      data: {
        files: files,
        total_files: files.length,
        total_size_mb: files.reduce((sum, file) => sum + parseFloat(file.size_mb), 0).toFixed(2),
        directory: tmpDir
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to list downloads",
      error: error.message
    });
  }
});

// Route: Delete a specific downloaded file
app.delete('/api/downloads/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(tmpDir, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        success: false,
        message: "File not found"
      });
    }

    fs.unlinkSync(filepath);

    res.json({
      success: true,
      message: `File ${filename} deleted successfully`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete file",
      error: error.message
    });
  }
});

// Route: Clean up old files (older than specified days)
app.post('/api/cleanup', (req, res) => {
  try {
    const { days = 7 } = req.body; // Default: delete files older than 7 days
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    const files = fs.readdirSync(tmpDir);
    let deletedCount = 0;
    let deletedSize = 0;

    files.forEach(file => {
      const filepath = path.join(tmpDir, file);
      const stats = fs.statSync(filepath);

      if (stats.birthtime.getTime() < cutoffTime) {
        deletedSize += stats.size;
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    });

    res.json({
      success: true,
      message: `Cleanup completed`,
      data: {
        deleted_files: deletedCount,
        deleted_size_mb: (deletedSize / 1024 / 1024).toFixed(2),
        cutoff_days: days
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Cleanup failed",
      error: error.message
    });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: "TikTok downloader server is running",
    download_directory: tmpDir,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 TikTok Downloader Server running on port ${PORT}`);
  console.log(`📁 Downloads will be saved to: ${tmpDir}`);
  console.log(`📝 Available endpoints:`);
  console.log(`   POST /api/download - Download TikTok content to /tmp/`);
  console.log(`   GET  /api/downloads - List downloaded files`);
  console.log(`   DELETE /api/downloads/:filename - Delete specific file`);
  console.log(`   POST /api/cleanup - Clean up old files`);
  console.log(`   GET  /health - Health check`);
});

module.exports = app;