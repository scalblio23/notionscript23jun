const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const FOCUS_SLOTS = 7;

async function getAllOpenTasks() {
  const tasks = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Status',
        status: { does_not_equal: 'Done' },
      },
      sorts: [{ property: 'Priority Score', direction: 'ascending' }],
      start_cursor: cursor,
      page_size: 100,
    });

    tasks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return tasks;
}

function getCurrentFocusSlot(page) {
  const prop = page.properties['Focus Slot'];
  if (!prop || prop.type !== 'number') return null;
  return prop.number;
}

async function syncFocusSlots() {
  console.log('[sync] Starting Focus Slot sync...');

  const tasks = await getAllOpenTasks();
  console.log(`[sync] Found ${tasks.length} open task(s)`);

  const updates = [];

  for (let i = 0; i < tasks.length; i++) {
    const page = tasks[i];
    const desiredSlot = i < FOCUS_SLOTS ? i + 1 : null;
    const currentSlot = getCurrentFocusSlot(page);

    if (currentSlot === desiredSlot) continue;

    updates.push({ id: page.id, slot: desiredSlot });
  }

  console.log(`[sync] ${updates.length} page(s) need updating`);

  for (const { id, slot } of updates) {
    await notion.pages.update({
      page_id: id,
      properties: {
        'Focus Slot': { number: slot },
      },
    });
    console.log(`[sync] Updated page ${id} → Focus Slot ${slot}`);
  }

  console.log('[sync] Sync complete.');
  return { tasksFound: tasks.length, pagesUpdated: updates.length };
}

module.exports = { syncFocusSlots };
