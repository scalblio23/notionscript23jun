const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const TRACKER_BLOCK_ID = '38924f67814f804d8d24df6cb0f3c506';

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

function deriveStage(doneNumbers) {
  if (doneNumbers.has(23)) return 5; // Live
  if (doneNumbers.has(26)) return 4; // Ready For Launch
  if (doneNumbers.has(20)) return 3; // Launch Preparation
  if (doneNumbers.has(13) || doneNumbers.has(14) || doneNumbers.has(15)) return 2; // Creative Production
  if (doneNumbers.has(6))  return 1; // Build
  return 0;                           // Onboarding
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

  // Build done set per client: Map<clientId, Set<taskNumber>>
  const doneMap = new Map();
  for (const task of tasks) {
    const status = task.properties['Status']?.select?.name ?? '';
    if (status !== 'Done') continue;
    const clientId = task.properties['Client']?.relation?.[0]?.id;
    if (!clientId) continue;
    const titleText = task.properties['Name']?.title?.[0]?.plain_text ?? '';
    const match = titleText.match(/^(\d+)\s*-/);
    if (!match) continue;
    const num = parseInt(match[1]);
    if (!doneMap.has(clientId)) doneMap.set(clientId, new Set());
    doneMap.get(clientId).add(num);
  }

  // Build lines sorted by stage descending (most advanced first)
  const rows = clients.map(client => {
    const clientId = client.id;
    const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
    const done = doneMap.get(clientId) ?? new Set();
    const stageIndex = deriveStage(done);
    return { name, stageIndex };
  });

  rows.sort((a, b) => b.stageIndex - a.stageIndex);

  // Clear existing children of the tracker block
  const existing = await notion.blocks.children.list({ block_id: TRACKER_BLOCK_ID });
  for (const block of existing.results) {
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

  const children = rows.map(({ name, stageIndex }) => {
    const bar = progressBar(stageIndex);
    const stageName = STAGES[stageIndex];
    const line = `${name.padEnd(22)}${bar}  ${stageName}`;
    return {
      paragraph: { rich_text: [{ text: { content: line } }] },
    };
  });

  await notion.blocks.children.append({ block_id: TRACKER_BLOCK_ID, children });

  console.log(`[tracker] Updated tracker with ${rows.length} client(s)`);
  return { clientsTracked: rows.length };
}

module.exports = { updateProgressTracker };
