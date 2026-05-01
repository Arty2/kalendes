import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ids = (process.env.SECRET_FEED_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const feeds = ids.map((id) => {
    const key = 'FEED_' + id.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_NAME';
    return { id, defaultName: process.env[key] ?? id };
  });
  res.status(200).json({ feeds });
}
