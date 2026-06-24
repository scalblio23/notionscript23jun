const { Client } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TASK_DB_ID = process.env.NOTION_DATABASE_ID;
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const COMM_BOARD_BLOCK_ID = '38924f67814f80f49992d1f780f379ab';

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

function getTaskNumber(page) {
  const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
  const match = title.match(/^(\d+)\s*-/);
  return match ? parseInt(match[1]) : null;
}

function getTaskShortName(page) {
  const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
  const match = title.match(/^\d+\s*-\s*(.+)$/);
  return match ? match[1].trim() : title;
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

function getDaysOld(client) {
  const prop = client.properties['Days Old'];
  if (!prop) return null;
  if (prop.type === 'number') return prop.number;
  if (prop.type === 'formula') {
    const f = prop.formula;
    if (f?.type === 'number') return f.number + 1;
    return f?.number ?? null;
  }
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

async function generateMessage(clientName, daysOld, tasks) {
  const taskList = tasks.join(', ');

  const prompt = `You write short WhatsApp messages on behalf of an Australian digital marketing agency owner.

Style rules:
- Max 15 words total
- Casual, direct, friendly — like texting a mate
- Use "Hey [name]" to open
- Short punchy sentences, sometimes incomplete
- Occasionally use "will" statements: "Will keep you updated"
- No corporate speak, no fluff
- No more than one emoji, often none
- Australian informal tone

Examples of the style:
"Hey mate will post the stats shortly"
"Hey Christian thanks for completing the form! Will start the campaign process now"
"Working on your campaign today, hoping to go live tomorrow"

Client: ${clientName} (day ${daysOld ?? '?'} of onboarding)
What needs to happen: ${taskList}

Write the message. 15 words max. Nothing else.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0]?.text?.trim() ?? taskList;
  } catch (err) {
    console.error(`[commBoard] LLM error for ${clientName}:`, err.message);
    return `Hey ${clientName}, just need: ${tasks[0]}.`;
  }
}

function buildTodoBlock(clientName, message) {
  return {
    type: 'to_do',
    to_do: {
      rich_text: [
        { text: { content: `${clientName}: ` }, annotations: { bold: true } },
        { text: { content: message } },
      ],
      checked: false,
      color: 'default',
    },
  };
}

async function getAllTasks() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({ database_id: TASK_DB_ID, start_cursor: cursor, page_size: 100 });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function getAllClients() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({ database_id: CLIENT_DB_ID, start_cursor: cursor, page_size: 100 });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function safeDeleteBlock(blockId) {
  try {
    await notion.blocks.delete({ block_id: blockId });
    return true;
  } catch (err) {
    if (err.code === 'validation_error') return false;
    throw err;
  }
}

async function deleteAllChildren(blockId) {
  let cursor;
  let total = 0;
  let deleted = 0;
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    total += res.results.length;
    for (const block of res.results) {
      const ok = await safeDeleteBlock(block.id);
      if (ok) deleted++;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  console.log(`[commBoard] Cleared ${deleted}/${total} existing block(s)`);
}

async function updateCommBoard() {
  console.log('[commBoard] Building communication board...');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() + 1);

  const [allTasks, clients] = await Promise.all([getAllTasks(), getAllClients()]);
  const openTasks = allTasks.filter(t => (t.properties['Status']?.select?.name ?? '') !== 'Done');
  const doneMap = buildDoneMap(allTasks);

  const activeClients = clients.filter(c => {
    const status = c.properties['Onboarding Status']?.select?.name;
    return status === 'Pending' || status === 'Onboarding Complete';
  });

  const results = await Promise.all(activeClients.map(async client => {
    const clientId = client.id;
    const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
    const startDate = getStartDate(client);
    const daysOld = getDaysOld(client);

    const tasks = openTasks
      .filter(t => getClientId(t) === clientId)
      .filter(t => isEligible(t, doneMap))
      .filter(t => {
        const due = getTaskDueDate(t, startDate);
        if (!due) return false;
        return diffDays(today, due) >= 0;
      })
      .map(getTaskShortName);

    if (tasks.length === 0) return null;

    const message = await generateMessage(name, daysOld, tasks);
    return buildTodoBlock(name, message);
  }));

  const todos = results.filter(Boolean);

  await deleteAllChildren(COMM_BOARD_BLOCK_ID);

  if (todos.length === 0) {
    await notion.blocks.children.append({
      block_id: COMM_BOARD_BLOCK_ID,
      children: [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'No messages needed today.' } }] } }],
    });
    return { count: 0 };
  }

  await notion.blocks.children.append({ block_id: COMM_BOARD_BLOCK_ID, children: todos });

  console.log(`[commBoard] Done — ${todos.length} message(s)`);
  return { count: todos.length };
}

module.exports = { updateCommBoard };
