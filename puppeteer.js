import axios from "axios";
import * as cheerio from "cheerio";

async function scrapeInstagramReel() {
  const url = "https://www.instagram.com/reel/DOBZ-RXE3Vj/";

  // ⚠️ This may just return minimal HTML with JS, not the full rendered page
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    },
  });

  // Load HTML into Cheerio
  const $ = cheerio.load(data);
  console.log($.html())
  // Example: get the <title>
  const title = $("title").text();
  console.log("Page Title:", title);

  // Example: grab all script tags
  $("script").each((i, el) => {
    console.log($(el).html()?.substring(0, 200)); // print first 200 chars
  });

  return $.html(); // full HTML (static)
}

scrapeInstagramReel();
