import { logger } from './logger.js';

const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';

export async function searchGif(apiKey: string, query: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      q: query,
      limit: '25',
      rating: 'pg-13',
    });

    const response = await fetch(`${GIPHY_SEARCH_URL}?${params}`);
    if (!response.ok) return null;

    const data = await response.json() as {
      data: Array<{ images: { fixed_height: { url: string } } }>;
    };

    if (!data.data.length) return null;

    // Pick a random GIF from results
    const index = Math.floor(Math.random() * data.data.length);
    return data.data[index].images.fixed_height.url;
  } catch (error) {
    logger.warn('Giphy search failed:', error);
    return null;
  }
}
