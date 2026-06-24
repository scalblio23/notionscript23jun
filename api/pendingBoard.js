const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const BOARD_BLOCK_ID = '38924f67814f80988b67c5b861660521';

const ROLES = ['CSM Assistant', 'Operator', 'Founder', 'Creative'];

const ROLE_EMOJI = {
  'CSM Assistant': '🦉',
  'Operator':      '🦊',
  'Founder':       '🦁',
  'Creative':      '🦕',
};

const STAGE_MESSAGES = [
  { stage: 'Onboarding',    message: 'Send Onboarding Message' },
  { stage: 'Day 1',         message: 'Send Day 1 Message' },
  { stage: 'Day 2',         message: 'Send Day 2 Message' },
  { stage: 'Day 3',         message: 'Send Day 3 Message' },
  { stage: 'Client Assets', message: 'Request Client Assets' },
];

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

function getPrimaryRole(page) {
  return page.properties['Role']?.multi_select?.[0]?.name ?? null;
}

function getOnboardingStage(page) {
  return page.properties['Onboarding Stage']?.select?.name ?? null;
}

function getDaysOld(client) {
  const prop = client.properties['Days Old'];
  if (!prop) return null;
  if (prop.type === 'number') return prop.number;
  if (prop.type === 'formula') {
    const f = prop.formula;
    if (f?.type === 'number') return f.number;
    if (f?.type === 'string') return parseFloat(f.string) || null;
    return f?.number ?? null;
  }
  if (prop.type === 'rollup') return prop.rollup?.number ?? null;
  return null;
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

function deriveCommsRequired(eligibleTasks) {
  const pendingStages = new Set(eligibleTasks.map(t => getOnboardingStage(t)).filter(Boolean));
  for (const { stage, message } of STAGE_MESSAGES) {
    if (pendingStages.has(stage)) return message;
  }
  return null;
}

function buildCard({ name, daysOld, nextByRole, comms }) {
  const lines = [];

  if (daysOld !== null) lines.push(`📅 Day ${daysOld}`);
  if (comms) lines.push(`💬 ${comms}`);

  for (const role of ROLES) {
    if (nextByRole[role]) {
      lines.push(`${ROLE_EMOJI[role]} ${nextByRole[role]}`);
    }
  }

  const bodyText = lines.length > 0 ? lines.join('\n') : '✓ Clear';

  return {
    type: 'callout',
    callout: {
      rich_text: [{ text: { content: name } }],
      icon: { emoji: '⚫' },
      color: 'default',
      children: [{
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: bodyText } }] },
      }],
    },
  };
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

async function updatePendingBoard() {
  console.log('[pendingBoard] Building pending client board...');

  const [allTasks, clients] = await Promise.all([getAllTasks(), getAllClients()]);

  const openTasks = allTasks.filter(t => (t.properties['Status']?.select?.name ?? '') !== 'Done');
  const doneMap = buildDoneMap(allTasks);

  const pendingClients = clients.filter(c =>
    c.properties['Onboarding Status']?.select?.name === 'Pending'
  );

  console.log(`[pendingBoard] ${pendingClients.length} pending client(s)`);

  const cards = pendingClients.map(client => {
    const clientId = client.id;
    const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
    const daysOld = getDaysOld(client);
    console.log(`[pendingBoard] ${name} daysOld=${daysOld} raw=${JSON.stringify(client.properties['Days Old'])}`);

    const eligibleTasks = openTasks
      .filter(t => getClientId(t) === clientId)
      .filter(t => isEligible(t, doneMap));

    eligibleTasks.sort((a, b) => calcPriorityScore(a) - calcPriorityScore(b));

    const nextByRole = {};
    for (const role of ROLES) {
      const task = eligibleTasks.find(t => getPrimaryRole(t) === role);
      if (task) nextByRole[role] = task.properties['Name']?.title?.[0]?.plain_text ?? '';
    }

    const comms = deriveCommsRequired(eligibleTasks);
    return { name, daysOld, nextByRole, comms };
  });

  const existing = await notion.blocks.children.list({ block_id: BOARD_BLOCK_ID });
  for (const block of existing.results) {
    await safeDeleteBlock(block.id);
  }

  if (cards.length === 0) {
    await notion.blocks.children.append({
      block_id: BOARD_BLOCK_ID,
      children: [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'No pending clients.' } }] } }],
    });
    return { clientsShown: 0 };
  }

  // Pair cards into rows of 2 using column_list
  const rows = [];
  for (let i = 0; i < cards.length; i += 2) {
    const pair = cards.slice(i, i + 2);
    rows.push({
      type: 'column_list',
      column_list: {
        children: pair.map(card => ({
          type: 'column',
          column: { children: [buildCard(card)] },
        })),
      },
    });
  }

  await notion.blocks.children.append({ block_id: BOARD_BLOCK_ID, children: rows });

  console.log(`[pendingBoard] Board updated with ${cards.length} client(s)`);
  return { clientsShown: cards.length };
}

module.exports = { updatePendingBoard };
