const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;

const CCF_TRIGGER_VALUE = 'DANGER: This will trigger CCF task flow';
const CCF_DONE_VALUE = 'Done';

const CCF_TASKS = [
  { number: 1,  name: 'Ad Account Access',        stage: 'Onboarding',    roles: ['Operator'] },
  { number: 2,  name: 'Page Access',               stage: 'Onboarding',    roles: ['Operator'] },
  { number: 3,  name: 'Dashboard',                 stage: 'Onboarding',    roles: ['Operator'] },
  { number: 4,  name: 'Whatsapp Created',          stage: 'Onboarding',    roles: ['Operator'] },
  { number: 5,  name: 'Terms of service signed',   stage: 'Onboarding',    roles: ['Operator'] },
  { number: 6,  name: 'Strategy (Campaign Brief)', stage: 'Day 1',         roles: ['Founder'] },
  { number: 7,  name: 'Funnel Template',           stage: 'Day 1',         roles: ['Operator'] },
  { number: 8,  name: 'Message (EOD)',              stage: 'Day 1',         roles: ['CSM Assistant'] },
  { number: 10, name: 'Domain',                    stage: 'Day 1',         roles: ['Operator'] },
  { number: 11, name: 'Github Repo',               stage: 'Day 1',         roles: ['Operator'] },
  { number: 12, name: 'Server',                    stage: 'Day 1',         roles: ['Operator'] },
  { number: 13, name: 'Ad Images',                 stage: 'Day 2',         roles: ['Creative', 'Operator'] },
  { number: 14, name: 'Ad Videos',                 stage: 'Day 2',         roles: ['Creative', 'Operator'] },
  { number: 15, name: 'Ad Copy',                   stage: 'Day 2',         roles: ['Creative', 'Operator'] },
  { number: 16, name: 'Ad Targeting / Setup',      stage: 'Day 2',         roles: ['Operator'] },
  { number: 17, name: 'Booking System',            stage: 'Day 2',         roles: ['Operator'] },
  { number: 18, name: 'Message (Morning)',          stage: 'Day 2',         roles: ['CSM Assistant'] },
  { number: 19, name: 'Message (EOD)',              stage: 'Day 2',         roles: ['CSM Assistant'] },
  { number: 20, name: 'Ad Creatives Approved',     stage: 'Day 3',         roles: ['Founder'] },
  { number: 21, name: 'Ad Setup + Structure',      stage: 'Day 3',         roles: ['Operator'] },
  { number: 22, name: 'Message (EOD)',              stage: 'Day 3',         roles: ['CSM Assistant'] },
  { number: 23, name: 'Launch',                    stage: 'Day 3',         roles: ['Operator'] },
  { number: 24, name: 'Message (Morning)',          stage: 'Day 3',         roles: ['CSM Assistant'] },
  { number: 25, name: 'Final Details',             stage: 'Day 3',         roles: ['Founder'] },
  { number: 26, name: 'Confirmation Message',      stage: 'Day 3',         roles: ['CSM Assistant'] },
  { number: 27, name: 'Booking System',            stage: 'Day 3',         roles: ['Operator'] },
  { number: 28, name: 'Automations',               stage: 'Day 3',         roles: ['Operator'] },
  { number: 29, name: 'Ad Launch',                 stage: 'Day 3',         roles: ['Operator'] },
  { number: 30, name: 'Conversion Mechanism',      stage: 'Day 3',         roles: ['Operator'] },
  { number: 31, name: 'Lead Source',               stage: 'Client Assets', roles: ['Operator'] },
  { number: 32, name: 'Details',                   stage: 'Client Assets', roles: ['Operator'] },
  { number: 33, name: 'Lead Sheet',                stage: 'Client Assets', roles: ['Operator'] },
  { number: 34, name: 'Claude Chat',               stage: 'Client Assets', roles: ['Operator'] },
  { number: 35, name: 'Claude Code',               stage: 'Client Assets', roles: ['Operator'] },
  { number: 36, name: 'Automation Notification',   stage: 'Client Assets', roles: ['Operator'] },
  { number: 37, name: 'Server Link',               stage: 'Client Assets', roles: ['Operator'] },
  { number: 38, name: 'Host',                      stage: 'Client Assets', roles: ['Operator'] },
  { number: 39, name: 'Github',                    stage: 'Client Assets', roles: ['Operator'] },
  { number: 40, name: 'GHL Workflow',              stage: 'Client Assets', roles: ['Operator'] },
  { number: 41, name: 'GoHighLevel',               stage: 'Client Assets', roles: ['Operator'] },
  { number: 42, name: 'Ad Account',                stage: 'Client Assets', roles: ['Operator'] },
  { number: 43, name: 'Funnel Link',               stage: 'Client Assets', roles: ['Operator'] },
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
          title: [{ text: { content: `${task.number} - ${task.name}` } }],
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
        'Type': {
          select: { name: task.stage },
        },
        'Role': {
          multi_select: task.roles.map(r => ({ name: r })),
        },
      },
    });

    console.log(`[ccf] Created task "${task.number} - ${task.name}" [${task.stage}] [${task.roles.join(', ')}]`);
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
