require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;

const TASK_MAP = [
  { number: 1,  name: 'Ad Account Access',        type: 'Onboarding',    roles: ['Operator'] },
  { number: 2,  name: 'Page Access',               type: 'Onboarding',    roles: ['Operator'] },
  { number: 3,  name: 'Dashboard',                 type: 'Onboarding',    roles: ['Operator'] },
  { number: 4,  name: 'Whatsapp Created',          type: 'Onboarding',    roles: ['Operator'] },
  { number: 5,  name: 'Terms of service signed',   type: 'Onboarding',    roles: ['Operator'] },
  { number: 6,  name: 'Strategy (Campaign Brief)', type: 'Day 1',         roles: ['Founder'] },
  { number: 7,  name: 'Funnel Template',           type: 'Day 1',         roles: ['Operator'] },
  { number: 8,  name: 'Message (EOD)',              type: 'Day 1',         roles: ['CSM Assistant'] },
  { number: 10, name: 'Domain',                    type: 'Day 1',         roles: ['Operator'] },
  { number: 11, name: 'Github Repo',               type: 'Day 1',         roles: ['Operator'] },
  { number: 12, name: 'Server',                    type: 'Day 1',         roles: ['Operator'] },
  { number: 13, name: 'Ad Images',                 type: 'Day 2',         roles: ['Creative', 'Operator'] },
  { number: 14, name: 'Ad Videos',                 type: 'Day 2',         roles: ['Creative', 'Operator'] },
  { number: 15, name: 'Ad Copy',                   type: 'Day 2',         roles: ['Creative', 'Operator'] },
  { number: 16, name: 'Ad Targeting / Setup',      type: 'Day 2',         roles: ['Operator'] },
  { number: 17, name: 'Booking System',            type: 'Day 2',         roles: ['Operator'] },
  { number: 18, name: 'Message (Morning)',          type: 'Day 2',         roles: ['CSM Assistant'] },
  { number: 19, name: 'Message (EOD)',              type: 'Day 2',         roles: ['CSM Assistant'] },
  { number: 20, name: 'Ad Creatives Approved',     type: 'Day 3',         roles: ['Founder'] },
  { number: 21, name: 'Ad Setup + Structure',      type: 'Day 3',         roles: ['Operator'] },
  { number: 22, name: 'Message (EOD)',              type: 'Day 3',         roles: ['CSM Assistant'] },
  { number: 23, name: 'Launch',                    type: 'Day 3',         roles: ['Operator'] },
  { number: 24, name: 'Message (Morning)',          type: 'Day 3',         roles: ['CSM Assistant'] },
  { number: 25, name: 'Final Details',             type: 'Day 3',         roles: ['Founder'] },
  { number: 26, name: 'Confirmation Message',      type: 'Day 3',         roles: ['CSM Assistant'] },
  { number: 27, name: 'Booking System',            type: 'Day 3',         roles: ['Operator'] },
  { number: 28, name: 'Automations',               type: 'Day 3',         roles: ['Operator'] },
  { number: 29, name: 'Ad Launch',                 type: 'Day 3',         roles: ['Operator'] },
  { number: 30, name: 'Conversion Mechanism',      type: 'Day 3',         roles: ['Operator'] },
  { number: 31, name: 'Lead Source',               type: 'Client Assets', roles: ['Operator'] },
  { number: 32, name: 'Details',                   type: 'Client Assets', roles: ['Operator'] },
  { number: 33, name: 'Lead Sheet',                type: 'Client Assets', roles: ['Operator'] },
  { number: 34, name: 'Claude Chat',               type: 'Client Assets', roles: ['Operator'] },
  { number: 35, name: 'Claude Code',               type: 'Client Assets', roles: ['Operator'] },
  { number: 36, name: 'Automation Notification',   type: 'Client Assets', roles: ['Operator'] },
  { number: 37, name: 'Server Link',               type: 'Client Assets', roles: ['Operator'] },
  { number: 38, name: 'Host',                      type: 'Client Assets', roles: ['Operator'] },
  { number: 39, name: 'Github',                    type: 'Client Assets', roles: ['Operator'] },
  { number: 40, name: 'GHL Workflow',              type: 'Client Assets', roles: ['Operator'] },
  { number: 41, name: 'GoHighLevel',               type: 'Client Assets', roles: ['Operator'] },
  { number: 42, name: 'Ad Account',                type: 'Client Assets', roles: ['Operator'] },
  { number: 43, name: 'Funnel Link',               type: 'Client Assets', roles: ['Operator'] },
];

// Build a lookup by base name
const taskByName = {};
for (const task of TASK_MAP) {
  taskByName[task.name.toLowerCase()] = task;
}

async function getAllTasks() {
  const pages = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: TASK_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

function getPageTitle(page) {
  for (const value of Object.values(page.properties)) {
    if (value.type === 'title' && value.title.length > 0) {
      return value.title[0].plain_text;
    }
  }
  return '';
}

function matchTask(title) {
  const lower = title.toLowerCase();
  // Match exact base name
  if (taskByName[lower]) return taskByName[lower];
  // Match if title already has number prefix like "1 - Ad Account Access"
  const stripped = lower.replace(/^\d+\s*-\s*/, '').trim();
  if (taskByName[stripped]) return taskByName[stripped];
  return null;
}

async function backfill() {
  console.log('[backfill] Fetching all tasks...');
  const pages = await getAllTasks();
  console.log(`[backfill] Found ${pages.length} tasks`);

  let updated = 0;
  let skipped = 0;

  for (const page of pages) {
    const title = getPageTitle(page);
    const match = matchTask(title);

    if (!match) {
      skipped++;
      continue;
    }

    const newTitle = `${match.number} - ${match.name}`;

    await notion.pages.update({
      page_id: page.id,
      properties: {
        'Name': {
          title: [{ text: { content: newTitle } }],
        },
        'Type': {
          select: { name: match.type },
        },
        'Role': {
          multi_select: match.roles.map(r => ({ name: r })),
        },
      },
    });

    console.log(`[backfill] Updated: "${title}" → "${newTitle}" [${match.type}] [${match.roles.join(', ')}]`);
    updated++;
  }

  console.log(`[backfill] Done. Updated: ${updated}, Skipped: ${skipped}`);
}

backfill().catch(console.error);
