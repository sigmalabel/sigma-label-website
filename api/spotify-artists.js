let spotifyAccessToken = '';
let spotifyAccessTokenExpiresAt = 0;

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    return res.status(502).json({ code: 'spotify_auth_error', results: [] });
  }

  if (!token) {
    return res.status(503).json({ code: 'spotify_unconfigured', results: [] });
  }

  try {
    const response = await fetch(`https://api.spotify.com/v1/search?type=artist&limit=8&q=${encodeURIComponent(query)}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return res.status(502).json({ code: 'spotify_search_failed', results: [] });
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
    return res.status(502).json({ code: 'spotify_search_failed', results: [] });
  }
}
