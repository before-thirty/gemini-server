const request = require('supertest');
const app = require('../app');
const { getAllMediaAssets } = require('../lib/utils');

describe('app', () => {
  it('should export the express app correctly', () => {
    expect(app).toBeTruthy();
  });

  describe('GET /', () => {
    it('should respond to the GET method with 200', async () => {
      const response = await request(app).get('/');
      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /404', () => {
    beforeEach(() => {
      // Avoid polluting the test output with 404 error messages
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should respond to the GET method with a 404 for a route that does not exist', async () => {
      const response = await request(app).get('/404');
      expect(response.statusCode).toBe(404);
      expect(response.text).toBe('{"message":"Not Found"}');
    });

    it('should respond to the POST method with a 404 for a route that does not exist', async () => {
      const response = await request(app).post('/404');
      expect(response.statusCode).toBe(404);
      expect(response.text).toBe('{"message":"Not Found"}');
    });
  });

  describe('getAllMediaAssets carousel functionality', () => {
    beforeEach(() => {
      // Mock console.log to avoid cluttering test output
      jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      // Restore console.log
      console.log.mockRestore();
    });

    it('should extract multiple media assets from carousel posts', () => {
      const mockCarouselHtml = `
        <html>
          <head><title>Instagram</title></head>
          <body>
            <script type="text/javascript">
              {"code": "test123", "carousel_media": [
                {
                  "image_versions2": {
                    "candidates": [
                      {"url": "https://instagram.example.com/img1.jpg"}
                    ]
                  }
                },
                {
                  "video_versions": [
                    {"url": "https://instagram.example.com/video1.mp4"}
                  ],
                  "image_versions2": {
                    "candidates": [
                      {"url": "https://instagram.example.com/video1_thumb.jpg"}
                    ]
                  }
                },
                {
                  "image_versions2": {
                    "candidates": [
                      {"url": "https://instagram.example.com/img2.jpg"}
                    ]
                  }
                }
              ]}
            </script>
          </body>
        </html>
      `;

      const postId = 'test123';
      const mediaAssets = getAllMediaAssets(mockCarouselHtml, postId);
      
      // Should extract multiple media assets
      expect(mediaAssets).toBeDefined();
      expect(Array.isArray(mediaAssets)).toBe(true);
      expect(mediaAssets.length).toBeGreaterThan(1);
      
      // Should contain both images and videos
      const videoAssets = mediaAssets.filter(asset => asset.type === 'video');
      const imageAssets = mediaAssets.filter(asset => asset.type === 'image');
      
      expect(videoAssets.length).toBeGreaterThan(0);
      expect(imageAssets.length).toBeGreaterThan(0);
      
      // Check that all assets have required properties
      mediaAssets.forEach(asset => {
        expect(asset).toHaveProperty('type');
        expect(asset).toHaveProperty('url');
        expect(['video', 'image']).toContain(asset.type);
        expect(typeof asset.url).toBe('string');
        expect(asset.url.length).toBeGreaterThan(0);
      });
    });

    it('should extract single media asset from non-carousel posts', () => {
      const mockSinglePostHtml = `
        <html>
          <head><title>Instagram</title></head>
          <body>
            <script type="text/javascript">
              {"code": "single123", "image_versions2": {"candidates": [{"url": "https://instagram.example.com/single_image.jpg"}]}}
            </script>
          </body>
        </html>
      `;

      const postId = 'single123';
      const mediaAssets = getAllMediaAssets(mockSinglePostHtml, postId);
      
      // Should extract exactly one media asset
      expect(mediaAssets).toBeDefined();
      expect(Array.isArray(mediaAssets)).toBe(true);
      expect(mediaAssets.length).toBe(1);
      
      const asset = mediaAssets[0];
      expect(asset.type).toBe('image');
      expect(asset.url).toBe('https://instagram.example.com/single_image.jpg');
    });

    it('should handle video posts', () => {
      const mockVideoHtml = `
        <html>
          <head><title>Instagram</title></head>
          <body>
            <script type="text/javascript">
              {"code": "video123", "video_versions": [{"url": "https://instagram.example.com/video.mp4"}], "image_versions2": {"candidates": [{"url": "https://instagram.example.com/video_thumb.jpg"}]}}
            </script>
          </body>
        </html>
      `;

      const postId = 'video123';
      const mediaAssets = getAllMediaAssets(mockVideoHtml, postId);
      
      // Should extract both video and image (thumbnail)
      expect(mediaAssets).toBeDefined();
      expect(Array.isArray(mediaAssets)).toBe(true);
      expect(mediaAssets.length).toBe(2);
      
      const videoAsset = mediaAssets.find(asset => asset.type === 'video');
      const imageAsset = mediaAssets.find(asset => asset.type === 'image');
      
      expect(videoAsset).toBeDefined();
      expect(videoAsset.url).toBe('https://instagram.example.com/video.mp4');
      expect(imageAsset).toBeDefined();
      expect(imageAsset.url).toBe('https://instagram.example.com/video_thumb.jpg');
    });

    it('should throw error for non-existent posts', () => {
      const mockNotFoundHtml = `
        <html>
          <head><title>Instagram</title></head>
          <body>
            <main>
              <div>
                <div>
                  <span>Sorry, this page isn't available.</span>
                </div>
              </div>
            </main>
          </body>
        </html>
      `;

      expect(() => {
        getAllMediaAssets(mockNotFoundHtml, 'test123');
      }).toThrow('This post is private or does not exist');
    });

    it('should throw error for login page redirects', () => {
      const mockLoginHtml = `
        <html>
          <head><title>Instagram</title></head>
          <body>
            <input name="username" type="text">
            <input name="password" type="password">
          </body>
        </html>
      `;

      expect(() => {
        getAllMediaAssets(mockLoginHtml, 'test123');
      }).toThrow('Something went wrong, please try again');
    });
  });
});
