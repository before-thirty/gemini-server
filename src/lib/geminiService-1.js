const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const fs = require('fs-extra');
const path = require('path');
const { CustomError } = require('./errors');

class GeminiService {
  constructor() {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    
    if (!apiKey) {
      throw new CustomError('GOOGLE_GEMINI_API_KEY environment variable is required', 500);
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.4,
        topK: 32,
        topP: 1,
        maxOutputTokens: 8192,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });

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

  3. Now log all the identified locations in a single string with their description. Identify the city and country where the place is located as well.
  4. Make sure to include all the information in only one string format and don't miss any.
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

      // Read the video file
      const videoData = await fs.readFile(filePath);
      
      // Upload file to Gemini
      const uploadResult = await this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).generateContent({
        contents: [{
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "video/mp4",
                data: videoData.toString('base64')
              }
            }
          ]
        }]
      });

      console.log(' Video uploaded to Gemini successfully');
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
    // For the current Gemini API, we don't need to wait for processing
    // as the upload and processing happen together
    return uploadedFile;
  }

  /**
   * Analyze video with Gemini
   * @param {string} filePath - Path to video file
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeVideo(filePath) {
    try {
      console.log('Starting video analysis with Gemini...');

      if (!await fs.pathExists(filePath)) {
        throw new CustomError(`Video file not found: ${filePath}`, 404);
      }

      // Read the video file
      const videoData = await fs.readFile(filePath);
      
      console.log('Sending video and prompt to Gemini...');

      // Generate content with video and prompt
      const result = await this.model.generateContent([
        {
          inlineData: {
            mimeType: "video/mp4",
            data: videoData.toString('base64')
          }
        },
	
        { text: this.prompt }
      ], {mediaResolution: "MEDIA_RESOLUTION_LOW"});

      const response = await result.response;
      const text = response.text();

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
   * Analyze multiple images with Gemini
   * @param {string[]} imagePaths - Array of paths to image files
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeImages(imagePaths) {
    try {
      console.log(`Starting image analysis with Gemini for ${imagePaths.length} images...`);

      if (!imagePaths || imagePaths.length === 0) {
        throw new CustomError('No image paths provided', 400);
      }

      // Check if all image files exist
      for (const imagePath of imagePaths) {
        if (!await fs.pathExists(imagePath)) {
          throw new CustomError(`Image file not found: ${imagePath}`, 404);
        }
      }

      console.log('Sending images and prompt to Gemini...');

      // Prepare content array with all images
      const contentParts = [];
      
      // Add all images to the content
      for (const imagePath of imagePaths) {
        const imageData = await fs.readFile(imagePath);
        contentParts.push({
          inlineData: {
            mimeType: "image/jpeg", // Assuming JPG format for TikTok images
            data: imageData.toString('base64')
          }
        });
      }

      // Add the text prompt
      contentParts.push({ text: this.prompt });

      // Generate content with all images and prompt
      const result = await this.model.generateContent(contentParts);

      const response = await result.response;
      const text = response.text();

      console.log(' Gemini image analysis completed');
      
      // Try to parse JSON from the response
      let parsedResult;
      try {
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
        raw_response: text,
        images_analyzed: imagePaths.length
      };

    } catch (error) {
      console.error('Error analyzing images with Gemini:', error.message);
      throw new CustomError(`Failed to analyze images: ${error.message}`, 500);
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
      
      // Analyze the video
      const analysisResult = await this.analyzeVideo(filePath);
      
      console.log(' Video processing workflow completed');
      return analysisResult;

    } catch (error) {
      console.error('Error in video processing workflow:', error.message);
      throw new CustomError(`Video processing failed: ${error.message}`, 500);
    }
  }

  /**
   * Complete image analysis workflow
   * @param {string[]} imagePaths - Array of paths to image files
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
}

module.exports = GeminiService;
