const { syncFocusSlots } = require('./sync');
const { syncCCF } = require('./ccf');
const { updateQuote } = require('./quote');
const { updateProgressTracker } = require('./tracker');
const { syncClientBreakdown } = require('./clientBreakdown');

module.exports = async function handler(req, res) {
  try {
    const [focusResult, ccfResult, quoteResult, trackerResult, breakdownResult] = await Promise.all([
      syncFocusSlots(),
      syncCCF(),
      updateQuote(),
      updateProgressTracker(),
      syncClientBreakdown(),
    ]);

    return res.status(200).json({ ok: true, focusResult, ccfResult, quoteResult, trackerResult, breakdownResult });
  } catch (err) {
    console.error('[cron] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
