const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;

const DIVIDER_MARKER = '━━━';
const CLIENT_DIVIDER_EMOJI = '🧑';
const LEGACY_CLIENT_DIVIDER_MARKER = '───';

const TASK_DEPENDENCIES = {
  7:  [6],
  10: [6], 11: [6], 12: [6], 13: [6], 14: [6], 15: [6], 16: [6], 17: [6],
  20: [13, 14, 15],
  21: [13, 14, 15],
  25: [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22,24],
  28: [21, 16, 15, 17, 12, 10],
  29: [21, 16, 15, 17, 12, 10],
  23: [25, 15, 16, 13, 14],
  30: [6], 31: [6], 32: [6], 33: [6], 34: [6],
};

function getTaskNumber(page) {
  const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
  const match = title.match(/^(\d+)\s*-/);
  return match ? parseInt(match[1]) : null;
}

function getClientId(page) {
  return page.properties['Client']?.relation?.[0]?.id ?? null;
}

function isClientDivider(title) {
  return title.includes(CLIENT_DIVIDER_EMOJI) || title.includes(LEGACY_CLIENT_DIVIDER_MARKER);
}

function isDivider(page) {
  const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
  return title.includes(DIVIDER_MARKER) || isClientDivider(title);
}

function buildDoneMap(allTasks) {
  const doneMap = new Map();
  for (const page of allTasks) {
    const status = page.properties['Status']?.select?.name ?? '';
    if (status !== 'Done') continue;
    const clientId = getClientId(page);
    const num = getTaskNumber(page);
    if (!clientId || num === null) continue;
    if (!doneMap.has(clientId)) doneMap.set(clientId, new Set());
    doneMap.get(clientId).add(num);
  }
  return doneMap;
}

function isEligible(page, doneMap) {
  const num = getTaskNumber(page);
  if (num === null) return true;
  const deps = TASK_DEPENDENCIES[num];
  if (!deps || deps.length === 0) return true;
  const clientId = getClientId(page);
  if (!clientId) return true;
  const doneTasks = doneMap.get(clientId) ?? new Set();
  return deps.every(d => doneTasks.has(d));
}

function calcPriorityScore(page) {
  const props = page.properties;
  const taskPriority = props['Task Priority']?.select?.name ?? '';
  const clientPriority = props['Client Priority']?.select?.name ?? '';
  const onboardingStage = props['Onboarding Stage']?.select?.name ?? '';
  const taskName = (props['Name']?.title?.[0]?.plain_text ?? '').toLowerCase();

  if (taskPriority === '💀 Do this before anything else') return -1;

  const clientPriorityRank =
    clientPriority === 'High' ? 0 :
    clientPriority === 'Med' ? 1 :
    clientPriority === 'Low' ? 2 : 3;

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

  return clientPriorityRank * 10000000
    + taskTypeRank * 1000000
    + messageRank * 100000
    + stageRank * 10000
    + taskPriorityRank * 1000;
}

function deriveStageIndex(pendingNumbers, ccfRun) {
  if (!ccfRun) return 0;
  if (pendingNumbers.size === 0) return 5;
  const done = (num) => !pendingNumbers.has(num);
  const pending = (num) => pendingNumbers.has(num);
  if (done(23)) return 5;
  if (done(25)) return 4; // Final Details done → Ready For Launch
  if (done(20)) return 3;
  if (done(6) && (pending(13) || pending(14) || pending(15))) return 2;
  if (done(6)) return 1;
  return 0;
}

async function getAllPages() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function getAllClients() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: CLIENT_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function clientDividerName(clientName) {
  return `${CLIENT_DIVIDER_EMOJI} ━━━━━━━━━━━━ ${clientName.toUpperCase()} ━━━━━━━━━━━━ ${CLIENT_DIVIDER_EMOJI}`;
}

async function ensureClientSlotProperty() {
  const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
  if (!db.properties['Client Slot']) {
    await notion.databases.update({
      database_id: DATABASE_ID,
      properties: {
        'Client Slot': { number: { format: 'number' } },
      },
    });
    console.log('[clientBreakdown] Created "Client Slot" property on task database');
  }
}

async function syncClientBreakdown() {
  console.log('[clientBreakdown] Starting client breakdown sync...');

  await ensureClientSlotProperty();

  const [allPages, clients] = await Promise.all([getAllPages(), getAllClients()]);

  const allTasks = allPages.filter(p => !isDivider(p));
  const openTasks = allTasks.filter(t => (t.properties['Status']?.select?.name ?? '') !== 'Done');
  const existingDividers = allPages.filter(p => {
    const title = p.properties['Name']?.title?.[0]?.plain_text ?? '';
    return isClientDivider(title);
  });

  const doneMap = buildDoneMap(allTasks);

  const pendingMap = new Map();
  for (const task of openTasks) {
    const clientId = getClientId(task);
    const num = getTaskNumber(task);
    if (!clientId || num === null) continue;
    if (!pendingMap.has(clientId)) pendingMap.set(clientId, new Set());
    pendingMap.get(clientId).add(num);
  }

  const clientMeta = clients.map(client => {
    const clientId = client.id;
    const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
    const ccfRun = client.properties['CCF Trigger']?.select?.name === 'Done';
    const pendingNumbers = pendingMap.get(clientId) ?? new Set();
    const stageIndex = deriveStageIndex(pendingNumbers, ccfRun);
    return { clientId, name, stageIndex };
  });

  clientMeta.sort((a, b) =>
    a.stageIndex - b.stageIndex || a.name.localeCompare(b.name)
  );

  const tasksByClient = new Map();
  for (const { clientId } of clientMeta) {
    const clientTasks = openTasks
      .filter(t => getClientId(t) === clientId)
      .filter(t => isEligible(t, doneMap));
    clientTasks.sort((a, b) => calcPriorityScore(a) - calcPriorityScore(b));
    tasksByClient.set(clientId, clientTasks);
  }

  const neededDividerNames = new Set(
    clientMeta
      .filter(({ clientId }) => (tasksByClient.get(clientId) ?? []).length > 0)
      .map(({ name }) => clientDividerName(name))
  );

  for (const div of existingDividers) {
    const title = div.properties['Name']?.title?.[0]?.plain_text ?? '';
    if (!neededDividerNames.has(title)) {
      await notion.pages.update({ page_id: div.id, archived: true });
      console.log(`[clientBreakdown] Archived stale divider: "${title}"`);
    }
  }

  const existingDividersByName = new Map(
    existingDividers.map(d => [d.properties['Name']?.title?.[0]?.plain_text ?? '', d])
  );

  const updates = [];
  const assignedIds = new Set();
  let slotCounter = 1;

  for (const { clientId, name } of clientMeta) {
    const tasks = tasksByClient.get(clientId) ?? [];
    if (tasks.length === 0) continue;

    const divName = clientDividerName(name);

    if (!existingDividersByName.has(divName)) {
      await notion.pages.create({
        parent: { database_id: DATABASE_ID },
        properties: {
          'Name': { title: [{ text: { content: divName } }] },
          'Client Slot': { number: slotCounter },
          'Onboarding Stage': { select: { name: 'Client Header' } },
        },
      });
      console.log(`[clientBreakdown] Created divider: "${divName}" -> slot ${slotCounter}`);
      slotCounter++;
    } else {
      const divPage = existingDividersByName.get(divName);
      const currentSlot = divPage.properties['Client Slot']?.number ?? null;
      const currentStage = divPage.properties['Onboarding Stage']?.select?.name ?? null;
      if (currentSlot !== slotCounter || currentStage !== 'Client Header') {
        updates.push({ id: divPage.id, slot: slotCounter, stage: 'Client Header' });
      }
      slotCounter++;
    }

    for (const task of tasks) {
      assignedIds.add(task.id);
      const currentSlot = task.properties['Client Slot']?.number ?? null;
      if (currentSlot !== slotCounter) {
        updates.push({ id: task.id, slot: slotCounter });
      }
      slotCounter++;
    }
  }

  for (const task of openTasks) {
    if (!assignedIds.has(task.id)) {
      const currentSlot = task.properties['Client Slot']?.number ?? null;
      if (currentSlot !== null) {
        updates.push({ id: task.id, slot: null });
      }
    }
  }

  console.log(`[clientBreakdown] ${updates.length} page(s) need updating`);

  for (const { id, slot, stage } of updates) {
    const props = { 'Client Slot': { number: slot } };
    if (stage) props['Onboarding Stage'] = { select: { name: stage } };
    await notion.pages.update({ page_id: id, properties: props });
  }

  console.log('[clientBreakdown] Sync complete.');
  return { clientsProcessed: clientMeta.length, pagesUpdated: updates.length };
}

module.exports = { syncClientBreakdown };
