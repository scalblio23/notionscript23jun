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

function isEditedToday(page, today) {
  const edited = page.last_edited_time;
  if (!edited) return false;
  const d = new Date(edited);
  d.setHours(0, 0, 0, 0);
  return d.getTime() === today.getTime() || d.getTime() === today.getTime() - 86400000;
}

async function generateClientMessage(clientName, daysOld, pendingTasks, completedToday) {
  const pending = pendingTasks.length > 0 ? pendingTasks.join(', ') : null;
  const done = completedToday.length > 0 ? completedToday.join(', ') : null;

  const context = [
    pending ? `Tasks we need from the client or that are pending for them today: ${pending}` : null,
    done ? `What we completed for them today: ${done}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `You are a comms assistant at a digital marketing agency. Write a short WhatsApp message to send to a client named ${clientName} (day ${daysOld ?? '?'} of their onboarding).

Context:
${context}

The message should:
- Be professional but warm and slightly humorous
- Be brief (2-4 sentences max)
- Naturally mention what needs to happen or what progress has been made
- Sound like a real person, not a robot
- Do NOT use emojis excessively — one or two max
- Do NOT start with "Hi ${clientName}" or any greeting — jump straight into it

Write only the message text, nothing else.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0]?.text?.trim() ?? `Pending: ${pending ?? 'nothing'}.`;
  } catch (err) {
    console.error(`[commBoard] LLM error for ${clientName}:`, err.message);
    return pending ? `We need to sort out: ${pending}.` : 'All good on our end today.';
  }
}

function buildClientBlock(name, message) {
  return {
    type: 'callout',
    callout: {
      rich_text: [
        { text: { content: name }, annotations: { bold: true } },
        { text: { content: '\n' + message } },
      ],
      icon: { emoji: '💬' },
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

async function updateCommBoard() {
  console.log('[commBoard] Building communication board...');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() + 1);

  const [allTasks, clients] = await Promise.all([getAllTasks(), getAllClients()]);

  const openTasks = allTasks.filter(t => (t.properties['Status']?.select?.name ?? '') !== 'Done');
  const doneTasks = allTasks.filter(t => (t.properties['Status']?.select?.name ?? '') === 'Done');
  const doneMap = buildDoneMap(allTasks);

  const onboardingClients = clients.filter(
    c => c.properties['Onboarding Status']?.select?.name === 'Pending'
  );
  const activeClients = clients.filter(
    c => c.properties['Onboarding Status']?.select?.name === 'Onboarding Complete'
  );

  function getClientData(client) {
    const clientId = client.id;
    const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
    const startDate = getStartDate(client);
    const daysOld = getDaysOld(client);

    const pending = openTasks
      .filter(t => getClientId(t) === clientId)
      .filter(t => isEligible(t, doneMap))
      .filter(t => {
        const due = getTaskDueDate(t, startDate);
        if (!due) return false;
        return diffDays(today, due) >= 0;
      })
      .map(getTaskShortName);

    const done = doneTasks
      .filter(t => getClientId(t) === clientId)
      .filter(t => isEditedToday(t, today))
      .map(getTaskShortName);

    return { name, daysOld, pending, done };
  }

  async function buildClientCards(clientList) {
    const active = clientList.map(getClientData).filter(d => d.pending.length > 0 || d.done.length > 0);
    const messages = await Promise.all(
      active.map(d => generateClientMessage(d.name, d.daysOld, d.pending, d.done))
    );
    return active.map((d, i) => buildClientBlock(d.name, messages[i]));
  }

  const [onboardingCards, activeCards] = await Promise.all([
    buildClientCards(onboardingClients),
    buildClientCards(activeClients),
  ]);

  await deleteAllChildren(COMM_BOARD_BLOCK_ID);

  function columnBlock(heading, cards) {
    const children = [
      {
        type: 'heading_3',
        heading_3: { rich_text: [{ text: { content: heading } }], color: 'default' },
      },
      ...(cards.length > 0 ? cards : [{
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: 'Nothing active today.' } }] },
      }]),
    ];
    return { type: 'column', column: { children } };
  }

  const layout = {
    type: 'column_list',
    column_list: {
      children: [
        columnBlock('🟡 Onboarding Clients', onboardingCards),
        columnBlock('✅ Active Clients', activeCards),
      ],
    },
  };

  await notion.blocks.children.append({ block_id: COMM_BOARD_BLOCK_ID, children: [layout] });

  console.log(`[commBoard] Done — ${onboardingCards.length} onboarding, ${activeCards.length} active`);
  return { onboardingComms: onboardingCards.length, activeComms: activeCards.length };
}

module.exports = { updateCommBoard };
