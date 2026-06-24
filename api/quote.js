const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const QUOTE_BLOCK_ID = '38924f67814f807faa52c191d0a7fa35';

async function fetchQuote() {
  const res = await fetch('https://zenquotes.io/api/random');
  const data = await res.json();
  const { q: quote, a: author } = data[0];
  return `"${quote}" — ${author}`;
}

async function updateQuote() {
  console.log('[quote] Fetching motivational quote...');
  const text = await fetchQuote();

  await notion.blocks.update({
    block_id: QUOTE_BLOCK_ID,
    paragraph: {
      rich_text: [{ text: { content: text } }],
    },
  });

  console.log(`[quote] Updated quote: ${text}`);
  return { quote: text };
}

module.exports = { updateQuote };
