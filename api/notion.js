export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { database, page } = req.query;
  const token = process.env.NOTION_TOKEN;

  const dbMap = {
    portfolio: '08d1e1d7-d908-4071-930b-f6c74a35da6d',  // PORTFOLIO
    metrics:   '219f73f7835a4098a2ffb3e97e580905',        // PORTFOLIO METRICS (new)
    requests:  'd60645e5cd144d589bcbeb2ebb330d17',        // Requests from Portfolio Companies (new)
    dealflow:  '8d61bda5-989c-46b6-b8f2-36e540b2fdb7',   // DEALFLOW PIPELINE
  };

  const pageMap = {
    press: '33c6d1ccd46881329c41e80a12f30d5a',  // Media Coverage (new)
    jobs:  '33c6d1ccd468810f866bc9247a2a552f',  // Portfolio Jobs Board (new)
  };

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  };

  try {
    if (database) {
      const dbId = dbMap[database];
      if (!dbId) return res.status(400).json({ error: 'Invalid database' });
      let allResults = [], cursor;
      do {
        const body = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: 'POST', headers, body: JSON.stringify(body)
        });
        const d = await r.json();
        allResults = allResults.concat(d.results || []);
        cursor = d.has_more ? d.next_cursor : undefined;
      } while (cursor);
      return res.status(200).json({ results: allResults });
    }

    if (page) {
      const pageId = pageMap[page];
      if (!pageId) return res.status(400).json({ error: 'Invalid page' });
      const r = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers });
      const d = await r.json();
      return res.status(200).json(d);
    }

    return res.status(400).json({ error: 'Provide database or page param' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
