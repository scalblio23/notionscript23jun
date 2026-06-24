const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const FOCUS_SLOTS = 7;

function calcPriorityScore(page) {
  const props = page.properties;
  const taskPriority = props['Task Priority']?.select?.name ?? '';
  const clientPriority = props['Client Priority']?.select?.name ?? '';
  const taskType = props['Type']?.select?.name ?? '';
  const onboardingStage = props['Onboarding Stage']?.select?.name ?? '';
  const taskName = (props['Name']?.title?.[0]?.plain_text ?? '').toLowerCase();

  // Rule 1: absolute override
  if (taskPriority === '💀 Do this before anything else') return -1;

  // Rule 2: Client Priority (High > Med > Low)
  const clientPriorityRank =
    clientPriority === 'High' ? 0 :
    clientPriority === 'Med' ? 1 :
    clientPriority === 'Low' ? 2 : 3;

  // Rule 3: Task Type (Onboarding before regular tasks)
  const taskTypeRank = taskType === 'Onboarding' ? 0 : 1;

  // Rule 4: Message tasks rank higher within their group
  const messageRank = taskName.includes('message') ? 0 : 1;

  // Rule 5: Onboarding Stage sequence (only for Onboarding type)
  const stageRank = taskType === 'Onboarding'
    ? (onboardingStage === 'Onboarding' ? 0 :
       onboardingStage === 'Day 1' ? 1 :
       onboardingStage === 'Day 2' ? 2 :
       onboardingStage === 'Day 3' ? 3 :
       onboardingStage === 'Client Assets' ? 4 : 5)
    : 0;

  // Rule 6: Task Priority
  const taskPriorityRank =
    taskPriority === '🚨 Urgent' ? 1 :
    taskPriority === '⏰ Important' ? 2 :
    taskPriority === '🟠 Pending' ? 3 :
    taskPriority === '😌 Get to it when you can' ? 4 : 5;

  return clientPriorityRank * 10000000
    + taskTypeRank * 1000000
    + messageRank * 100000
    + stageRank * 10000
    + taskPriorityRank * 1000;
}

async function getAllOpenTasks() {
  const tasks = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Status',
        select: { does_not_equal: 'Done' },
      },
      start_cursor: cursor,
      page_size: 100,
    });

    tasks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  tasks.sort((a, b) => calcPriorityScore(a) - calcPriorityScore(b));

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
