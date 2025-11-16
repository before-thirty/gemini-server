const express = require('express');
const asyncHandler = require('express-async-handler')

const { getPostId, getVideoUrl, getAllMediaAssets } = require('../lib/utils');
const { handleBlockedResources } = require('../lib/scraper');
const VideoService = require('../lib/videoService');
const GeminiService = require('../lib/geminiService');
const TikTokDownloader = require('../lib/tiktokDownloader');
const axios = require('axios');

const router = express.Router();

// Function to validate YouTube URLs
function isYouTubeUrl(url) {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-]+(&[\w=]*)?$/;
  return youtubeRegex.test(url);
}

// Function to call external API (fire and forget)
function updateContent(contentId, content) {
  console.log(`Sending to external API (fire and forget) - contentId: ${contentId}`);
  console.log(`Content preview: ${content} `);
  
  // True fire and forget - completely detached from main execution
  process.nextTick(async () => {
    try {
      await axios({
        method: 'POST',
        url: 'https://node-server-759920477799.asia-south1.run.app/api/update-content',
        data: {
          content_id: contentId,
          content: content
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000, // Reduced timeout
        // Add these options to ensure it doesn't hang
        maxRedirects: 3,
        validateStatus: () => true, // Accept any status code
      });
      console.log(`Successfully sent content to external API - contentId: ${contentId}`);
    } catch (error) {
      // Log error but don't throw - this is fire and forget
      console.warn(`Fire-and-forget API call failed for contentId: ${contentId}`, error.message);
      // Optionally, you could implement a retry mechanism here
      // or log to a monitoring service
    }
  });
  
  // Return immediately without waiting
  return {
    success: true,
    message: 'Content sent to external API (fire and forget)',
    contentId: contentId
  };
}

function sendFailureStatus(contentId, errorMessage) {
  console.log(`Sending failure status to external API (fire and forget) - contentId: ${contentId}`);

  // True fire and forget - completely detached from main execution
  process.nextTick(async () => {
    try {
      await axios({
        method: 'PATCH',
        url: 'https://node-server-759920477799.asia-south1.run.app/api/update-content-status',
        data: {
          contentId: contentId,
          status: "FAILED",
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000,
        maxRedirects: 3,
        validateStatus: () => true,
      });
      console.log(`Failure status sent to external API - contentId: ${contentId}`);
    } catch (error) {
      console.warn(`Failed to send failure status to external API for contentId: ${contentId}`, error.message);
    }
  });
}

router.get('/video', asyncHandler(async (req, res, next) => {
  const inputUrl = req.query.url;
  const { scraper } = req;

  const postId = getPostId(inputUrl);


  // Check if cached response exists
  const cachedResponse = await scraper.isAlreadyProcessed(postId)
  if (cachedResponse) {
    return res.status(200).json(cachedResponse);
  }

  // Scrape post webpage
  let html;
  let currentPage;
  try {
    const postUrl = `https://www.instagram.com/p/${postId}/`;
    // Open new browser tab
    currentPage = await scraper.browser.newPage();
    // Intercept and block certain resource types for better performance
    await currentPage.setRequestInterception(true);
    currentPage.on("request", handleBlockedResources);
    // Load post page
    scraper.addActivePost(postId);
    await currentPage.goto(postUrl, { waitUntil: 'networkidle0' });
    html = await currentPage.content();
  } catch (error) {
    return next(error);
  } finally {
    scraper.removeActivePost(postId);
    await currentPage.close();
  }

  // Parse page HTML to get all media assets
  const mediaAssets = getAllMediaAssets(html, postId);
  
  // For backward compatibility, we'll return the first video URL if available,
  // otherwise the first image URL
  let primaryUrl = null;
  if (mediaAssets && mediaAssets.length > 0) {
    // Find the first video, or fallback to the first image
    const videoAsset = mediaAssets.find(asset => asset.type === 'video');
    primaryUrl = videoAsset ? videoAsset.url : mediaAssets[0].url;
  }

  const response = {
    mediaAssets: mediaAssets, // Include all media assets
    primaryUrl: primaryUrl   // Maintain backward compatibility
  };
  scraper.setCache(postId, response);
  return res.status(200).send(response);

}));

// New endpoint for video analysis with Gemini
router.get('health', () => {
   return res.status(200).json({ message: "i'm healthy"})
})

router.post('/analyze', asyncHandler(async (req, res, next) => {
  const { url: inputUrl, contentId } = req.body;
  const { scraper } = req;

  if (!inputUrl) {
    return res.status(400).json({ error: 'URL is required in request body' });
  }

  if (!contentId) {
    return res.status(400).json({ error: 'contentId is required in request body' });
  }

  // Check if it's a YouTube URL
  if (isYouTubeUrl(inputUrl)) {
    let geminiService = null;

    try {
      // Initialize Gemini service
      geminiService = new GeminiService();

      // Create a cache key for YouTube videos
      const youtubeId = inputUrl.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/)?.[1] || inputUrl;
      const cacheKey = `youtube_analysis_${youtubeId}`;

      // Check if cached analysis exists
      const cachedAnalysis = await scraper.getCache(cacheKey);
      if (cachedAnalysis) {
        const contentApiResult = updateContent(
          contentId,
          cachedAnalysis.analysis.raw_response || cachedAnalysis.analysis.result.raw_response
        );
        return res.status(200).json({
          success: true,
          cached: true,
          platform: 'youtube',
          youtubeId,
          ...cachedAnalysis,
          contentApiResponse: {
            success: true,
            message: 'Cached result - API call skipped',
            contentId: contentId
          }
        });
      }

      // Process YouTube video directly
      console.log('Processing YouTube video with Gemini...');
      const analysisResult = await geminiService.processYouTubeVideo(inputUrl);

      // Send content to external API (fire and forget)
      console.log('Sending YouTube content to external API...');
      const contentApiResult = updateContent(
        contentId,
        analysisResult.raw_response || analysisResult.result.raw_response
      );

      // Cache the result
      const responseData = {
        success: true,
        platform: 'youtube',
        youtubeId,
        youtubeUrl: inputUrl,
        analysis: analysisResult,
        contentApiResponse: contentApiResult
      };

      await scraper.setCache(cacheKey, responseData, 7200); // Cache for 2 hours

      return res.status(200).json(responseData);

    } catch (error) {
      console.error('Error in YouTube video analysis:', error.message);

      if (contentId) {
        sendFailureStatus(contentId, error.message);
      }
      
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          success: false
        });
      }
      
      return res.status(500).json({
        error: 'Internal server error during YouTube video analysis',
        success: false
      });
    }
  }

  // Continue with Instagram processing for non-YouTube URLs
  const postId = getPostId(inputUrl);
  let videoService = null;
  let geminiService = null;
  let downloadedMediaPaths = [];

  try {
    // Initialize services
    videoService = new VideoService();
    geminiService = new GeminiService();

    // Check if cached analysis exists
    const cacheKey = `analysis_${postId}`;
    const cachedAnalysis = await scraper.getCache(cacheKey);
    if (cachedAnalysis) {
      const contentApiResult = updateContent(
      contentId,
      cachedAnalysis.analysis.raw_response || cachedAnalysis.analysis.result.raw_response
      );
      return res.status(200).json({
        success: true,
        cached: true,
        postId,
        ...cachedAnalysis,
        contentApiResponse: {
          success: true,
          message: 'Cached result - API call skipped',
          contentId: contentId
        }
      });
    }

    // Get all media assets using new scraping logic
    let html;
    let currentPage;
    try {
      const postUrl = `https://www.instagram.com/p/${postId}/`;
      currentPage = await scraper.browser.newPage();
      await currentPage.setRequestInterception(true);
      currentPage.on("request", handleBlockedResources);
      scraper.addActivePost(postId);
      await currentPage.goto(postUrl, { waitUntil: 'networkidle0' });
      html = await currentPage.content();
    } catch (error) {
      return next(error);
    } finally {
      scraper.removeActivePost(postId);
      if (currentPage) {
        await currentPage.close();
      }
    }

    // Extract all media assets
    // console.log(html)
    const mediaAssets = getAllMediaAssets(html, postId);

    if (!mediaAssets || mediaAssets.length === 0) {
      if (contentId) {
        sendFailureStatus(contentId, error.message);
      }
      return res.status(404).json({ error: 'No media found in the provided URL' });
    }

    // Download all media assets
    console.log(`Downloading ${mediaAssets.length} media assets for analysis...`);
    downloadedMediaPaths = await videoService.downloadMediaAssets(mediaAssets, postId);

    // Process media assets based on their types
    let analysisResult;
    
    // If there's only one asset, use the appropriate processing method
    if (downloadedMediaPaths.length === 1) {
      const asset = downloadedMediaPaths[0];
      if (asset.type === 'video') {
        console.log('Analyzing single video with Gemini...');
        analysisResult = await geminiService.processVideo(asset.path);
      } else {
        console.log('Analyzing single image with Gemini...');
        analysisResult = await geminiService.processImages([asset.path]);
      }
    } else {
      // For multiple assets, use mixed media processing
      console.log('Analyzing mixed media with Gemini...');
      analysisResult = await geminiService.processMixedMedia(downloadedMediaPaths);
    }

    // Send content to external API (fire and forget)
    console.log('Sending content to external API...');
    const contentApiResult = updateContent(
      contentId,
      analysisResult.raw_response || analysisResult.result.raw_response
    );

    // Cache the result
    const responseData = {
      success: true,
      postId,
      mediaAssets: mediaAssets, // Include all media assets in response
      analysis: analysisResult,
      contentApiResponse: contentApiResult
    };

    await scraper.setCache(cacheKey, responseData, 7200); // Cache for 2 hours

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error in media analysis:', error.message);

    if (contentId) {
      sendFailureStatus(contentId, error.message);
    }
    
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        success: false
      });
    }
    
    return res.status(500).json({
      error: 'Internal server error during media analysis',
      success: false
    });
    
  } finally {
    // Cleanup downloaded media files
    if (videoService && downloadedMediaPaths.length > 0) {
      const filePaths = downloadedMediaPaths.map(asset => asset.path);
      await videoService.cleanup(filePaths);
    }
  }
}));

// TikTok download endpoint
router.post('/download', asyncHandler(async (req, res, next) => {
  const { url, version = 'v1' } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      message: "TikTok URL is required"
    });
  }

  let tiktokDownloader = null;
  let downloadedFiles = [];

  try {
    // Initialize TikTok downloader
    tiktokDownloader = new TikTokDownloader();

    // Download TikTok content (video and images only, no audio)
    const result = await tiktokDownloader.downloadTikTokContent(url, version);

    // Extract file paths for potential cleanup
    downloadedFiles = result.data.downloads.map(file => file.filepath);

    // Return success response
    res.status(200).json(result);

  } catch (error) {
    console.error('Error in TikTok download:', error.message);
    if (contentId) {
      sendFailureStatus(contentId, error.message);
    }
    
    if (error.statusCode) {
      return res.status(error.statusCode).json({ 
        success: false,
        message: error.message
      });
    }
    
    return res.status(500).json({ 
      success: false,
      message: "Failed to download TikTok content",
      error: error.message
    });
    
  } finally {
    // Note: Files are kept in temp directory and not automatically cleaned up
    // They can be cleaned up later or used for further processing
    console.log(`Downloaded files saved in temp directory: ${downloadedFiles.length} files`);
  }
}));

// TikTok info endpoint (get metadata without downloading)
router.get('/tiktok-info', asyncHandler(async (req, res, next) => {
  const { url, version = 'v1' } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      message: "TikTok URL is required"
    });
  }

  try {
    const tiktokDownloader = new TikTokDownloader();
    const result = await tiktokDownloader.getTikTokInfo(url, version);

    res.status(200).json(result);

  } catch (error) {
    console.error('Error getting TikTok info:', error.message);
    
    if (error.statusCode) {
      return res.status(error.statusCode).json({ 
        success: false,
        message: error.message
      });
    }
    
    return res.status(500).json({ 
      success: false,
      message: "Failed to get TikTok info",
      error: error.message
    });
  }
}));

// TikTok video analysis with Gemini AI
router.post('/tiktok-analyze', asyncHandler(async (req, res, next) => {
  const { url, contentId, version = 'v1' } = req.body;
  const { scraper } = req;

  if (!url) {
    return res.status(400).json({
      success: false,
      message: "TikTok URL is required in request body"
    });
  }

  if (!contentId) {
    return res.status(400).json({
      success: false,
      message: "contentId is required in request body"
    });
  }

  let tiktokDownloader = null;
  let geminiService = null;
  let downloadedFiles = [];

  try {
    // Initialize services
    tiktokDownloader = new TikTokDownloader();
    geminiService = new GeminiService();

    // Check cache first
    const cacheKey = `tiktok_analysis_${url}`;
    const cachedAnalysis = await scraper.getCache(cacheKey);
    if (cachedAnalysis) {
      const contentApiResult = updateContent(contentId, cachedAnalysis.analysis.raw_response);
      return res.status(200).json({
        success: true,
        cached: true,
        ...cachedAnalysis,
        contentApiResponse: contentApiResult
      });
    }

    // Download TikTok content first
    console.log('Downloading TikTok content for analysis...');
    const downloadResult = await tiktokDownloader.downloadTikTokContent(url, version);

    if (!downloadResult.success || !downloadResult.data.downloads.length) {
      return res.status(404).json({
        success: false,
        message: 'No content found in the provided TikTok URL'
      });
    }

    let analysisResult;
    const contentType = downloadResult.data.tiktok_info.type;
    downloadedFiles = downloadResult.data.downloads.map(file => file.filepath);

    if (contentType === 'video') {
      // Analyze TikTok video with Gemini
      console.log('Analyzing TikTok video with Gemini...');
      const videoFile = downloadResult.data.downloads.find(file => file.type === 'video');
      
      if (!videoFile) {
        throw new CustomError('Video file not found after download', 500);
      }

      analysisResult = await geminiService.processVideo(videoFile.filepath);
    } else if (contentType === 'image') {
      // Analyze TikTok images with Gemini
      console.log('Analyzing TikTok images with Gemini...');
      const imageFiles = downloadResult.data.downloads.filter(file => file.type === 'image');
      
      if (!imageFiles.length) {
        throw new CustomError('Image files not found after download', 500);
      }

      const imagePaths = imageFiles.map(file => file.filepath);
      analysisResult = await geminiService.processImages(imagePaths);
    } else {
      throw new CustomError(`Unsupported TikTok content type: ${contentType}`, 400);
    }

    // Prepare content with caption appended
    let finalContent = analysisResult.raw_response || analysisResult.result.raw_response;
    
    // Append TikTok caption/description to the content
    if (downloadResult.data.tiktok_info.description) {
      finalContent += `\n\nOriginal Caption: ${downloadResult.data.tiktok_info.description}`;
    }
    
    // Send content to external API (fire and forget)
    console.log('Sending TikTok content to external API...');
    const contentApiResult = updateContent(contentId, finalContent);

    // Prepare response
    const responseData = {
      success: true,
      platform: 'tiktok',
      content_type: contentType,
      tiktok_info: downloadResult.data.tiktok_info,
      downloaded_files: downloadResult.data.downloads.length,
      analysis: analysisResult,
      contentApiResponse: contentApiResult
    };

    // Cache the result for 2 hours
    await scraper.setCache(cacheKey, responseData, 7200);

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error in TikTok analysis:', error.message);
    if (contentId) {
      sendFailureStatus(contentId, error.message);
    }
    
    if (error.statusCode) {
      return res.status(error.statusCode).json({ 
        success: false,
        message: error.message
      });
    }
    
    return res.status(500).json({ 
      success: false,
      message: "Internal server error during TikTok analysis",
      error: error.message
    });
    
  } finally {
    // Cleanup downloaded files
    if (tiktokDownloader && downloadedFiles.length > 0) {
      await tiktokDownloader.cleanup(downloadedFiles);
    }
  }
}));

// Health check endpoint for Docker
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    services: {
      gemini: process.env.GEMINI_API_KEY ? 'configured' : 'missing',
      node_version: process.version,
      platform: process.platform
    }
  });
});

module.exports = router;
