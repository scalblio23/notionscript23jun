const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const ROLE_SECTIONS = [
  { role: 'CSM Assistant', start: 2,  end: 8  },
  { role: 'Operator',      start: 10, end: 16 },
  { role: 'Founder',       start: 18, end: 24 },
  { role: 'Creative',      start: 26, end: 32 },
];

const DIVIDERS = [
  { slot: 1,  name: '🦉 ━━━━━━━━━━━━ CSM ASSISTANT ━━━━━━━━━━━━ 🦉' },
  { slot: 9,  name: '🦊 ━━━━━━━━━━━━ OPERATOR ━━━━━━━━━━━━ 🦊' },
  { slot: 17, name: '🦁 ━━━━━━━━━━━━ FOUNDER ━━━━━━━━━━━━ 🦁' },
  { slot: 25, name: '🦕 ━━━━━━━━━━━━ CREATIVE ━━━━━━━━━━━━ 🦕' },
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
  const onboardingStage = props['Onboarding Stage']?.select?.name ?? '';
  const taskName = (props['Name']?.title?.[0]?.plain_text ?? '').toLowerCase();

  // Rule 1: absolute override
  if (taskPriority === '💀 Do this before anything else') return -1;

  // Rule 2: Client Priority (High > Med > Low)
  const clientPriorityRank =
    clientPriority === 'High' ? 0 :
    clientPriority === 'Med' ? 1 :
    clientPriority === 'Low' ? 2 : 3;

  // Rule 3: Task Type (Onboarding-related stages before regular tasks)
  const onboardingStages = new Set(['Onboarding', 'Day 1', 'Day 2', 'Day 3', 'Client Assets']);
  const taskTypeRank = onboardingStages.has(onboardingStage) ? 0 : 1;

  // Rule 4: Message tasks rank higher within their group
  const messageRank = taskName.includes('message') ? 0 : 1;

  // Rule 5: Onboarding Stage sequence
  const stageRank =
    onboardingStage === 'Onboarding' ? 0 :
    onboardingStage === 'Day 1' ? 1 :
    onboardingStage === 'Day 2' ? 2 :
    onboardingStage === 'Day 3' ? 3 :
    onboardingStage === 'Client Assets' ? 4 : 5;

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

function selectTop7WithMinTasks(sectionTasks, min = 2) {
  const top7 = sectionTasks.slice(0, 7);
  const rest = sectionTasks.slice(7);

  const isTaskType = t => (t.properties['Type']?.select?.name ?? '') === 'Task';
  const taskCount = top7.filter(isTaskType).length;
  const needed = Math.max(0, min - taskCount);

  if (needed === 0) return top7;

  const extraTasks = rest.filter(isTaskType).slice(0, needed);
  if (extraTasks.length === 0) return top7;

  const nonTaskInTop7 = top7
    .filter(t => !isTaskType(t))
    .sort((a, b) => calcPriorityScore(b) - calcPriorityScore(a));

  const toRemove = new Set(nonTaskInTop7.slice(0, extraTasks.length).map(t => t.id));
  const result = [...top7.filter(t => !toRemove.has(t.id)), ...extraTasks];
  result.sort((a, b) => calcPriorityScore(a) - calcPriorityScore(b));
  return result;
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
  const validNames = new Set(DIVIDERS.map(d => d.name));

  for (const page of existingDividers) {
    const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
    if (!validNames.has(title)) {
      await notion.pages.update({ page_id: page.id, archived: true });
      console.log(`[sync] Archived stale divider: "${title}"`);
    }
  }

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
    const top7 = selectTop7WithMinTasks(sectionTasks);

    top7.forEach((task, i) => {
      const desired = section.start + i;
      const current = getCurrentFocusSlot(task);
      if (current !== desired) {
        updates.push({ id: task.id, slot: desired });
      }
      assignedIds.add(task.id);
    });

    sectionTasks.filter(t => !top7.includes(t)).forEach(task => {
      if (getCurrentFocusSlot(task) !== null) {
        updates.push({ id: task.id, slot: null });
      }
      assignedIds.add(task.id);
    });
  }

  for (const task of tasks) {
    if (!assignedIds.has(task.id) && getCurrentFocusSlot(task) !== null) {
      updates.push({ id: task.id, slot: null });
    }
  }

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
