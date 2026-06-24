const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const TRACKER_BLOCK_ID = '38924f67814f804d8d24df6cb0f3c506';

const CCF_DONE_VALUE = 'Done';

const STAGES = [
  'Onboarding',
  'Build',
  'Creative Production',
  'Launch Preparation',
  'Ready For Launch',
  'Live',
];

const FILLED = '🟩';
const EMPTY  = '⬜';

function deriveStage(pendingNumbers, ccfRun) {
  if (!ccfRun) return 0;
  if (pendingNumbers.size === 0) return 5;
  const done = (num) => !pendingNumbers.has(num);
  const pending = (num) => pendingNumbers.has(num);
  if (done(23)) return 5; // Launch done → Live
  if (done(25)) return 4; // Final Details done → Ready For Launch
  if (done(20)) return 3; // Ad Creatives Approved done → Launch Preparation
  if (done(6) && (pending(13) || pending(14) || pending(15))) return 2; // Creative Production
  if (done(6)) return 1;  // Strategy done → Build
  return 0;
}

function progressBar(stageIndex) {
  return STAGES.map((_, i) => i <= stageIndex ? FILLED : EMPTY).join('');
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

async function updateProgressTracker() {
  console.log('[tracker] Building client progress tracker...');

  const [tasks, clients] = await Promise.all([getAllTasks(), getAllClients()]);

  const pendingMap = new Map();
  for (const task of tasks) {
    const status = task.properties['Status']?.select?.name ?? '';
    if (status === 'Done') continue;
    const clientId = task.properties['Client']?.relation?.[0]?.id;
    if (!clientId) continue;
    const titleText = task.properties['Name']?.title?.[0]?.plain_text ?? '';
    const match = titleText.match(/^(\d+)\s*-\s*(.+)$/);
    if (!match) continue;
    const num = parseInt(match[1]);
    const taskName = match[2].trim();
    if (!pendingMap.has(clientId)) pendingMap.set(clientId, new Map());
    pendingMap.get(clientId).set(num, taskName);
  }

  const rows = clients.map(client => {
    const clientId = client.id;
    const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
    const ccfRun = client.properties['CCF Trigger']?.select?.name === CCF_DONE_VALUE;
    const pendingTaskMap = pendingMap.get(clientId) ?? new Map();
    const pendingNumbers = new Set(pendingTaskMap.keys());
    const stageIndex = deriveStage(pendingNumbers, ccfRun);

    let nextTask = null;
    if (pendingTaskMap.size > 0) {
      const lowestNum = Math.min(...pendingTaskMap.keys());
      nextTask = `${lowestNum} - ${pendingTaskMap.get(lowestNum)}`;
    }

    return { name, stageIndex, nextTask };
  });

  rows.sort((a, b) => b.stageIndex - a.stageIndex);

  const existing = await notion.blocks.children.list({ block_id: TRACKER_BLOCK_ID });
  for (const block of existing.results) {
    if (block.archived) continue;
    await notion.blocks.delete({ block_id: block.id });
  }

  if (rows.length === 0) {
    await notion.blocks.children.append({
      block_id: TRACKER_BLOCK_ID,
      children: [{
        paragraph: { rich_text: [{ text: { content: 'No clients found.' } }] },
      }],
    });
    return { clientsTracked: 0 };
  }

  const children = rows.map(({ name, stageIndex, nextTask }) => {
    const bar = progressBar(stageIndex);
    const stageName = STAGES[stageIndex];
    const next = nextTask ? `  →  ${nextTask}` : '';
    const line = `${name.padEnd(22)}${bar}  ${stageName}${next}`;
    return {
      paragraph: { rich_text: [{ text: { content: line } }] },
    };
  });

  await notion.blocks.children.append({ block_id: TRACKER_BLOCK_ID, children });

  console.log(`[tracker] Updated tracker with ${rows.length} client(s)`);
  return { clientsTracked: rows.length };
}

module.exports = { updateProgressTracker };
