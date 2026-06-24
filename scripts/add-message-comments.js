require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TASK_DB_ID = process.env.NOTION_DATABASE_ID;

const MESSAGE_TEMPLATES = [
  {
    name: '8 - Message (EOD)',
    stage: 'Day 1',
    comment: `Hey [Client] just to give you an update

We have completed your funnel, server and domain - basically the infrastructure needed for your ads

What we need to cover as we finalise the page is how you take bookings - do you use calendly or another booking system, or would you just simply want us to send jobs?

Tomorrow we will be working on the ads, and booking setup.

We are looking to go live as planned on Wednesday and Thursday - which will commence your service time.

Cheers mate,
Henry`,
  },
  {
    name: '18 - Message (Morning)',
    stage: 'Day 2',
    comment: `Hey [Client] sounds good, working on creatives today for ads

Ready to go live tomorrow

Ill report back close to EOD on progress`,
  },
  {
    name: '19 - Message (EOD)',
    stage: 'Day 2',
    comment: `Hi [Client], yep will be good to go live tomorrow with the first campaign`,
  },
  {
    name: '22 - Message (EOD)',
    stage: 'Day 3',
    comment: `Hey @[Client] good news we are all live and running!

If you have any questions let me know

There will be 1-3 days of testing as leads come through and we start getting feedback on the leads come through

This also represents the start of your service time

Thanks!`,
  },
  {
    name: '24 - Message (Morning)',
    stage: 'Day 3',
    comment: `Hi [Client] good morning!

Today is the day!

We will be going live

We will keep you updated throughout the day and let you know if we have any questions`,
  },
  {
    name: '26 - Confirmation Message',
    stage: 'Day 3',
    comment: `Hey [Client] thanks for the message,

Next steps are we will

• Review the form
• Start creating the campaign
• Get the campaign live by Wed, Thu (which is when your service period begins)

In between now and then we will send you ad examples etc, and work back and forth to get things live!`,
  },
];

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

async function getClientName(page) {
  const relation = page.properties['Client']?.relation ?? [];
  if (relation.length === 0) return 'Client';
  try {
    const clientPage = await notion.pages.retrieve({ page_id: relation[0].id });
    return clientPage.properties['Name']?.title?.[0]?.plain_text ?? 'Client';
  } catch {
    return 'Client';
  }
}

async function addComments() {
  console.log('[add-comments] Fetching all tasks...');
  const pages = await getAllTasks();
  console.log(`[add-comments] Found ${pages.length} tasks`);

  let updated = 0;

  for (const page of pages) {
    const title = page.properties['Name']?.title?.[0]?.plain_text ?? '';
    const stage = page.properties['Onboarding Stage']?.select?.name ?? '';

    const template = MESSAGE_TEMPLATES.find(t => t.name === title && t.stage === stage);
    if (!template) continue;

    const clientName = await getClientName(page);
    const text = template.comment.replace(/\[Client\]/g, clientName);

    await notion.comments.create({
      parent: { page_id: page.id },
      rich_text: [{ text: { content: text } }],
    });

    console.log(`[add-comments] Added comment to "${title}" for client "${clientName}"`);
    updated++;
  }

  console.log(`[add-comments] Done. Updated ${updated} task(s).`);
}

addComments().catch(console.error);
