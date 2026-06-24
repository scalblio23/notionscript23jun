const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;

const CCF_TRIGGER_VALUE = 'DANGER: This will trigger CCF task flow';
const CCF_DONE_VALUE = 'Done';

const CCF_TASKS = [
  { name: 'Ad Account Access',        stage: 'Onboarding' },
  { name: 'Page Access',               stage: 'Onboarding' },
  { name: 'Dashboard',                 stage: 'Onboarding' },
  { name: 'Whatsapp Created',          stage: 'Onboarding' },
  { name: 'Terms of service signed',   stage: 'Onboarding' },
  { name: 'Strategy (Campaign Brief)', stage: 'Day 1' },
  { name: 'Funnel Template',           stage: 'Day 1' },
  { name: 'Message (EOD)',              stage: 'Day 1' },
  { name: 'Domain',                    stage: 'Day 1' },
  { name: 'Github Repo',               stage: 'Day 1' },
  { name: 'Server',                    stage: 'Day 1' },
  { name: 'Ad Images',                 stage: 'Day 2' },
  { name: 'Ad Videos',                 stage: 'Day 2' },
  { name: 'Ad Copy',                   stage: 'Day 2' },
  { name: 'Ad Targeting / Setup',      stage: 'Day 2' },
  { name: 'Booking System',            stage: 'Day 2' },
  { name: 'Message (Morning)',          stage: 'Day 2' },
  { name: 'Message (EOD)',              stage: 'Day 2' },
  { name: 'Ad Creatives Approved',     stage: 'Day 3' },
  { name: 'Ad Setup + Structure',      stage: 'Day 3' },
  { name: 'Message (EOD)',              stage: 'Day 3' },
  { name: 'Launch',                    stage: 'Day 3' },
  { name: 'Message (Morning)',          stage: 'Day 3' },
  { name: 'Final Details',             stage: 'Day 3' },
  { name: 'Confirmation Message',      stage: 'Day 3' },
  { name: 'Booking System',            stage: 'Day 3' },
  { name: 'Automations',               stage: 'Day 3' },
  { name: 'Ad Launch',                 stage: 'Day 3' },
  { name: 'Conversion Mechanism',      stage: 'Day 3' },
  { name: 'Lead Source',               stage: 'Client Assets' },
  { name: 'Details',                   stage: 'Client Assets' },
  { name: 'Lead Sheet',                stage: 'Client Assets' },
  { name: 'Claude Chat',               stage: 'Client Assets' },
  { name: 'Claude Code',               stage: 'Client Assets' },
  { name: 'Automation Notification',   stage: 'Client Assets' },
  { name: 'Server Link',               stage: 'Client Assets' },
  { name: 'Host',                      stage: 'Client Assets' },
  { name: 'Github',                    stage: 'Client Assets' },
  { name: 'GHL Workflow',              stage: 'Client Assets' },
  { name: 'GoHighLevel',               stage: 'Client Assets' },
  { name: 'Ad Account',                stage: 'Client Assets' },
  { name: 'Funnel Link',               stage: 'Client Assets' },
];

async function getTriggeredClients() {
  const clients = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: CLIENT_DB_ID,
      filter: {
        property: 'CCF Trigger',
        select: { equals: CCF_TRIGGER_VALUE },
      },
      start_cursor: cursor,
      page_size: 100,
    });

    clients.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return clients;
}

async function createTasksForClient(clientPageId) {
  for (const task of CCF_TASKS) {
    await notion.pages.create({
      parent: { database_id: TASK_DB_ID },
      properties: {
        'Name': {
          title: [{ text: { content: task.name } }],
        },
        'Client': {
          relation: [{ id: clientPageId }],
        },
        'Status': {
          select: { name: 'To do' },
        },
        'Onboarding Stage': {
          select: { name: task.stage },
        },
      },
    });

    console.log(`[ccf] Created task "${task.name}" [${task.stage}]`);
  }
}

async function markClientDone(clientPageId) {
  await notion.pages.update({
    page_id: clientPageId,
    properties: {
      'CCF Trigger': {
        select: { name: CCF_DONE_VALUE },
      },
    },
  });
  console.log(`[ccf] Marked CCF Trigger as Done for client ${clientPageId}`);
}

async function syncCCF() {
  console.log('[ccf] Checking for CCF triggers...');

  const triggeredClients = await getTriggeredClients();
  console.log(`[ccf] Found ${triggeredClients.length} triggered client(s)`);

  if (triggeredClients.length === 0) return { triggered: 0 };

  for (const client of triggeredClients) {
    const clientName = client.properties?.['Name']?.title?.[0]?.plain_text || client.id;
    console.log(`[ccf] Processing client: ${clientName}`);

    await createTasksForClient(client.id);
    await markClientDone(client.id);
  }

  return { triggered: triggeredClients.length, tasksCreated: triggeredClients.length * CCF_TASKS.length };
}

module.exports = { syncCCF };
