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

// Derive stage from which tasks are still pending (not Done, not archived).
// Tasks that are archived (Done + archived in Notion) disappear from the DB,
// so we infer completion from absence rather than presence of a Done status.
// ccfRun: whether CCF was triggered for this client (so absence = done, not "never created")
function deriveStage(pendingNumbers, ccfRun) {
  if (!ccfRun) return 0; // CCF not triggered yet → Onboarding

  // All tasks archived/done
  if (pendingNumbers.size === 0) return 5; // Live

  // A task is "complete" if it is NOT pending (either Done in DB or archived)
  const done = (num) => !pendingNumbers.has(num);
  const pending = (num) => pendingNumbers.has(num);

  if (done(23)) return 5; // Launch done → Live
  if (done(26)) return 4; // Confirmation Message done → Ready For Launch
  if (done(20)) return 3; // Ad Creatives Approved done → Launch Preparation
  if (done(6) && (pending(13) || pending(14) || pending(15))) return 2; // Creative Production
  if (done(6)) return 1;  // Strategy done → Build
  return 0;               // Onboarding
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

  // Build pending task numbers per client (tasks that exist and are NOT Done).
  // Done+archived tasks are absent from the DB entirely — their absence signals completion.
  const pendingMap = new Map(); // Map<clientId, Set<taskNumber>>
  for (const task of tasks) {
    const status = task.properties['Status']?.select?.name ?? '';
    if (status === 'Done') continue;
    const clientId = task.properties['Client']?.relation?.[0]?.id;
    if (!clientId) continue;
    const titleText = task.properties['Name']?.title?.[0]?.plain_text ?? '';
    const match = titleText.match(/^(\d+)\s*-/);
    if (!match) continue;
    const num = parseInt(match[1]);
    if (!pendingMap.has(clientId)) pendingMap.set(clientId, new Set());
    pendingMap.get(clientId).add(num);
  }

  const rows = clients.map(client => {
    const clientId = client.id;
    const name = client.properties['Name']?.title?.[0]?.plain_text ?? 'Unknown';
    const ccfRun = client.properties['CCF Trigger']?.select?.name === CCF_DONE_VALUE;
    const pending = pendingMap.get(clientId) ?? new Set();
    const stageIndex = deriveStage(pending, ccfRun);
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

  const children = rows.flatMap(({ name, stageIndex }) => {
    const bar = progressBar(stageIndex);
    const stageName = STAGES[stageIndex];
    return [
      {
        paragraph: {
          rich_text: [{ text: { content: name }, annotations: { bold: true } }],
        },
      },
      {
        paragraph: {
          rich_text: [{ text: { content: `${bar}  ${stageName}` } }],
        },
      },
    ];
  });

  await notion.blocks.children.append({ block_id: TRACKER_BLOCK_ID, children });

  console.log(`[tracker] Updated tracker with ${rows.length} client(s)`);
  return { clientsTracked: rows.length };
}

module.exports = { updateProgressTracker };
