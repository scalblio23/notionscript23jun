const { syncFocusSlots } = require('./sync');
const { syncCCF } = require('./ccf');
const { updateQuote } = require('./quote');
const { updateProgressTracker } = require('./tracker');
const { syncClientBreakdown } = require('./clientBreakdown');
const { updatePendingBoard } = require('./pendingBoard');
const { syncEfficiency } = require('./efficiencySync');

async function safeRun(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[cron] ${name} failed:`, err.message);
    return { error: err.message };
  }
}

module.exports = async function handler(req, res) {
  // Run efficiency sync first so priority scoring uses fresh Efficiency values
  const efficiencyResult = await safeRun('efficiencySync', syncEfficiency);

  const [focusResult, ccfResult, quoteResult, trackerResult, breakdownResult, boardResult] = await Promise.all([
    safeRun('sync', syncFocusSlots),
    safeRun('ccf', syncCCF),
    safeRun('quote', updateQuote),
    safeRun('tracker', updateProgressTracker),
    safeRun('clientBreakdown', syncClientBreakdown),
    safeRun('pendingBoard', updatePendingBoard),
  ]);

  return res.status(200).json({ ok: true, efficiencyResult, focusResult, ccfResult, quoteResult, trackerResult, breakdownResult, boardResult });
};
