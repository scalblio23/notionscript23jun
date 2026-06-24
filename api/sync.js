const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const ROLE_SECTIONS = [
  { role: 'Operator',      start: 1,  end: 7  },
  { role: 'Founder',       start: 9,  end: 15 },
  { role: 'CSM Assistant', start: 17, end: 23 },
  { role: 'Creative',      start: 25, end: 31 },
];

const DIVIDERS = [
  { slot: 8,  name: '🦁 ━━━━━━━━━━━━ FOUNDER ━━━━━━━━━━━━ 🦁' },
  { slot: 16, name: '🦉 ━━━━━━━━━━━━ CSM ASSISTANT ━━━━━━━━━━━━ 🦉' },
  { slot: 24, name: '🦕 ━━━━━━━━━━━━ CREATIVE ━━━━━━━━━━━━ 🦕' },
];

const DIVIDER_MARKER = '━━━';

function isDivider(page) {
  const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
  return title.includes(DIVIDER_MARKER);
}

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

function getPrimaryRole(page) {
  const roles = page.properties['Role']?.multi_select ?? [];
  return roles[0]?.name ?? null;
}

function getCurrentFocusSlot(page) {
  const prop = page.properties['Focus Slot'];
  if (!prop || prop.type !== 'number') return null;
  return prop.number;
}

async function getAllOpenPages() {
  const pages = [];
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

    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

async function ensureDividers(existingDividers) {
  for (const div of DIVIDERS) {
    const exists = existingDividers.some(
      p => (p.properties['Name']?.title?.[0]?.plain_text ?? '') === div.name
    );

    if (!exists) {
      await notion.pages.create({
        parent: { database_id: DATABASE_ID },
        properties: {
          'Name': { title: [{ text: { content: div.name } }] },
          'Focus Slot': { number: div.slot },
          'Status': { select: { name: 'To do' } },
        },
      });
      console.log(`[sync] Created divider: "${div.name}"`);
    }
  }
}

async function syncFocusSlots() {
  console.log('[sync] Starting Focus Slot sync...');

  const allPages = await getAllOpenPages();
  console.log(`[sync] Found ${allPages.length} open page(s)`);

  const dividerPages = allPages.filter(isDivider);
  const tasks = allPages.filter(p => !isDivider(p));

  await ensureDividers(dividerPages);

  tasks.sort((a, b) => calcPriorityScore(a) - calcPriorityScore(b));

  const updates = [];
  const assignedIds = new Set();

  for (const section of ROLE_SECTIONS) {
    const sectionTasks = tasks.filter(t => getPrimaryRole(t) === section.role);

    sectionTasks.forEach((task, i) => {
      const desired = i < 7 ? section.start + i : null;
      const current = getCurrentFocusSlot(task);
      if (current !== desired) {
        updates.push({ id: task.id, slot: desired });
      }
      assignedIds.add(task.id);
    });
  }

  // Clear slots for tasks with no matching role section
  for (const task of tasks) {
    if (!assignedIds.has(task.id) && getCurrentFocusSlot(task) !== null) {
      updates.push({ id: task.id, slot: null });
    }
  }

  // Ensure divider slots are correct
  for (const div of DIVIDERS) {
    const page = dividerPages.find(
      p => (p.properties['Name']?.title?.[0]?.plain_text ?? '') === div.name
    );
    if (page && getCurrentFocusSlot(page) !== div.slot) {
      updates.push({ id: page.id, slot: div.slot });
    }
  }

  console.log(`[sync] ${updates.length} page(s) need updating`);

  for (const { id, slot } of updates) {
    await notion.pages.update({
      page_id: id,
      properties: { 'Focus Slot': { number: slot } },
    });
    console.log(`[sync] Updated page ${id} → Focus Slot ${slot}`);
  }

  console.log('[sync] Sync complete.');
  return { tasksFound: tasks.length, pagesUpdated: updates.length };
}

module.exports = { syncFocusSlots };
