const cheerio = require('cheerio');
const { CustomError } = require('./errors');

const getPostId = (postUrl) => {
  const postRegex =
    /^https:\/\/(?:www\.)?instagram\.com\/p\/([a-zA-Z0-9_-]+)\/?/;
  const reelRegex =
    /^https:\/\/(?:www\.)?instagram\.com\/reels?\/([a-zA-Z0-9_-]+)\/?/;
  let postId;

  if (!postUrl) {
    throw new CustomError("Post URL is required", 400);
  }

  const postCheck = postUrl.match(postRegex);
  if (postCheck) {
    postId = postCheck.at(-1);
  }

  const reelCheck = postUrl.match(reelRegex);
  if (reelCheck) {
    postId = reelCheck.at(-1);
  }

  if (!postId) {
    throw new CustomError("Invalid URL, post ID not found", 400);
  }

  return postId;
};

const getVideoUrl = (html) => {
  const $ = cheerio.load(html);

  // Check if this post exists
  const isNotFound = $('main > div > div > span').length > 0;
  if (isNotFound) {
    throw new CustomError("This post is private or does not exist", 404);
  }

  // Check if instagram redirected the page to a login page
  const isLoginPage = $('input[name="username"]').length > 0;
  if (isLoginPage) {
    throw new CustomError("Something went wrong, please try again", 500);
  }

  // First try to get video URL from script tags (better for Docker environments)
  const scripts = $('script').toArray();
  let videoUrl = null;

  for (const script of scripts) {
    const content = $(script).html();
    if (content && content.includes('video_url')) {
      // Look for video_url in Instagram's data
      const videoUrlMatch = content.match(/"video_url":"([^"]+)"/);
      if (videoUrlMatch && videoUrlMatch[1]) {
        videoUrl = videoUrlMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        if (!videoUrl.startsWith('blob:')) {
          break;
        }
      }
    }
    
    // Alternative pattern for video URLs
    if (content && content.includes('"video_versions"')) {
      const videoVersionsMatch = content.match(/"video_versions":\[{"url":"([^"]+)"/);
      if (videoVersionsMatch && videoVersionsMatch[1]) {
        videoUrl = videoVersionsMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        if (!videoUrl.startsWith('blob:')) {
          break;
        }
      }
    }
  }

  // Fallback to video element src attribute
  if (!videoUrl || videoUrl.startsWith('blob:')) {
    const elementVideoUrl = $("video").attr("src");
    if (elementVideoUrl && !elementVideoUrl.startsWith('blob:')) {
      videoUrl = elementVideoUrl;
    }
  }

  if (!videoUrl) {
    throw new CustomError("This post does not contain a video", 404);
  }

  if (videoUrl.startsWith('blob:')) {
    throw new CustomError("Unable to extract direct video URL (blob URL detected). This may be due to Instagram's anti-bot measures.", 400);
  }

  return videoUrl;
}

/**
 * Extract all media assets from Instagram post HTML using JSON-based approach
 * Handles single images, single videos, and carousel posts based on actual Instagram data structure
 * @param {string} html - HTML content of Instagram post page
 * @param {string} postId - Instagram post ID (shortcode)
 * @returns {Array<Object>} - Array of media assets with type and url
 */
const getAllMediaAssets = (html, postId) => {
  const $ = cheerio.load(html);

  // Check if this post exists
  const isNotFound = $('main > div > div > span').length > 0;
  if (isNotFound) {
    throw new CustomError("This post is private or does not exist", 404);
  }

  // Check if instagram redirected the page to a login page
  const isLoginPage = $('input[name="username"]').length > 0;
  if (isLoginPage) {
    throw new CustomError("Something went wrong, please try again", 500);
  }

  if (!postId) {
    throw new CustomError("Post ID is required for media extraction", 400);
  }

  // Extract media from script tags using the actual Instagram JSON structure
  const scripts = $('script').toArray();
  let mediaAssets = [];

  // Helper function to recursively find objects with matching code
  const findObjectsWithCode = (obj, targetCode) => {
    const results = [];
    
    const traverse = (current) => {
      if (current && typeof current === 'object') {
        if (Array.isArray(current)) {
          // If it's an array, traverse each element
          current.forEach(item => traverse(item));
        } else {
          // Check if this object has the target code
          if (current.code === targetCode) {
            results.push(current);
          }
          
          // Recursively traverse all properties
          for (const key in current) {
            if (current.hasOwnProperty(key)) {
              traverse(current[key]);
            }
          }
        }
      }
    };
    
    traverse(obj);
    return results;
  };

  // Helper function to extract media from Instagram object structure
  const extractMediaFromObject = (obj) => {
    const assets = [];
    const single_asset = [];
    
    // Check for carousel media (multiple items)
    if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
      console.log(`Found carousel with ${obj.carousel_media.length} items`);
      
      for (const mediaItem of obj.carousel_media) {
        // Extract image URL from image_versions2.candidates[0].url
        if (mediaItem.image_versions2 &&
            mediaItem.image_versions2.candidates &&
            mediaItem.image_versions2.candidates[0] &&
            mediaItem.image_versions2.candidates[0].url) {
          
          const imageUrl = mediaItem.image_versions2.candidates[0].url;
          console.log(`Found carousel image: ${imageUrl.substring(0, 100)}...`);
          
          assets.push({
            type: 'image',
            url: imageUrl.replace(/\\u0026/g, '&').replace(/\\/g, '')
          });
        }
        
        // Extract video URL from video_versions[0].url if present
        if (mediaItem.video_versions &&
            Array.isArray(mediaItem.video_versions) &&
            mediaItem.video_versions[0] &&
            mediaItem.video_versions[0].url) {
          
          const videoUrl = mediaItem.video_versions[0].url;
          console.log(`Found carousel video: ${videoUrl.substring(0, 100)}...`);
          
          assets.push({
            type: 'video',
            url: videoUrl.replace(/\\u0026/g, '&').replace(/\\/g, '')
          });
        }
      }
    }
    // Handle single media posts
    else {
      // Single image
      if (obj.image_versions2 &&
          obj.image_versions2.candidates &&
          obj.image_versions2.candidates[0] &&
          obj.image_versions2.candidates[0].url) {
        
        const imageUrl = obj.image_versions2.candidates[0].url;
        console.log(`Found single image: ${imageUrl}`);
        
        single_asset.push({
          type: 'image',
          url: imageUrl.replace(/\\u0026/g, '&').replace(/\\/g, '')
        });
      }
      
      // Single video
      if (obj.video_versions &&
          Array.isArray(obj.video_versions) &&
          obj.video_versions[0] &&
          obj.video_versions[0].url) {
        
        const videoUrl = obj.video_versions[0].url;
        console.log(`Found single video: ${videoUrl.substring(0, 100)}...`);
        
        single_asset.push({
          type: 'video',
          url: videoUrl.replace(/\\u0026/g, '&').replace(/\\/g, '')
        });
      }
    }
    
    return {assets: assets, single: single_asset};
  };

  for (const script of scripts) {
    const content = $(script).html();
    
    if (content && content.includes(`"code"`)) {
      try {
        // Try to parse the entire script content as JSON
        const jsonData = JSON.parse(content.trim());
        
        // Find all objects with matching code using recursive search
        const matchingObjects = findObjectsWithCode(jsonData, postId);
        
        console.log(`Found ${matchingObjects.length} objects with code: ${postId}`);
        
        for (const obj of matchingObjects) {
          const {assets: extractedAssets, single: singleAsset} = extractMediaFromObject(obj);
          if (extractedAssets.length > 0) {
            mediaAssets = extractedAssets;
            break;
          }
          mediaAssets = singleAsset
        }
        
      } catch (parseError) {
        // If JSON parsing fails, continue to next script tag
        console.log('JSON parsing failed for script tag, trying next...');
        continue;
      }
    }
  }

  // Fallback to DOM elements if no media found in script tags

  console.log('Trying DOM element fallback methods');
  
  // Try video element
  const elementVideoUrl = $("video").attr("src");
  if (elementVideoUrl && !elementVideoUrl.startsWith('blob:')) {
    console.log(`Found video URL via video element: ${elementVideoUrl.substring(0, 100)}...`);
    mediaAssets.push({
      type: 'video',
      url: elementVideoUrl
    });
  }
  
  if (mediaAssets.length === 0 ) {
    let videoUrl =
    $('meta[property="og:video:secure_url"]').attr("content") ||
    $('meta[property="og:video"]').attr("content");
    if (videoUrl) {
      mediaAssets.push({
      type: 'video',
      url: videoUrl
    });
    }
  }

  if (mediaAssets.length === 0) {
    throw new CustomError("This post does not contain any media", 404);
  }


  console.log("Logging Media Assets", mediaAssets)
  // Filter out blob URLs and duplicates
  const originalCount = mediaAssets.length;
  const uniqueUrls = new Set();
  mediaAssets = mediaAssets.filter(asset => {
    if (asset.url.startsWith('blob:') || uniqueUrls.has(asset.url)) {
      return false;
    }
    uniqueUrls.add(asset.url);
    return true;
  });
  
  if (originalCount !== mediaAssets.length) {
    console.log(`Filtered out ${originalCount - mediaAssets.length} blob URLs and duplicates`);
  }
  
  if (mediaAssets.length === 0) {
    throw new CustomError("Unable to extract direct media URLs (blob URLs detected). This may be due to Instagram's anti-bot measures.", 400);
  }

  // Final debug output
  console.log(` Successfully found ${mediaAssets.length} media assets`);
  mediaAssets.forEach((asset, index) => {
    console.log(`Asset ${index + 1}: ${asset.type} - ${asset.url.substring(0, 100)}...`);
  });

  return mediaAssets;
}

module.exports = {
  getPostId,
  getVideoUrl,
  getAllMediaAssets
}