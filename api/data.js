const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2022-06-28";
const PORTFOLIO_METRICS_DB = "eb52de58478a4550ba49da89d7441ca9";
const DEALFLOW_DB = "1820943b0d80451a807b3010318caabe";

async function queryNotion(dbId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) return [];
  return (await res.json()).results || [];
}

function prop(page, name, type) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (type) {
    case "title":  return p.title?.[0]?.plain_text || null;
    case "number": return p.number ?? null;
    case "select": return p.select?.name || null;
    case "multi":  return p.multi_select?.map(s => s.name) || [];
    default:       return null;
  }
}

async function getPortfolioMetrics() {
  if (!NOTION_TOKEN) return {};
  const rows = await queryNotion(PORTFOLIO_METRICS_DB);
  const map = {};
  const monthOrder = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  for (const row of rows) {
    const company = prop(row, "Company", "title");
    if (!company) continue;
    const year = parseInt(prop(row, "Year", "select") || "0");
    const month = prop(row, "Month", "select") || "";
    const monthIdx = monthOrder.indexOf(month);
    const existing = map[company];
    const exYear = existing ? parseInt(existing._year || "0") : -1;
    const exMonth = existing ? monthOrder.indexOf(existing._month || "") : -1;
    if (!existing || year > exYear || (year === exYear && monthIdx > exMonth)) {
      map[company] = {
        revenue: prop(row, "Revenue", "number"),
        burn: prop(row, "Burn", "number"),
        cash: prop(row, "Cash on Hand", "number"),
        runway: prop(row, "Runway (months)", "number"),
        fte: prop(row, "FTE", "number"),
        month, year: prop(row, "Year", "select"),
        _year: year, _month: month,
      };
    }
  }
  for (const k of Object.keys(map)) { delete map[k]._year; delete map[k]._month; }
  return map;
}

async function getDealflow() {
  if (!NOTION_TOKEN) return null;
  const rows = await queryNotion(DEALFLOW_DB);
  const stageCount = {}, sourceCount = {}, sectorCount = {}, recent = [];
  for (const page of rows) {
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
  recent.sort((a, b) => b.date.localeCompare(a.date));
  return {
    total: rows.length,
    stages: stageCount,
    sources: Object.entries(sourceCount).sort((a,b) => b[1]-a[1]).slice(0,8),
    sectors: Object.entries(sectorCount).sort((a,b) => b[1]-a[1]).slice(0,8),
    recent: recent.slice(0, 8),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
  try {
    const [metrics, dealflow] = await Promise.all([getPortfolioMetrics(), getDealflow()]);
    return res.status(200).json({ metrics, dealflow, syncedAt: new Date().toISOString(), status: "ok" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
