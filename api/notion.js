const NOTION_TOKEN = process.env.NOTION_TOKEN;
const METRICS_DB   = 'eb52de58-478a-4550-ba49-da89d7441ca9';
const REQUESTS_DB  = '1681305d-81de-4ff7-bcd4-a43e32f877c3';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!NOTION_TOKEN) {
    return res.status(500).json({ error: 'NOTION_TOKEN not set' });
  }

  const headers = {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    // ── 1. Pull all metrics rows ─────────────────────────────────────────────
    let metricsRows = [];
    let cursor = undefined;
    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`https://api.notion.com/v1/databases/${METRICS_DB}/query`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Metrics DB error ${r.status}: ${err}`);
      }
      const data = await r.json();
      metricsRows = metricsRows.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // Build metrics map — latest entry wins per company
    const metrics = {};
    for (const row of metricsRows) {
      const p = row.properties;
      const company = p['Company']?.title?.[0]?.plain_text?.trim();
      if (!company) continue;

      const year  = parseInt(p['Year']?.select?.name || '0');
      const month = p['Month']?.select?.name || '';
      const monthIdx = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December']
                       .indexOf(month);

      // Keep the most recent entry
      const prev = metrics[company];
      const prevScore = prev ? (prev._year * 12 + prev._month) : -1;
      const currScore = year * 12 + monthIdx;
      if (currScore >= prevScore) {
        metrics[company] = {
          rev:     p['Revenue']?.number ?? null,
          burn:    p['Burn']?.number    ?? null,
          cash:    p['Cash on Hand']?.number ?? null,
          runway:  p['Runway (months)']?.number ?? null,
          fte:     p['FTE']?.number    ?? null,
          month, year,
          _year: year, _month: monthIdx,
        };
      }
    }

    // ── 2. Pull all requests ─────────────────────────────────────────────────
    let reqRows = [];
    cursor = undefined;
    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`https://api.notion.com/v1/databases/${REQUESTS_DB}/query`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Requests DB error ${r.status}: ${err}`);
      }
      const data = await r.json();
      reqRows = reqRows.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const requests = reqRows.map(row => {
      const p = row.properties;
      return {
        company:     p['Company']?.title?.[0]?.plain_text?.trim() || '',
        type:        p['Type']?.select?.name || '',
        status:      (p['Status']?.select?.name || 'Open').toLowerCase().replace(' ', ''),
        text:        p['Request']?.rich_text?.[0]?.plain_text || '',
        date:        p['date:Date:start'] || p['Date']?.date?.start || '',
      };
    }).filter(r => r.company);

    // ── 3. Respond ───────────────────────────────────────────────────────────
    res.status(200).json({
      metrics,
      requests,
      syncedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Notion API error:', err);
    res.status(500).json({ error: err.message });
  }
}
