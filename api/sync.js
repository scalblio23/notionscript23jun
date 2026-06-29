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
  { slot: 1,  name: '🦩 ━━━━━━━━━━━━ CSM ASSISTANT ━━━━━━━━━━━━ 🦩' },
  { slot: 9,  name: '🦦 ━━━━━━━━━━━━ OPERATOR ━━━━━━━━━━━━ 🦦' },
  { slot: 17, name: '🦡 ━━━━━━━━━━━━ FOUNDER ━━━━━━━━━━━━ 🦡' },
  { slot: 25, name: '🦕 ━━━━━━━━━━━━ CREATIVE ━━━━━━━━━━━━ 🦕' },
  { slot: 33, name: '⏳ ━━━━━━━━━━━━ IN PROGRESS ━━━━━━━━━━━━ ⏳' },
];

const DIVIDER_MARKER = '━━━';
const CLIENT_DIVIDER_EMOJI = '🧑'; // used by clientBreakdown.js — must NOT be archived here

const TASK_DEPENDENCIES = {
  7:  [6],
  10: [6], 11: [6], 12: [6], 13: [6], 14: [6], 15: [6], 16: [6], 27: [6],
  20: [13, 14, 15],
  21: [13, 14, 15],
  25: [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22,24],
  26: [25],
  28: [21, 16, 15, 27, 12, 10],
  29: [21, 16, 15, 27, 12, 10],
  23: [26, 15, 16, 13, 14],
};

const STAGE_DEPENDENCIES = {
  'Client Assets': [6, 16],
};

function getStatus(page) {
  return (page.properties['Status']?.select?.name ?? '').toLowerCase();
}

function isDivider(page) {
  const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
  return title.includes(DIVIDER_MARKER) && !title.includes(CLIENT_DIVIDER_EMOJI);
}

function getTaskNumber(page) {
  const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
  const match = title.match(/^(\d+)\s*-/);
  return match ? parseInt(match[1]) : null;
}

function getClientId(page) {
  return page.properties['Client']?.relation?.[0]?.id ?? null;
}

function buildDoneMap(allTasks) {
  const doneMap = new Map();
  for (const page of allTasks) {
    if (getStatus(page) !== 'done') continue;
    const clientId = getClientId(page);
    const num = getTaskNumber(page);
    if (!clientId || num === null) continue;
    if (!doneMap.has(clientId)) doneMap.set(clientId, new Set());
    doneMap.get(clientId).add(num);
  }
  return doneMap;
}

function isEligible(page, doneMap) {
  const clientId = getClientId(page);
  const doneTasks = clientId ? (doneMap.get(clientId) ?? new Set()) : new Set();

  const num = getTaskNumber(page);
  if (num !== null) {
    const deps = TASK_DEPENDENCIES[num];
    if (deps && deps.length > 0 && !deps.every(d => doneTasks.has(d))) return false;
  }

  const stage = page.properties['Onboarding Stage']?.select?.name ?? '';
  const stageDeps = STAGE_DEPENDENCIES[stage];
  if (stageDeps && stageDeps.length > 0 && !stageDeps.every(d => doneTasks.has(d))) return false;

  return true;
}

function calcPriorityScore(page) {
  const props = page.properties;
  const taskPriority = props['Task Priority']?.select?.name ?? '';
  const clientPriority = props['Client Priority']?.select?.name ?? '';
  const onboardingStage = props['Onboarding Stage']?.select?.name ?? '';
  const taskName = (props['Name']?.title?.[0]?.plain_text ?? '').toLowerCase();
  const efficiency = props['Efficiency']?.select?.name ?? '';

  if (taskPriority === '💀 Do this before anything else') return -1;

  const clientPriorityRank =
    clientPriority === 'High' ? 0 :
    clientPriority === 'Med' ? 1 :
    clientPriority === 'Low' ? 2 : 3;

  const efficiencyRank =
    efficiency === 'Very Overdue' ? 0 :
    efficiency === 'Overdue' ? 1 :
    efficiency === 'On Time' ? 2 : 3;

  const onboardingStages = new Set(['Onboarding', 'Day 1', 'Day 2', 'Day 3', 'Client Assets']);
  const taskTypeRank = onboardingStages.has(onboardingStage) ? 0 : 1;

  const messageRank = taskName.includes('message') ? 0 : 1;

  const stageRank =
    onboardingStage === 'Onboarding' ? 0 :
    onboardingStage === 'Day 1' ? 1 :
    onboardingStage === 'Day 2' ? 2 :
    onboardingStage === 'Day 3' ? 3 :
    onboardingStage === 'Client Assets' ? 4 : 5;

  const taskPriorityRank =
    taskPriority === '🚨 Urgent' ? 1 :
    taskPriority === '⏰ Important' ? 2 :
    taskPriority === '🟠 Pending' ? 3 :
    taskPriority === '😌 Get to it when you can' ? 4 : 5;

  return clientPriorityRank * 100000000
    + efficiencyRank       * 10000000
    + taskTypeRank         * 1000000
    + messageRank          * 100000
    + stageRank            * 10000
    + taskPriorityRank     * 1000;
}

function hasRole(page, role) {
  const roles = page.properties['Role']?.multi_select ?? [];
  return roles.some(r => r.name === role);
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

async function getAllPages() {
  const pages = [];
  let cursor;
  do {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
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
    } else {
      const currentStage = page.properties['Onboarding Stage']?.select?.name ?? null;
      if (currentStage !== null) {
        await notion.pages.update({
          page_id: page.id,
          properties: { 'Onboarding Stage': { select: null } },
        });
        console.log(`[sync] Cleared Onboarding Stage on divider: "${title}"`);
      }
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
          'Onboarding Stage': { select: null },
        },
      });
      console.log(`[sync] Created divider: "${div.name}"`);
    }
  }
}

async function syncFocusSlots() {
  console.log('[sync] Starting Focus Slot sync...');

  const allPages = await getAllPages();
  console.log(`[sync] Found ${allPages.length} total page(s)`);

  const dividerPages = allPages.filter(isDivider);
  const clientDividerPages = allPages.filter(p =>
    (p.properties['Name']?.title?.[0]?.plain_text ?? '').includes(CLIENT_DIVIDER_EMOJI)
  );
  const allTasks = allPages.filter(p => !isDivider(p) && !clientDividerPages.includes(p));

  const inProgressTasks = allTasks.filter(t => getStatus(t) === 'in progress');
  const toDoTasks = allTasks.filter(t => {
    const s = getStatus(t);
    return s !== 'done' && s !== 'in progress';
  });

  const doneMap = buildDoneMap(allTasks);

  await ensureDividers(dividerPages);

  toDoTasks.sort((a, b) => calcPriorityScore(a) - calcPriorityScore(b));

  const updates = [];
  const assignedIds = new Set();

  for (const section of ROLE_SECTIONS) {
    const withRole = toDoTasks.filter(t => hasRole(t, section.role));
    const sectionTasks = withRole.filter(t => isEligible(t, doneMap));

    if (section.role === 'Operator') {
      console.log(`[sync] Operator: ${withRole.length} with role, ${sectionTasks.length} eligible`);
      for (const t of withRole) {
        const name = t.properties['Name']?.title?.[0]?.plain_text ?? '?';
        const num = getTaskNumber(t);
        const stage = t.properties['Onboarding Stage']?.select?.name ?? '';
        const clientId = getClientId(t);
        const doneTasks = clientId ? (doneMap.get(clientId) ?? new Set()) : new Set();
        const taskDeps = num !== null ? TASK_DEPENDENCIES[num] : null;
        const stageDeps = STAGE_DEPENDENCIES[stage] ?? null;
        const taskBlocked = taskDeps && !taskDeps.every(d => doneTasks.has(d));
        const stageBlocked = stageDeps && !stageDeps.every(d => doneTasks.has(d));
        console.log(`[sync]   "${name}" num=${num} stage="${stage}" taskBlocked=${taskBlocked} stageBlocked=${stageBlocked} doneTasks=[${[...doneTasks].join(',')}]`);
      }
    }

    const top7 = selectTop7WithMinTasks(sectionTasks);

    top7.forEach((task, i) => {
      const desired = section.start + i;
      const current = getCurrentFocusSlot(task);
      if (current !== desired) updates.push({ id: task.id, slot: desired });
      assignedIds.add(task.id);
    });

    toDoTasks
      .filter(t => hasRole(t, section.role) && !top7.includes(t))
      .forEach(task => {
        if (getCurrentFocusSlot(task) !== null) updates.push({ id: task.id, slot: null });
        assignedIds.add(task.id);
      });
  }

  for (const task of toDoTasks) {
    if (!assignedIds.has(task.id) && getCurrentFocusSlot(task) !== null) {
      updates.push({ id: task.id, slot: null });
    }
  }

  let ipSlot = 34;
  for (const task of inProgressTasks) {
    assignedIds.add(task.id);
    const current = getCurrentFocusSlot(task);
    if (current !== ipSlot) updates.push({ id: task.id, slot: ipSlot });
    ipSlot++;
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
  return { tasksFound: allTasks.length, pagesUpdated: updates.length };
}

module.exports = { syncFocusSlots };
