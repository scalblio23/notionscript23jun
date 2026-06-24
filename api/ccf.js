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

async function getCCFTemplatePages() {
  const pages = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: CCF_TEMPLATE_DB_ID,
      sorts: [{ property: '#', direction: 'ascending' }],
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

function getSelectName(page, propertyName) {
  const prop = page.properties[propertyName];
  if (!prop || prop.type !== 'select' || !prop.select) return null;
  return prop.select.name;
}

function getNumber(page, propertyName) {
  const prop = page.properties[propertyName];
  if (!prop || prop.type !== 'number') return null;
  return prop.number;
}

async function duplicateTasksForClient(clientPageId, templatePages) {
  for (const template of templatePages) {
    const title = getTitle(template);
    const status = getSelectName(template, 'Status');
    const onboardingStage = getSelectName(template, 'Onboarding Stage');
    const number = getNumber(template, '#');

    const properties = {
      'Name': {
        title: [{ text: { content: title } }],
      },
      'Client': {
        relation: [{ id: clientPageId }],
      },
    };

    if (status) {
      properties['Status'] = { select: { name: status } };
    }

    if (onboardingStage) {
      properties['Onboarding Stage'] = { select: { name: onboardingStage } };
    }

    if (number !== null) {
      properties['#'] = { number };
    }

    await notion.pages.create({
      parent: { database_id: TASK_DB_ID },
      properties,
    });

    console.log(`[ccf] Created task #${number} "${title}" [${onboardingStage}] for client ${clientPageId}`);
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
