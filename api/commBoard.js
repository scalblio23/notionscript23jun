const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const COMM_BOARD_BLOCK_ID = '38924f67814f80f49992d1f780f379ab';

const STAGE_MESSAGES = [
  { stage: 'Onboarding',    message: 'Send Onboarding Message' },
  { stage: 'Day 1',         message: 'Send Day 1 Message' },
  { stage: 'Day 2',         message: 'Send Day 2 Message' },
  { stage: 'Day 3',         message: 'Send Day 3 Message' },
  { stage: 'Client Assets', message: 'Request Client Assets' },
];

const STAGE_DUE_OFFSET = {
  'Onboarding':    1,
  'Day 1':         2,
  'Day 2':         2,
  'Day 3':         3,
  'Client Assets': 3,
};

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

const COMM_STAGES = new Set(STAGE_MESSAGES.map(s => s.stage));

function getTaskNumber(page) {
  const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
  const match = title.match(/^(\d+)\s*-/);
  return match ? parseInt(match[1]) : null;
}

function getClientId(page) {
  return page.properties['Client']?.relation?.[0]?.id ?? null;
}

function getOnboardingStage(page) {
  return page.properties['Onboarding Stage']?.select?.name ?? null;
}

function getStartDate(client) {
  const prop = client.properties['Start Date'];
  if (!prop) return null;
  const dateStr = prop.date?.start ?? null;
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
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

function getTaskDueDate(task, startDate) {
  if (!startDate) return null;
  const stage = getOnboardingStage(task);
  const offset = STAGE_DUE_OFFSET[stage];
  if (offset === undefined) return null;
  const due = new Date(startDate);
  due.setDate(startDate.getDate() + offset);
  return due;
}

function diffDays(a, b) {
  return Math.floor((a - b) / (1000 * 60 * 60 * 24));
}

function getCommsForClient(clientId, openTasks, doneMap, startDate, today) {
  const clientTasks = openTasks
    .filter(t => getClientId(t) === clientId)
    .filter(t => isEligible(t, doneMap))
    .filter(t => COMM_STAGES.has(getOnboardingStage(t)));

  let overdue = null;
  let dueToday = null;

  for (const task of clientTasks) {
    const stage = getOnboardingStage(task);
    const msgEntry = STAGE_MESSAGES.find(s => s.stage === stage);
    if (!msgEntry) continue;

    const due = getTaskDueDate(task, startDate);
    if (!due) {
      if (!dueToday) dueToday = msgEntry.message;
      continue;
    }

    const d = diffDays(today, due);
    if (d > 0) {
      if (!overdue || d > overdue.days) overdue = { message: msgEntry.message, days: d };
    } else if (d === 0) {
      if (!dueToday) dueToday = msgEntry.message;
    }
  }

  if (overdue) return { bucket: 'eod', message: overdue.message, days: overdue.days };
  if (dueToday) return { bucket: 'sod', message: dueToday };
  return null;
}

async function getAllTasks() {
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

async function safeDeleteBlock(blockId) {
  try {
    await notion.blocks.delete({ block_id: blockId });
  } catch (err) {
    if (err.code === 'validation_error') return;
    throw err;
  }
}

function buildSectionBlocks(label, emoji, entries) {
  const sodEntries = entries.filter(e => e.bucket === 'sod');
  const eodEntries = entries.filter(e => e.bucket === 'eod');

  const blocks = [
    {
      type: 'heading_3',
      heading_3: {
        rich_text: [{ text: { content: `${emoji} ${label}` } }],
        color: 'default',
      },
    },
  ];

  // SOD callout
  const sodLines = sodEntries.length > 0
    ? sodEntries.map(e => `• ${e.name} — ${e.message}`).join('\n')
    : 'Nothing to send';

  blocks.push({
    type: 'callout',
    callout: {
      rich_text: [{ text: { content: '🌅  SOD' }, annotations: { bold: true } }],
      icon: { emoji: '🌅' },
      color: 'yellow_background',
      children: [{
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: sodLines } }] },
      }],
    },
  });

  // EOD callout
  const eodLines = eodEntries.length > 0
    ? eodEntries.map(e => `• ${e.name} — ${e.message}${e.days > 1 ? ` (${e.days} days overdue)` : ' (overdue)'}`).join('\n')
    : 'Nothing to follow up';

  blocks.push({
    type: 'callout',
    callout: {
      rich_text: [{ text: { content: '🌆  EOD' }, annotations: { bold: true } }],
      icon: { emoji: '🌆' },
      color: 'orange_background',
      children: [{
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: eodLines } }] },
      }],
    },
  });

  return blocks;
}

async function updateCommBoard() {
  console.log('[commBoard] Building communication board...');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() + 1); // UTC → local timezone offset

  const [allTasks, clients] = await Promise.all([getAllTasks(), getAllClients()]);

  const openTasks = allTasks.filter(t => (t.properties['Status']?.select?.name ?? '') !== 'Done');
  const doneMap = buildDoneMap(allTasks);

  const pendingClients = clients.filter(
    c => c.properties['Onboarding Status']?.select?.name === 'Pending'
  );
  const completeClients = clients.filter(
    c => c.properties['Onboarding Status']?.select?.name === 'Onboarding Complete'
  );

  function buildEntries(clientList) {
    const entries = [];
    for (const client of clientList) {
      const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
      const startDate = getStartDate(client);
      const comms = getCommsForClient(client.id, openTasks, doneMap, startDate, today);
      if (comms) entries.push({ name, ...comms });
    }
    return entries;
  }

  const pendingEntries = buildEntries(pendingClients);
  const completeEntries = buildEntries(completeClients);

  const existing = await notion.blocks.children.list({ block_id: COMM_BOARD_BLOCK_ID });
  for (const block of existing.results) {
    await safeDeleteBlock(block.id);
  }

  const children = [
    ...buildSectionBlocks('PENDING CLIENTS', '🟡', pendingEntries),
    { type: 'divider', divider: {} },
    ...buildSectionBlocks('ONBOARDING COMPLETE', '✅', completeEntries),
  ];

  await notion.blocks.children.append({ block_id: COMM_BOARD_BLOCK_ID, children });

  console.log(`[commBoard] Done — ${pendingEntries.length} pending, ${completeEntries.length} complete`);
  return { pendingComms: pendingEntries.length, completeComms: completeEntries.length };
}

module.exports = { updateCommBoard };
