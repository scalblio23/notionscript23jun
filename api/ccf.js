const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const CLIENT_DB_ID = process.env.NOTION_CLIENT_DB_ID;
const CCF_TEMPLATE_DB_ID = process.env.NOTION_CCF_TEMPLATE_DB_ID;
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;

const CCF_TRIGGER_VALUE = 'DANGER: This will trigger CCF task flow';
const CCF_DONE_VALUE = 'Done';

async function getTriggeredClients() {
  const clients = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: CLIENT_DB_ID,
      filter: {
        property: 'CCF Trigger',
        status: { equals: CCF_TRIGGER_VALUE },
      },
      start_cursor: cursor,
      page_size: 100,
    });

    clients.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return clients;
}

async function getCCFTemplatePages() {
  const pages = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: CCF_TEMPLATE_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });

    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

function getTitle(page) {
  for (const value of Object.values(page.properties)) {
    if (value.type === 'title' && value.title.length > 0) {
      return value.title[0].plain_text;
    }
  }
  return 'Untitled';
}

async function duplicateTasksForClient(clientPageId, templatePages) {
  for (const template of templatePages) {
    const title = getTitle(template);

    await notion.pages.create({
      parent: { database_id: TASK_DB_ID },
      properties: {
        'Name': {
          title: [{ text: { content: title } }],
        },
        'Client': {
          relation: [{ id: clientPageId }],
        },
      },
    });

    console.log(`[ccf] Created task "${title}" for client ${clientPageId}`);
  }
}

async function markClientDone(clientPageId) {
  await notion.pages.update({
    page_id: clientPageId,
    properties: {
      'CCF Trigger': {
        status: { name: CCF_DONE_VALUE },
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

  const templatePages = await getCCFTemplatePages();
  console.log(`[ccf] Found ${templatePages.length} template page(s)`);

  for (const client of triggeredClients) {
    const clientName = client.properties?.['Name']?.title?.[0]?.plain_text || client.id;
    console.log(`[ccf] Processing client: ${clientName}`);

    await duplicateTasksForClient(client.id, templatePages);
    await markClientDone(client.id);
  }

  return { triggered: triggeredClients.length, tasksCreated: triggeredClients.length * templatePages.length };
}

module.exports = { syncCCF };
