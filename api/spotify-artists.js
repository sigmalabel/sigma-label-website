let spotifyAccessToken = '';
let spotifyAccessTokenExpiresAt = 0;

function cleanEnvVal(val, prefix) {
  let str = String(val || '').trim();
  if (prefix && str.toUpperCase().startsWith(prefix.toUpperCase() + '=')) {
    str = str.slice(prefix.length + 1).trim();
  }
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

async function getSpotifyToken() {
  const clientId = cleanEnvVal(process.env.SPOTIFY_CLIENT_ID, 'SPOTIFY_CLIENT_ID');
  const clientSecret = cleanEnvVal(process.env.SPOTIFY_CLIENT_SECRET, 'SPOTIFY_CLIENT_SECRET');
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
    const errorBody = await response.text().catch(() => '');
    const idMask = `${clientId.slice(0, 4)}...${clientId.slice(-3)} (len ${clientId.length})`;
    const secretMask = `${clientSecret.slice(0, 4)}...${clientSecret.slice(-3)} (len ${clientSecret.length})`;
    throw new Error(`Spotify authorization failed (${response.status}): ${errorBody} [ID: ${idMask}, Secret: ${secretMask}]`);
  }
  const payload = await response.json();
  spotifyAccessToken = payload.access_token;
  spotifyAccessTokenExpiresAt = Date.now() + Math.max(60, payload.expires_in - 60) * 1000;
  return spotifyAccessToken;
}

export default async function handler(req, res) {
  // Set CORS headers for all requests (GET, OPTIONS, errors)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const query = (req.query?.q || (new URL(req.url, 'http://localhost')).searchParams.get('q') || '').trim().slice(0, 80);
  if (query.length < 2) {
    return res.status(200).json({ results: [] });
  }

  let token = null;
  try {
    token = await getSpotifyToken();
  } catch (err) {
    return res.status(502).json({ code: 'spotify_auth_error', message: err.message, results: [] });
  }

  if (!token) {
    return res.status(503).json({
      code: 'spotify_unconfigured',
      message: 'SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is missing or not loaded.',
      results: []
    });
  }

  try {
    const response = await fetch(`https://api.spotify.com/v1/search?type=artist&limit=8&q=${encodeURIComponent(query)}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return res.status(502).json({ code: 'spotify_search_failed', message: errorText, results: [] });
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

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(502).json({ code: 'spotify_search_failed', message: err.message, results: [] });
  }
}
