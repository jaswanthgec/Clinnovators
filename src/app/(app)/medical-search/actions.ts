'use server';

import type { ScrapedMedicineResult } from '@/types';
import axios from 'axios';
import * as io from 'cheerio';
import Fuse from 'fuse.js';
import fs from 'fs/promises';
import path from 'path';

interface PlatformConfig {
  urlTemplate: string;
  nameClass: string;
  priceClass: string;
  linkSelector?: string;
  linkBaseUrl?: string;
  enabled: boolean;
}

interface Platforms {
  [key: string]: PlatformConfig;
}

let platforms: Platforms = {};
let platformsLoaded = false;

// Cache implementation
const CACHE_TTL_MS = 60 * 60 * 1000 * 3; // 3 hours
const platformCache = new Map<string, { data: ScrapedMedicineResult[]; timestamp: number }>();

const MAX_RETRIES = 2; // Max retries for a single platform scrape
const RETRY_DELAY_MS = 1000; // Initial delay between retries

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const DEFAULT_PLATFORMS: Platforms = {
  "Truemeds": {
    urlTemplate: "https://www.truemeds.in/search/{medicine}",
    nameClass: ".sc-a39eeb4f-12.daYLth",
    priceClass: ".sc-a39eeb4f-17.iwZSqt",
    enabled: true
  },
  "PharmEasy": {
    urlTemplate: "https://pharmeasy.in/search/all?name={medicine}",
    nameClass: ".ProductCard_medicineName__Uzjm7",
    priceClass: ".ProductCard_unitPriceDecimal__Ur26V",
    enabled: true
  },
  "Tata 1mg": {
    urlTemplate: "https://www.1mg.com/search/all?filter=true&name={medicine}",
    nameClass: ".style__pro-title___3G3rr",
    priceClass: ".style__price-tag___KzOkY",
    enabled: true
  },
  "Netmeds": {
    urlTemplate: "https://www.netmeds.com/catalogsearch/result/{medicine}/all",
    nameClass: ".clsgetname",
    priceClass: ".final-price",
    enabled: true
  }
};

// Modify loadPlatformConfigs to use DEFAULT_PLATFORMS as fallback
async function loadPlatformConfigs(): Promise<Platforms> {
  if (platformsLoaded) return platforms;
  try {
    // For Next.js Server Actions, __dirname is not available. process.cwd() gives the project root.
    const platformConfigPath = path.join(process.cwd(), 'src', 'app', '(app)', 'medical-search', 'platforms.json');
    const platformConfigData = await fs.readFile(platformConfigPath, 'utf-8');
    platforms = JSON.parse(platformConfigData);
    platformsLoaded = true;
    console.log("Successfully loaded platform configurations from platforms.json.");
    return platforms;
  } catch (error) {
    console.warn("Using default platform configurations");
    platforms = DEFAULT_PLATFORMS;
    platformsLoaded = true;
    return platforms;
  }
}

function getCleanPrice(priceText: string | undefined): string {
  if (!priceText) return "N/A";
  // Keep ₹ symbol for display if needed, but ensure numeric part is extractable for sorting/comparison
  // For now, just strip common prefixes and extra whitespace
  return priceText.replace(/Rs\.?\s*/gi, '').replace(/₹\s*/, '₹').trim();
}


async function scrapePlatform(
  platformName: string,
  medicineName: string,
  config: PlatformConfig,
  attempt = 1
): Promise<ScrapedMedicineResult[]> {
  if (!config || !config.enabled) {
    console.log(`Skipping disabled or misconfigured platform: ${platformName}`);
    return [];
  }
  if (!config.nameClass || !config.priceClass) {
    console.warn(`Platform ${platformName} is enabled but missing nameClass or priceClass selectors in platforms.json. Skipping.`);
    return [];
  }

  const cacheKey = `${platformName}-${medicineName.toLowerCase()}`;
  const cachedEntry = platformCache.get(cacheKey);
  if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS)) {
    console.log(`[CACHE HIT] Serving from cache for ${platformName} - ${medicineName}`);
    return cachedEntry.data;
  }
  console.log(`[CACHE MISS] Scraping ${platformName} for ${medicineName} (Attempt ${attempt})`);

  try {
    const url = config.urlTemplate.replace('{medicine}', encodeURIComponent(medicineName));
    console.log(`Scraping URL: ${url} for ${platformName}`);

    const { data } = await axios.get(url, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 15000, // 15 second timeout
    });

    const $ = io.load(data);

    const names = $(config.nameClass);
    const prices = $(config.priceClass);

    if (names.length === 0 || prices.length === 0) {
      console.warn(`No data found on ${platformName} for ${medicineName}`);
      return [];
    }

    const medicineNames = names.map((i, el) => $(el).text().trim()).get();
    const fuse = new Fuse(medicineNames, { threshold: 0.3 });
    const results: ScrapedMedicineResult[] = [];

    prices.each((i, priceEl) => {
      const price = $(priceEl).text().trim();
      const name = medicineNames[i] || '';
      const searchTerm = medicineName.toLowerCase();

      const matches = fuse.search(searchTerm);
      if (matches.length > 0 && matches[0].item.toLowerCase().includes(searchTerm)) {
        results.push({
          pharmacyName: platformName,
          drugName: name,
          price: getCleanPrice(price),
          imageUrl: `https://placehold.co/100x100.png?text=${encodeURIComponent(name.substring(0,10))}`
        });
      }
    });

    return results;

  } catch (error: any) {
    console.error(`Error scraping ${platformName} for ${medicineName} (Attempt ${attempt}):`, error.message);
    if (axios.isAxiosError(error) && error.response) {
      console.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data || error.message).substring(0, 200)}`);
    }
    if (attempt < MAX_RETRIES) {
      console.log(`Retrying scrape for ${platformName} - ${medicineName} in ${RETRY_DELAY_MS * attempt}ms...`);
      await sleep(RETRY_DELAY_MS * attempt);
      return scrapePlatform(platformName, medicineName, config, attempt + 1);
    } else {
      console.error(`Max retries reached for ${platformName} - ${medicineName}. Giving up.`);
      platformCache.set(cacheKey, { data: [], timestamp: Date.now() }); // Cache failure to prevent immediate re-retries
      return []; // Return empty on final failure
    }
  }
}

export async function searchPharmaciesAction(searchTerm: string): Promise<{ data?: ScrapedMedicineResult[]; error?: string }> {
  if (!searchTerm.trim()) {
    return { error: "Please enter a medicine name to search." };
  }
  const trimmedMedicineName = searchTerm.trim();
  console.log(`Server Action: Starting pharmacy search for "${trimmedMedicineName}"`);

  const currentPlatforms = await loadPlatformConfigs();
  if (Object.keys(currentPlatforms).length === 0) {
    console.error("Server Action: No platforms loaded. Aborting search. This might be due to an error reading platforms.json.");
    return { error: "Platform configurations could not be loaded. Please check server logs or platforms.json." };
  }

  let allResults: ScrapedMedicineResult[] = [];
  const scrapingPromises: Promise<ScrapedMedicineResult[]>[] = [];

  for (const [platformName, config] of Object.entries(currentPlatforms)) {
    if (config.enabled) {
      scrapingPromises.push(
        scrapePlatform(platformName, trimmedMedicineName, config)
          .catch(err => { // Catch errors from scrapePlatform itself if any slip through its internal try/catch
            console.error(`Critical error in scrapePlatform promise for ${platformName}: ${err.message}. This should ideally be caught within scrapePlatform's retry logic.`);
            return []; // Ensure an empty array is returned for this platform on critical failure
          })
      );
    } else {
      console.log(`Skipping disabled platform: ${platformName}`);
    }
  }

  try {
    const platformResultsArray = await Promise.all(scrapingPromises);
    platformResultsArray.forEach(platformResults => {
      allResults = allResults.concat(platformResults);
    });

    console.log(`Server Action: Total results from all platforms for "${trimmedMedicineName}": ${allResults.length}`);

    if (allResults.length === 0) {
      // Enhanced error message
      return { data: [], error: `No results found for "${trimmedMedicineName}" across all enabled platforms. This could be due to outdated selectors in platforms.json, network issues, or the medicine not being listed. Check server logs for detailed scraping attempts per platform.` };
    }

    // Optional: Sort or further process allResults before returning
    // e.g., allResults.sort((a, b) => parseFloat(a.price.replace(/[^0-9.]/g, '')) - parseFloat(b.price.replace(/[^0-9.]/g, '')));

    return { data: allResults };

  } catch (err: any) {
    // This catch block is for errors in Promise.all itself, though individual catches above make it less likely.
    console.error("Unexpected error in searchPharmaciesAction orchestrating scrapes:", err);
    return { error: "An unexpected error occurred during the search. Please try again." };
  }
}
