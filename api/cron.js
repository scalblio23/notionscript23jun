const { syncFocusSlots } = require('./sync');
const { syncCCF } = require('./ccf');
const { updateQuote } = require('./quote');
const { updateProgressTracker } = require('./tracker');
const { syncClientBreakdown } = require('./clientBreakdown');
const { updatePendingBoard } = require('./pendingBoard');
const { updateCommBoard } = require('./commBoard');

module.exports = async function handler(req, res) {
  try {
    const [focusResult, ccfResult, quoteResult, trackerResult, breakdownResult, boardResult, commResult] = await Promise.all([
      syncFocusSlots(),
      syncCCF(),
      updateQuote(),
      updateProgressTracker(),
      syncClientBreakdown(),
      updatePendingBoard(),
      updateCommBoard(),
    ]);

    return res.status(200).json({ ok: true, focusResult, ccfResult, quoteResult, trackerResult, breakdownResult, boardResult, commResult });
  } catch (err) {
    console.error('[cron] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
