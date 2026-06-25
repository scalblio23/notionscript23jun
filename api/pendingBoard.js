const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const BOARD_BLOCK_ID = '38924f67814f805aa2fed5efafe2d562';

const STAGE_DUE_OFFSET = {
  'Onboarding':    1,
  'Day 1':         2,
  'Day 2':         2,
  'Day 3':         3,
  'Client Assets': 3,
};

const TASK_DEPENDENCIES = {
  7:  [6],
  10: [6], 11: [6], 12: [6], 13: [6], 14: [6], 15: [6], 16: [6], 27: [6],
  20: [13, 14, 15],
  21: [13, 14, 15],
  25: [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22,24],
  28: [21, 16, 15, 27, 12, 10],
  29: [21, 16, 15, 27, 12, 10],
  23: [25, 15, 16, 13, 14],
};

const STAGE_DEPENDENCIES = {
  'Client Assets': [6, 16],
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
    if (f?.type === 'string') return parseFloat(f.string) || null;
    return f?.number ?? null;
  }
  if (prop.type === 'rollup') return prop.rollup?.number ?? null;
  return null;
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

function calcEfficiencyScore(tasks, startDate, today) {
  if (tasks.length === 0) return 100;
  let total = 0;
  for (const task of tasks) {
    const due = getTaskDueDate(task, startDate);
    if (!due) { total += 1.0; continue; }
    const overdueDays = diffDays(today, due);
    total += overdueDays <= 0 ? 1.0 : Math.max(0, 1 - overdueDays / 10);
  }
  return Math.min(100, Math.round((total / tasks.length) * 100));
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

function getScoreColor(score) {
  if (score <= 33) return 'red';
  if (score <= 66) return 'yellow';
  return 'green';
}

function buildRichText(name, daysOld, score, todayText, overdueText, upcomingText) {
  const prefix = `${name} - Day ${daysOld ?? '?'} - `;
  const suffix = `  |  Tasks today: ${todayText}  |  Overdue: ${overdueText}  |  Upcoming: ${upcomingText}`;
  return [
    { text: { content: prefix } },
    { text: { content: `${score}%` }, annotations: { color: getScoreColor(score) } },
    { text: { content: suffix } },
  ];
}

// Extract the client name from a board row block (first rich_text segment ends with " - Day N - ")
function getBlockClientName(block) {
  if (block.type !== 'paragraph') return null;
  const firstText = block.paragraph?.rich_text?.[0]?.text?.content ?? '';
  const match = firstText.match(/^(.+?) - Day /);
  return match ? match[1] : null;
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

async function getCurrentChildren() {
  const blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: BOARD_BLOCK_ID, start_cursor: cursor, page_size: 100 });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function safeDeleteBlock(blockId) {
  try {
    await notion.blocks.delete({ block_id: blockId });
  } catch (err) {
    if (err.code === 'validation_error' || err.code === 'object_not_found') return;
    throw err;
  }
}

async function updatePendingBoard() {
  console.log('[pendingBoard] Building pending client board...');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() + 1);

  const [allTasks, clients] = await Promise.all([getAllTasks(), getAllClients()]);

  const openTasks = allTasks.filter(t => (t.properties['Status']?.select?.name ?? '') !== 'Done');
  const doneMap = buildDoneMap(allTasks);

  const pendingClients = clients.filter(c =>
    c.properties['Onboarding Status']?.select?.name === 'Pending'
  );

  console.log(`[pendingBoard] ${pendingClients.length} pending client(s)`);

  // Build desired rows keyed by client name
  const desiredByName = new Map();
  for (const client of pendingClients) {
    const clientId = client.id;
    const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
    const daysOld = getDaysOld(client);
    const startDate = getStartDate(client);

    const eligibleTasks = openTasks
      .filter(t => getClientId(t) === clientId)
      .filter(t => isEligible(t, doneMap));

    const overdue = [];
    const dueToday = [];
    const upcoming = [];

    for (const task of eligibleTasks) {
      const due = getTaskDueDate(task, startDate);
      if (!due) { upcoming.push(task); continue; }
      const d = diffDays(today, due);
      if (d > 0) overdue.push(task);
      else if (d === 0) dueToday.push(task);
      else upcoming.push(task);
    }

    const score = calcEfficiencyScore(eligibleTasks, startDate, today);
    const todayText = dueToday.length > 0
      ? dueToday.slice(0, 2).map(getTaskShortName).join(', ') + (dueToday.length > 2 ? ` +${dueToday.length - 2} more` : '')
      : 'None';
    const overdueText = overdue.length > 0 ? `${overdue.length} (e.g. ${getTaskShortName(overdue[0])})` : 'None';
    const upcomingText = `${upcoming.length}`;

    desiredByName.set(name, buildRichText(name, daysOld, score, todayText, overdueText, upcomingText));
  }

  // Read all existing children and index paragraph blocks by client name
  const allExisting = await getCurrentChildren();
  const existingByName = new Map();
  const unknownBlocks = []; // paragraph blocks that don't match a client name
  const nonParagraphBlocks = [];

  for (const block of allExisting) {
    if (block.type !== 'paragraph') {
      nonParagraphBlocks.push(block);
      continue;
    }
    const clientName = getBlockClientName(block);
    if (clientName && desiredByName.has(clientName)) {
      if (existingByName.has(clientName)) {
        // Duplicate block for same client — delete the extra
        unknownBlocks.push(block);
      } else {
        existingByName.set(clientName, block);
      }
    } else {
      unknownBlocks.push(block);
    }
  }

  // Delete non-paragraph blocks and stale/duplicate paragraph blocks
  const toDelete = [...nonParagraphBlocks, ...unknownBlocks];
  if (toDelete.length > 0) {
    await Promise.all(toDelete.map(b => safeDeleteBlock(b.id)));
    console.log(`[pendingBoard] Deleted ${toDelete.length} stale/duplicate block(s)`);
  }

  // Update in-place for clients that already have a block, collect new ones
  const toAppend = [];
  for (const [name, richText] of desiredByName) {
    if (existingByName.has(name)) {
      await notion.blocks.update({
        block_id: existingByName.get(name).id,
        paragraph: { rich_text: richText },
      });
    } else {
      toAppend.push({ type: 'paragraph', paragraph: { rich_text: richText } });
    }
  }

  // Append any new clients (re-fetch first to guard against concurrent appends)
  if (toAppend.length > 0) {
    const recheck = await getCurrentChildren();
    const recheckNames = new Set(
      recheck
        .filter(b => b.type === 'paragraph')
        .map(getBlockClientName)
        .filter(Boolean)
    );
    const stillMissing = toAppend.filter(b => {
      const name = b.paragraph.rich_text[0]?.text?.content?.match(/^(.+?) - Day /)?.[1];
      return name && !recheckNames.has(name);
    });
    if (stillMissing.length > 0) {
      await notion.blocks.children.append({ block_id: BOARD_BLOCK_ID, children: stillMissing });
      console.log(`[pendingBoard] Appended ${stillMissing.length} new client row(s)`);
    }
  }

  console.log(`[pendingBoard] Board updated with ${desiredByName.size} client(s)`);
  return { clientsShown: desiredByName.size };
}

module.exports = { updatePendingBoard };
