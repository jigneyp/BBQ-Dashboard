export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { database, page } = req.query;
  const token = process.env.NOTION_TOKEN;

  // These are the actual DATABASE IDs (not collection/data source IDs)
  const dbMap = {
    portfolio: '2d5acf13c45b4eb39c9b817b4aaf70a6',  // PORTFOLIO
    metrics:   '219f73f7835a4098a2ffb3e97e580905',    // PORTFOLIO METRICS
    requests:  'd60645e5cd144d589bcbeb2ebb330d17',    // Requests from Portfolio Companies
    dealflow:  '1820943b0d80451a807b3010318caabe',    // DEALFLOW PIPELINE
  };

  const pageMap = {
    press: '33c6d1ccd46881329c41e80a12f30d5a',
    jobs:  '33c6d1ccd468810f866bc9247a2a552f',
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
        if (d.status === 400 || d.status === 404) return res.status(d.status).json(d);
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
