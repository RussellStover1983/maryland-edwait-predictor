import type { VercelRequest, VercelResponse } from '@vercel/node';

const EDAS_BASE = 'https://edas.miemss.org/edas-services/api';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path || '';
  // Fallback: parse from URL directly if query param didn't populate
  if (!path && req.url) {
    const m = req.url.match(/^\/api\/edas\/([^?]*)/);
    if (m) path = m[1];
  }
  const targetUrl = `${EDAS_BASE}/${path}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 expresscare-dashboard/0.1',
        'Accept': 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `EDAS ${response.status}`, target: targetUrl });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
}
