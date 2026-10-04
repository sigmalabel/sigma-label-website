import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Optional zero-dependency .env loader
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)?$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf'
};

let spotifyAccessToken = '';
let spotifyAccessTokenExpiresAt = 0;

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

const queryFrom = (urlObj) => (urlObj.searchParams.get('q') || '').trim().slice(0, 80);

async function getSpotifyToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (spotifyAccessToken && Date.now() < spotifyAccessTokenExpiresAt) {
    return spotifyAccessToken;
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) {
    throw new Error('Spotify authorization failed');
  }
  const payload = await response.json();
  spotifyAccessToken = payload.access_token;
  spotifyAccessTokenExpiresAt = Date.now() + Math.max(60, payload.expires_in - 60) * 1000;
  return spotifyAccessToken;
}

async function searchSpotify(urlObj, res) {
  const q = queryFrom(urlObj);
  if (q.length < 2) return sendJson(res, { results: [] });

  let token = null;
  try {
    token = await getSpotifyToken();
  } catch (err) {
    return sendJson(res, { code: 'spotify_auth_error', results: [] }, 502);
  }

  if (!token) {
    return sendJson(res, { code: 'spotify_unconfigured', results: [] }, 503);
  }

  try {
    const response = await fetch(`https://api.spotify.com/v1/search?type=artist&limit=8&q=${encodeURIComponent(q)}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return sendJson(res, { code: 'spotify_search_failed', results: [] }, 502);
    }

    const payload = await response.json();
    const results = (payload.artists?.items || []).map((artist) => ({
      id: artist.id,
      name: artist.name,
      url: artist.external_urls?.spotify || '',
      image: artist.images?.[1]?.url || artist.images?.[0]?.url || '',
      subtitle: artist.followers?.total
        ? `${artist.followers.total.toLocaleString('en-US')} followers`
        : (artist.genres?.[0] || 'Official artist profile')
    })).filter((artist) => artist.url);

    return sendJson(res, { results });
  } catch (err) {
    return sendJson(res, { code: 'spotify_search_failed', results: [] }, 502);
  }
}

async function searchApple(urlObj, res) {
  const q = queryFrom(urlObj);
  if (q.length < 2) return sendJson(res, { results: [] });

  const endpoint = `https://itunes.apple.com/search?media=music&entity=musicArtist&country=US&limit=8&term=${encodeURIComponent(q)}`;
  try {
    const response = await fetch(endpoint, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
      return sendJson(res, { code: 'apple_search_failed', results: [] }, 502);
    }
    const payload = await response.json();
    const seen = new Set();
    const rawResults = (payload.results || []).map((artist) => {
      const id = String(artist.artistId || '');
      const slug = String(artist.artistName || 'artist').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      return {
        id,
        name: artist.artistName || '',
        url: artist.artistLinkUrl || artist.artistViewUrl || (id ? `https://music.apple.com/us/artist/${slug}/${id}` : ''),
        image: artist.artworkUrl100 || '',
        subtitle: artist.primaryGenreName || 'Apple Music artist'
      };
    }).filter((artist) => artist.id && artist.name && artist.url && !seen.has(artist.id) && seen.add(artist.id));

    // Fallback: If artwork is missing, retrieve artwork from an album belonging to this artist
    const results = await Promise.all(rawResults.map(async (artist) => {
      if (!artist.image) {
        try {
          const lookupUrl = `https://itunes.apple.com/lookup?id=${encodeURIComponent(artist.id)}&entity=album&limit=1&country=US`;
          const lookupRes = await fetch(lookupUrl, { headers: { 'Accept': 'application/json' } });
          if (lookupRes.ok) {
            const lookupPayload = await lookupRes.json();
            const album = (lookupPayload.results || []).find((item) => item.wrapperType === 'collection' && item.artworkUrl100);
            if (album?.artworkUrl100) {
              artist.image = album.artworkUrl100.replace('100x100bb', '240x240bb');
            }
          }
        } catch {}
      } else {
        artist.image = artist.image.replace('100x100bb', '240x240bb');
      }
      return artist;
    }));

    return sendJson(res, { results });
  } catch (err) {
    return sendJson(res, { code: 'apple_search_failed', results: [] }, 502);
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // API Routes
  if (req.method === 'GET' && parsedUrl.pathname === '/api/spotify-artists') {
    return searchSpotify(parsedUrl, res);
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/apple-artists') {
    return searchApple(parsedUrl, res);
  }

  // Static File Serving
  let filePath = path.join(__dirname, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);

  // Security check: prevent directory traversal
  const normalizedFilePath = path.normalize(filePath);
  if (!normalizedFilePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(normalizedFilePath, (err, stats) => {
    if (err) {
      // If file not found, try appending .html
      if (err.code === 'ENOENT' && !path.extname(normalizedFilePath)) {
        const withHtml = normalizedFilePath + '.html';
        if (fs.existsSync(withHtml)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return fs.createReadStream(withHtml).pipe(res);
        }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }

    if (stats.isDirectory()) {
      const indexFile = path.join(normalizedFilePath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(indexFile).pipe(res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }

    const ext = path.extname(normalizedFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(normalizedFilePath).pipe(res);
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sigma Label LLC website server running on port ${PORT}`);
});

export default server;
