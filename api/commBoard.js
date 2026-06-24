const { Client } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TASK_DB_ID = process.env.NOTION_DATABASE_ID;
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const COMM_BOARD_BLOCK_ID = '38924f67814f80f49992d1f780f379ab';

// 10:00 AM ACST = 00:30 UTC
const SOD_UTC_HOUR = 0;
const SOD_UTC_MINUTE = 30;

// 5:00 PM ACST = 07:30 UTC
const EOD_UTC_HOUR = 7;
const EOD_UTC_MINUTE = 30;

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

async function generateMessage(clientName, daysOld, tasks, isEOD) {
  if (tasks.length === 0) return null;

  const taskList = tasks.join(', ');
  const timeOfDay = isEOD ? 'end of day follow-up' : 'morning check-in';

  const prompt = `You are a comms assistant at a digital marketing agency writing a WhatsApp message to a client.

Client: ${clientName} (day ${daysOld ?? '?'} of onboarding)
Message type: ${timeOfDay}
Tasks pending for this client today: ${taskList}

Write a short, warm, slightly witty WhatsApp message (2-3 sentences max) that naturally nudges the client on what's needed or updates them on progress. Sound like a real person. No excessive emojis. Do not start with a greeting like "Hi" or "Hey ${clientName}" — get straight to it. Write only the message, nothing else.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0]?.text?.trim() ?? null;
  } catch (err) {
    console.error(`[commBoard] LLM error for ${clientName}:`, err.message);
    return `Pending: ${taskList}.`;
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

function buildHeading(text) {
  return {
    type: 'heading_3',
    heading_3: {
      rich_text: [{ text: { content: text } }],
      color: 'default',
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

async function buildTodos(clients, openTasks, doneMap, today, isEOD) {
  const results = await Promise.all(clients.map(async client => {
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

    const message = await generateMessage(name, daysOld, tasks, isEOD);
    if (!message) return null;

    return buildTodoBlock(name, message);
  }));

  return results.filter(Boolean);
}

async function updateCommBoard() {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();

  const isSOD = utcH === SOD_UTC_HOUR && utcM === SOD_UTC_MINUTE;
  const isEOD = utcH === EOD_UTC_HOUR && utcM === EOD_UTC_MINUTE;

  if (!isSOD && !isEOD) return { skipped: true };

  const label = isSOD ? 'SOD' : 'EOD';
  console.log(`[commBoard] Running ${label} update...`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() + 1); // UTC → ACST offset

  const dateStr = today.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  const [allTasks, clients] = await Promise.all([getAllTasks(), getAllClients()]);
  const openTasks = allTasks.filter(t => (t.properties['Status']?.select?.name ?? '') !== 'Done');
  const doneMap = buildDoneMap(allTasks);

  const onboardingClients = clients.filter(
    c => c.properties['Onboarding Status']?.select?.name === 'Pending'
  );
  const activeClients = clients.filter(
    c => c.properties['Onboarding Status']?.select?.name === 'Onboarding Complete'
  );

  const [onboardingTodos, activeTodos] = await Promise.all([
    buildTodos(onboardingClients, openTasks, doneMap, today, isEOD),
    buildTodos(activeClients, openTasks, doneMap, today, isEOD),
  ]);

  const allTodos = [...onboardingTodos, ...activeTodos];

  if (allTodos.length === 0) {
    console.log(`[commBoard] ${label}: no messages needed`);
    return { label, count: 0 };
  }

  const heading = isSOD
    ? `🌅 Morning Messages — ${dateStr}`
    : `🌆 End of Day Follow-ups — ${dateStr}`;

  const blocks = [buildHeading(heading), ...allTodos];

  // SOD clears the board; EOD appends below (preserving SOD ticks)
  if (isSOD) await deleteAllChildren(COMM_BOARD_BLOCK_ID);

  await notion.blocks.children.append({ block_id: COMM_BOARD_BLOCK_ID, children: blocks });

  console.log(`[commBoard] ${label} written — ${allTodos.length} message(s)`);
  return { label, count: allTodos.length };
}

module.exports = { updateCommBoard };
