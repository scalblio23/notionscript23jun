const { syncFocusSlots } = require('./sync');
const { syncCCF } = require('./ccf');
const { updateQuote } = require('./quote');
const { updateProgressTracker } = require('./tracker');
const { syncClientBreakdown } = require('./clientBreakdown');
const { updatePendingBoard } = require('./pendingBoard');

module.exports = async function handler(req, res) {
  try {
    const [focusResult, ccfResult, quoteResult, trackerResult, breakdownResult, boardResult] = await Promise.all([
      syncFocusSlots(),
      syncCCF(),
      updateQuote(),
      updateProgressTracker(),
      syncClientBreakdown(),
      updatePendingBoard(),
    ]);

    return res.status(200).json({ ok: true, focusResult, ccfResult, quoteResult, trackerResult, breakdownResult, boardResult });
  } catch (err) {
    console.error('[cron] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
