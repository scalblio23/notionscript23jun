const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const QUOTE_BLOCK_ID = '38924f67814f807faa52c191d0a7fa35';

const QUOTES = [
  '"The secret of getting ahead is getting started." — Mark Twain',
  '"It always seems impossible until it\'s done." — Nelson Mandela',
  '"Don\'t watch the clock; do what it does. Keep going." — Sam Levenson',
  '"The harder I work, the luckier I get." — Samuel Goldwyn',
  '"Success is not final, failure is not fatal: it is the courage to continue that counts." — Winston Churchill',
  '"Believe you can and you\'re halfway there." — Theodore Roosevelt',
  '"The only way to do great work is to love what you do." — Steve Jobs',
  '"Push yourself, because no one else is going to do it for you." — Unknown',
  '"Great things never come from comfort zones." — Unknown',
  '"Dream it. Wish it. Do it." — Unknown',
  '"Success doesn\'t just find you. You have to go out and get it." — Unknown',
  '"The harder you work for something, the greater you\'ll feel when you achieve it." — Unknown',
  '"Dream bigger. Do bigger." — Unknown',
  '"Don\'t stop when you\'re tired. Stop when you\'re done." — Unknown',
  '"Wake up with determination. Go to bed with satisfaction." — Unknown',
  '"Do something today that your future self will thank you for." — Unknown',
  '"Little things make big days." — Unknown',
  '"It\'s going to be hard, but hard does not mean impossible." — Unknown',
  '"Don\'t wait for opportunity. Create it." — Unknown',
  '"Sometimes we\'re tested not to show our weaknesses, but to discover our strengths." — Unknown',
  '"The key to success is to focus on goals, not obstacles." — Unknown',
  '"Dream it. Believe it. Build it." — Unknown',
  '"The only limit to our realization of tomorrow is our doubts of today." — Franklin D. Roosevelt',
  '"What you get by achieving your goals is not as important as what you become." — Henry David Thoreau',
  '"Motivation is what gets you started. Habit is what keeps you going." — Jim Ryun',
  '"You don\'t have to be great to start, but you have to start to be great." — Zig Ziglar',
  '"Act as if what you do makes a difference. It does." — William James',
  '"Success usually comes to those who are too busy to be looking for it." — Henry David Thoreau',
  '"Opportunities don\'t happen. You create them." — Chris Grosser',
  '"Don\'t be afraid to give up the good to go for the great." — John D. Rockefeller',
];

function getRandomQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

async function updateQuote() {
  console.log('[quote] Selecting motivational quote...');
  const text = getRandomQuote();

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
