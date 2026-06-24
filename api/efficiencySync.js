const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;

function getDaysLate(page) {
  const prop = page.properties['Days Late'];
  if (!prop) return null;
  if (prop.type === 'number') return prop.number;
  if (prop.type === 'formula') {
    const f = prop.formula;
    if (f?.type === 'number') return f.number;
    if (f?.type === 'string') return parseFloat(f.string) || null;
  }
  if (prop.type === 'rollup') return prop.rollup?.number ?? null;
  return null;
}

function calcEfficiency(daysLate) {
  if (daysLate === null) return null;
  if (daysLate <= 1) return 'On Time';
  if (daysLate <= 5) return 'Overdue';
  return 'Very Overdue';
}

async function syncEfficiency() {
  console.log('[efficiencySync] Updating task efficiency statuses...');

  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: TASK_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  const openTasks = pages.filter(p => (p.properties['Status']?.select?.name ?? '') !== 'Done');

  let updated = 0;
  await Promise.all(openTasks.map(async page => {
    const daysLate = getDaysLate(page);
    const desired = calcEfficiency(daysLate);
    if (!desired) return;

    const current = page.properties['Efficiency']?.select?.name ?? null;
    if (current === desired) return;

    await notion.pages.update({
      page_id: page.id,
      properties: { 'Efficiency': { select: { name: desired } } },
    });
    updated++;
  }));

  console.log(`[efficiencySync] Updated ${updated}/${openTasks.length} task(s)`);
  return { tasksUpdated: updated };
}

module.exports = { syncEfficiency };
