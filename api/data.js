const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2022-06-28";
const PORTFOLIO_DB = "eb52de58478a4550ba49da89d7441ca9";
const DEALFLOW_DB = "1820943b0d80451a807b3010318caabe";
const REQUESTS_DB = "1681305d81de4ff7bcd4a43e32f877c3";

async function queryNotion(dbId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 100 }),
  });
  if (!res.ok) {
    console.error(`queryNotion ${dbId} failed: ${res.status}`);
    return [];
  }
  return (await res.json()).results || [];
}

async function queryNotionAll(dbId, maxPages = 25) {
  let results = [];
  let cursor = undefined;
  let pages = 0;
  while (pages < maxPages) {
    const body = cursor
      ? JSON.stringify({ page_size: 100, start_cursor: cursor })
      : JSON.stringify({ page_size: 100 });
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!res.ok) {
      console.error(`queryNotionAll page ${pages} failed: ${res.status} ${await res.text()}`);
      break;
    }
    const json = await res.json();
    results = results.concat(json.results || []);
    pages++;
    if (!json.has_more) break;
    cursor = json.next_cursor;
  }
  console.log(`queryNotionAll ${dbId}: fetched ${results.length} records in ${pages} pages`);
  return results;
}

function prop(page, name, type) {
  const p = page.properties?.[name];
  if (!p) return null;
  if (type === "title") return p.title?.[0]?.plain_text || null;
  if (type === "number") return p.number ?? null;
  if (type === "select") return p.select?.name || null;
  if (type === "multi") return p.multi_select?.map(s => s.name) || [];
  if (type === "text") return p.rich_text?.[0]?.plain_text || null;
  if (type === "date") return p.date?.start || null;
  if (type === "url") return p.url || null;
  return null;
}

const toM = v => v == null ? null : v / 1000000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Short cache: 30s fresh, serve stale up to 5min while revalidating
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");

  if (!NOTION_TOKEN) {
    return res.status(200).json({ metrics: {}, dealflow: null, requests: [], status: "no_token" });
  }

  try {
    const monthOrder = ["January","February","March","April","May","June","July","August","September","October","November","December"];

    // Fetch portfolio + requests quickly; fetch dealflow with full pagination
    const [portRows, reqRows, dfRows] = await Promise.all([
      queryNotion(PORTFOLIO_DB),
      queryNotion(REQUESTS_DB),
      queryNotionAll(DEALFLOW_DB),
    ]);

    // Portfolio metrics — latest month per company
    const metrics = {};
    for (const row of portRows) {
      const company = prop(row, "Company", "title");
      if (!company) continue;
      const year = parseInt(prop(row, "Year", "select") || "0");
      const month = prop(row, "Month", "select") || "";
      const monthIdx = monthOrder.indexOf(month);
      const ex = metrics[company];
      const exY = ex ? parseInt(ex._y || "0") : -1;
      const exM = ex ? monthOrder.indexOf(ex._m || "") : -1;
      if (!ex || year > exY || (year === exY && monthIdx > exM)) {
        metrics[company] = {
          revenue: toM(prop(row, "Revenue", "number")),
          burn: toM(prop(row, "Burn", "number")),
          cash: toM(prop(row, "Cash on Hand", "number")),
          runway: prop(row, "Runway (months)", "number"),
          fte: prop(row, "FTE", "number"),
          month, year: prop(row, "Year", "select"),
          _y: year, _m: month
        };
      }
    }
    for (const k of Object.keys(metrics)) { delete metrics[k]._y; delete metrics[k]._m; }

    // Requests — sorted newest first
    const requests = reqRows.map(row => ({
      company: prop(row, "Company", "title"),
      type: prop(row, "Type", "select"),
      request: prop(row, "Request", "text"),
      status: prop(row, "Status", "select"),
      date: prop(row, "Date", "date"),
    })).filter(r => r.company).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    // Dealflow — aggregate across all fetched pages
    const stageCount = {}, sourceCount = {}, sectorCount = {}, recent = [];
    for (const page of dfRows) {
      const name = prop(page, "Company Name", "title");
      const stages = prop(page, "Investment Team Decision", "multi") || [];
      const sources = prop(page, "Source", "multi") || [];
      const sectors = prop(page, "Business Model", "multi") || [];
      const date = page.properties?.["First Call Date"]?.date?.start || "";
      stages.forEach(s => stageCount[s] = (stageCount[s] || 0) + 1);
      sources.forEach(s => sourceCount[s] = (sourceCount[s] || 0) + 1);
      sectors.forEach(s => sectorCount[s] = (sectorCount[s] || 0) + 1);
      if (name) recent.push({ name, stage: stages[0] || "", source: sources[0] || "", sector: sectors[0] || "", date });
    }
    recent.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    return res.status(200).json({
      metrics,
      requests,
      dealflow: {
        total: dfRows.length,
        stages: stageCount,
        sources: Object.entries(sourceCount).sort((a,b) => b[1]-a[1]).slice(0,10),
        sectors: Object.entries(sectorCount).sort((a,b) => b[1]-a[1]).slice(0,10),
        recent: recent.slice(0, 10),
      },
      syncedAt: new Date().toISOString(),
      status: "ok"
    });
  } catch (err) {
    console.error("handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
