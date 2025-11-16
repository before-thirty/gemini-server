const { GoogleGenAI } = require('@google/genai');
const fs = require('fs-extra');
const path = require('path');
const { CustomError } = require('./errors');

class GeminiService {
  constructor() {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    
    if (!apiKey) {
      throw new CustomError('GOOGLE_GEMINI_API_KEY environment variable is required', 500);
    }

    this.genAI = new GoogleGenAI({ apiKey });
    
    // Note: File management is handled through ai.files in the new SDK

    // Generation config with media resolution
    this.generationConfig = {
      temperature: 0.4,
      topK: 32,
      topP: 1,
      maxOutputTokens: 8192,
      mediaResolution: "MEDIA_RESOLUTION_LOW"
    };

    // Default model to use
    this.modelName = "gemini-2.0-flash-001";

    this.prompt = `
You are an expert travel analyst. Your task is to identify all specific travel locations from the provided video content.

A "location" can be a specific landmark, monument, building, restaurant, hotel, city, state, country, national park, beach, or mountain.

To do this, follow these steps:
1.  **Analyze All Sources**: Carefully analyze the video's three main sources of information:
    * **Spoken Audio**: Listen to what the narrator or any person is saying.
    * **Text Overlays**: Read any text that appears on the screen.
    * **Visual Landmarks**: Identify any recognizable places, buildings, or natural features shown in the video frames.

2. Extract all specific locations or place names mentioned in the content. These may include cities, restaurants, beaches, attractions, malls, parks, hotels, etc.

    Categorize each identified place into one of the following categories:

    Food – e.g., restaurants, cafes, food markets, bars, etc.

    Night life – e.g., clubs, lounges, late-night entertainment venues.

    Activities – e.g., gyms, adventure parks, sports arenas, fitness centers.

    Nature – e.g., parks, beaches, lakes, hiking spots, waterfalls.

    Attraction – e.g., cultural or historic sites, museums, temples, towers.

    Shopping – e.g., shopping malls, local markets, boutique stores.

    Accommodation – e.g., hotels, villas, resorts, Airbnb stays.

    Not pinned – if the content doesn't mention any specific place, or only names a country or a general region (e.g., "Thailand" or "Europe").

  3. Now Extract any **additional useful details** from the analysed content. Log all the identified locations in a single string with their description. Identify the city and country where the place is located as well.
  4. Make sure to include all the information extracted from above in only one string format.
`;
  }

  /**
   * Upload video file to Gemini
   * @param {string} filePath - Path to video file
   * @returns {Promise<Object>} - Uploaded file object
   */
  async uploadVideo(filePath) {
    try {
      console.log(`Uploading video to Gemini: ${filePath}`);

      if (!await fs.pathExists(filePath)) {
        throw new CustomError(`Video file not found: ${filePath}`, 404);
      }

      const stats = await fs.stat(filePath);
      console.log(`Video file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      // Upload file using the new SDK
      const uploadResult = await this.genAI.files.upload({
        file: filePath,
        config: {
          mimeType: "video/mp4",
          displayName: path.basename(filePath)
        }
      });

      console.log(' Video uploaded to Gemini successfully');
      console.log(`File URI: ${uploadResult.uri}`);
      
      return uploadResult;

    } catch (error) {
      console.error('Error uploading video to Gemini:', error.message);
      throw new CustomError(`Failed to upload video to Gemini: ${error.message}`, 500);
    }
  }

  /**
   * Wait for video processing to complete
   * @param {Object} uploadedFile - Uploaded file object
   * @returns {Promise<Object>} - Processed file object
   */
  async waitForProcessing(uploadedFile) {
    try {
      console.log('Waiting for video processing to complete...');
      
      let file = uploadedFile;
      while (file.state === 'PROCESSING') {
        console.log('Video is still processing, waiting...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        
        // Get updated file status
        file = await this.genAI.files.get({ name: uploadedFile.name });
      }
      
      if (file.state === 'FAILED') {
        throw new CustomError('Video processing failed', 500);
      }
      
      console.log(' Video processing completed');
      return file;
      
    } catch (error) {
      console.error('Error waiting for video processing:', error.message);
      throw new CustomError(`Video processing failed: ${error.message}`, 500);
    }
  }

  /**
   * Analyze video with Gemini
   * @param {Object} uploadedFile - Uploaded file object
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeVideo(uploadedFile) {
    try {
      console.log('Starting video analysis with Gemini...');
      console.log('Sending video and prompt to Gemini...');

      // Generate content with uploaded file and prompt using the new SDK
      const result = await this.genAI.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                fileData: {
                  mimeType: uploadedFile.mimeType,
                  fileUri: uploadedFile.uri
                }
              },
              { text: this.prompt }
            ]
          }
        ],
        config: this.generationConfig
      });

      const text = result.text;

      console.log(' Gemini analysis completed');
      
      // Try to parse JSON from the response
      let parsedResult;
      try {
        // Extract JSON from the response (it might be wrapped in markdown code blocks)
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        parsedResult = JSON.parse(jsonText);
      } catch (parseError) {
        console.warn('Could not parse JSON response, returning raw text');
        parsedResult = {
          title: "Video Analysis",
          locations: [],
          raw_response: text
        };
      }

      return {
        success: true,
        result: parsedResult,
        raw_response: text
      };

    } catch (error) {
      console.error('Error analyzing video with Gemini:', error.message);
      throw new CustomError(`Failed to analyze video: ${error.message}`, 500);
    }
  }

  /**
   * Complete video analysis workflow
   * @param {string} filePath - Path to video file
   * @returns {Promise<Object>} - Complete analysis result
   */
  async processVideo(filePath) {
    try {
      console.log('Starting complete video processing workflow...');
      
      // Step 1: Upload video
      const uploadedFile = await this.uploadVideo(filePath);
      
      // Step 2: Wait for processing to complete
      const processedFile = await this.waitForProcessing(uploadedFile);
      
      // Step 3: Analyze the video
      const analysisResult = await this.analyzeVideo(processedFile);
      
      console.log(' Video processing workflow completed');
      return analysisResult;

    } catch (error) {
      console.error('Error in video processing workflow:', error.message);
      throw new CustomError(`Video processing failed: ${error.message}`, 500);
    }
  }

  /**
   * Analyze images with Gemini
   * @param {Array<string>} imagePaths - Array of image file paths
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeImages(imagePaths) {
    try {
      console.log(`Starting image analysis with Gemini for ${imagePaths.length} images...`);

      const parts = [];
      
      // Add each image to the parts
      for (const imagePath of imagePaths) {
        if (!await fs.pathExists(imagePath)) {
          console.warn(`Image file not found: ${imagePath}`);
          continue;
        }

        const imageData = await fs.readFile(imagePath);
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: imageData.toString('base64')
          }
        });
      }

      // Add the prompt
      parts.push({ text: this.prompt });

      console.log('Sending images and prompt to Gemini...');

      // Generate content with images and prompt using the new SDK
      const result = await this.genAI.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: parts
          }
        ],
        config: this.generationConfig
      });

      const text = result.text;

      console.log(' Gemini image analysis completed');
      
      // Try to parse JSON from the response
      let parsedResult;
      try {
        // Extract JSON from the response (it might be wrapped in markdown code blocks)
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        parsedResult = JSON.parse(jsonText);
      } catch (parseError) {
        console.warn('Could not parse JSON response, returning raw text');
        parsedResult = {
          title: "Image Analysis",
          locations: [],
          raw_response: text
        };
      }

      return {
        success: true,
        result: parsedResult,
        raw_response: text
      };

    } catch (error) {
      console.error('Error analyzing images with Gemini:', error.message);
      throw new CustomError(`Failed to analyze images: ${error.message}`, 500);
    }
  }

  /**
   * Complete image analysis workflow
   * @param {Array<string>} imagePaths - Array of image file paths
   * @returns {Promise<Object>} - Complete analysis result
   */
  async processImages(imagePaths) {
    try {
      console.log('Starting complete image processing workflow...');
      
      // Analyze the images
      const analysisResult = await this.analyzeImages(imagePaths);
      
      console.log(' Image processing workflow completed');
      return analysisResult;

    } catch (error) {
      console.error('Error in image processing workflow:', error.message);
      throw new CustomError(`Image processing failed: ${error.message}`, 500);
    }
  }

  /**
   * Analyze mixed media assets (images and videos) with Gemini
   * @param {Array<Object>} mediaAssets - Array of media assets with type and path
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeMixedMedia(mediaAssets) {
    try {
      console.log(`Starting mixed media analysis with Gemini for ${mediaAssets.length} assets...`);

      const parts = [];
      
      // Add each media asset to the parts
      for (const asset of mediaAssets) {
        if (!await fs.pathExists(asset.path)) {
          console.warn(`Media file not found: ${asset.path}`);
          continue;
        }

        if (asset.type === 'video') {
          // For videos, we need to upload them first
          const uploadedFile = await this.uploadVideo(asset.path);
          const processedFile = await this.waitForProcessing(uploadedFile);
          
          parts.push({
            fileData: {
              mimeType: processedFile.mimeType,
              fileUri: processedFile.uri
            }
          });
        } else {
          // For images, we can send them directly
          const imageData = await fs.readFile(asset.path);
          parts.push({
            inlineData: {
              mimeType: "image/jpeg",
              data: imageData.toString('base64')
            }
          });
        }
      }

      // Add the prompt
      parts.push({ text: this.prompt });

      console.log('Sending mixed media and prompt to Gemini...');

      // Generate content with mixed media and prompt using the new SDK
      const result = await this.genAI.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: parts
          }
        ],
        config: this.generationConfig
      });

      const text = result.text;

      console.log(' Gemini mixed media analysis completed');
      
      // Try to parse JSON from the response
      let parsedResult;
      try {
        // Extract JSON from the response (it might be wrapped in markdown code blocks)
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        parsedResult = JSON.parse(jsonText);
      } catch (parseError) {
        console.warn('Could not parse JSON response, returning raw text');
        parsedResult = {
          title: "Mixed Media Analysis",
          locations: [],
          raw_response: text
        };
      }

      return {
        success: true,
        result: parsedResult,
        raw_response: text
      };

    } catch (error) {
      console.error('Error analyzing mixed media with Gemini:', error.message);
      throw new CustomError(`Failed to analyze mixed media: ${error.message}`, 500);
    }
  }

  /**
   * Complete mixed media analysis workflow
   * @param {Array<Object>} mediaAssets - Array of media assets with type and path
   * @returns {Promise<Object>} - Complete analysis result
   */
  async processMixedMedia(mediaAssets) {
    try {
      console.log('Starting complete mixed media processing workflow...');
      
      // Analyze the mixed media
      const analysisResult = await this.analyzeMixedMedia(mediaAssets);
      
      console.log(' Mixed media processing workflow completed');
      return analysisResult;

    } catch (error) {
      console.error('Error in mixed media processing workflow:', error.message);
      throw new CustomError(`Mixed media processing failed: ${error.message}`, 500);
    }
  }

  /**
   * Analyze YouTube video directly using URL
   * @param {string} youtubeUrl - YouTube video URL
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeYouTubeVideo(youtubeUrl) {
    try {
      console.log(`Starting YouTube video analysis: ${youtubeUrl}`);

      // Generate content with YouTube URL and prompt using the new SDK
      const result = await this.genAI.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                fileData: {
                  fileUri: youtubeUrl,
                  mimeType: 'video/*'
                },
                videoMetadata: {
                  startOffset: '0s',
                  endOffset: '1s'
                }
              },
              { text: "what does the description say?" }
            ]
          }
        ],

        config: this.generationConfig
      });

      const text = result.text;

      console.log(' YouTube video analysis completed');
      
      // Try to parse JSON from the response
      let parsedResult;
      try {
        // Extract JSON from the response (it might be wrapped in markdown code blocks)
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        parsedResult = JSON.parse(jsonText);
      } catch (parseError) {
        console.warn('Could not parse JSON response, returning raw text');
        parsedResult = {
          title: "YouTube Video Analysis",
          locations: [],
          raw_response: text
        };
      }

      return {
        success: true,
        result: parsedResult,
        raw_response: text
      };

    } catch (error) {
      console.error('Error analyzing YouTube video with Gemini:', error.message);
      throw new CustomError(`Failed to analyze YouTube video: ${error.message}`, 500);
    }
  }

  /**
   * Complete YouTube video analysis workflow
   * @param {string} youtubeUrl - YouTube video URL
   * @returns {Promise<Object>} - Complete analysis result
   */
  async processYouTubeVideo(youtubeUrl) {
    try {
      console.log('Starting YouTube video processing workflow...');
      
      // Analyze the YouTube video directly
      const analysisResult = await this.analyzeYouTubeVideo(youtubeUrl);
      
      console.log(' YouTube video processing workflow completed');
      return analysisResult;

    } catch (error) {
      console.error('Error in YouTube video processing workflow:', error.message);
      throw new CustomError(`YouTube video processing failed: ${error.message}`, 500);
    }
  }
}

module.exports = GeminiService;
