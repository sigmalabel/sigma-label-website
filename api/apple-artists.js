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

  const endpoint = `https://itunes.apple.com/search?media=music&entity=musicArtist&country=US&limit=8&term=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(endpoint, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
      return res.status(502).json({ code: 'apple_search_failed', results: [] });
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

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(502).json({ code: 'apple_search_failed', results: [] });
  }
}
