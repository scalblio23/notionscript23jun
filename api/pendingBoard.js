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
  10: [6], 11: [6], 12: [6], 13: [6], 14: [6], 15: [6], 16: [6], 17: [6],
  20: [13, 14, 15],
  21: [13, 14, 15],
  25: [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22,24],
  28: [21, 16, 15, 17, 12, 10],
  29: [21, 16, 15, 17, 12, 10],
  23: [25, 15, 16, 13, 14],
  30: [6, 16], 31: [6, 16], 32: [6, 16], 33: [6, 16], 34: [6, 16],
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
  const num = getTaskNumber(page);
  if (num === null) return true;
  const deps = TASK_DEPENDENCIES[num];
  if (!deps || deps.length === 0) return true;
  const clientId = getClientId(page);
  if (!clientId) return true;
  const doneTasks = doneMap.get(clientId) ?? new Set();
  return deps.every(d => doneTasks.has(d));
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

  const desiredRows = pendingClients.map(client => {
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

    return buildRichText(name, daysOld, score, todayText, overdueText, upcomingText);
  });

  // Fetch existing blocks
  const allExisting = await getCurrentChildren();

  // Only reuse paragraph blocks — non-paragraph blocks can't be updated in-place
  const existing = allExisting.filter(b => b.type === 'paragraph');
  const nonParagraph = allExisting.filter(b => b.type !== 'paragraph');

  // Step 1: Delete non-paragraph blocks and any excess paragraph blocks immediately.
  // This cleans up duplicates left by any previous concurrent run.
  const excessParas = existing.slice(desiredRows.length);
  const toDelete = [...nonParagraph, ...excessParas];
  if (toDelete.length > 0) {
    await Promise.all(toDelete.map(b => safeDeleteBlock(b.id)));
    console.log(`[pendingBoard] Cleaned up ${toDelete.length} excess/invalid block(s)`);
  }

  // Step 2: Update existing paragraph blocks in-place
  const reusable = existing.slice(0, desiredRows.length);
  if (reusable.length > 0) {
    await Promise.all(
      reusable.map((block, i) =>
        notion.blocks.update({ block_id: block.id, paragraph: { rich_text: desiredRows[i] } })
      )
    );
  }

  // Step 3: Append missing rows — re-fetch first to minimise concurrent-append race
  if (reusable.length < desiredRows.length) {
    const recheckBlocks = await getCurrentChildren();
    const recheckParas = recheckBlocks.filter(b => b.type === 'paragraph');
    const stillNeeded = desiredRows.length - recheckParas.length;
    if (stillNeeded > 0) {
      const extra = desiredRows.slice(recheckParas.length).map(rich_text => ({
        type: 'paragraph',
        paragraph: { rich_text },
      }));
      await notion.blocks.children.append({ block_id: BOARD_BLOCK_ID, children: extra });
      console.log(`[pendingBoard] Appended ${extra.length} new row(s)`);
    }
  }

  console.log(`[pendingBoard] Board updated with ${desiredRows.length} client(s)`);
  return { clientsShown: desiredRows.length };
}

module.exports = { updatePendingBoard };
