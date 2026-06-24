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

async function generateNarrative(clientName, daysOld, doing, done) {
  const doingList = doing.length > 0 ? doing.join(', ') : 'none';
  const doneList = done.length > 0 ? done.join(', ') : 'none';

  const prompt = `You are writing a brief internal status update for a client onboarding agency's communication board. Keep it to 2-3 sentences. Be direct and operational — no fluff. Write in present tense as if briefing a team member.

Client: ${clientName}
Day: ${daysOld ?? 'unknown'} of onboarding
Tasks active/due today: ${doingList}
Completed today: ${doneList}

Write a short narrative summary of where things stand for this client today.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0]?.text?.trim() ?? `${doing.length} task(s) active, ${done.length} completed today.`;
  } catch (err) {
    console.error(`[commBoard] LLM error for ${clientName}:`, err.message);
    return `Active: ${doingList}. Completed today: ${doneList}.`;
  }
}

function buildClientBlock(name, narrative) {
  // All content in rich_text — no children, avoids Notion 2-level nesting limit
  return {
    type: 'callout',
    callout: {
      rich_text: [
        { text: { content: name }, annotations: { bold: true } },
        { text: { content: '\n' + narrative } },
      ],
      icon: { emoji: '👤' },
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
  } catch (err) {
    if (err.code === 'validation_error') return;
    throw err;
  }
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

  async function buildClientCards(clientList) {
    const cards = [];
    for (const client of clientList) {
      const clientId = client.id;
      const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
      const startDate = getStartDate(client);
      const daysOld = getDaysOld(client);

      const doing = openTasks
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

      if (doing.length === 0 && done.length === 0) continue;

      const narrative = await generateNarrative(name, daysOld, doing, done);
      cards.push(buildClientBlock(name, narrative));
    }
    return cards;
  }

  const [onboardingCards, activeCards] = await Promise.all([
    buildClientCards(onboardingClients),
    buildClientCards(activeClients),
  ]);

  const existing = await notion.blocks.children.list({ block_id: COMM_BOARD_BLOCK_ID });
  for (const block of existing.results) {
    await safeDeleteBlock(block.id);
  }

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
