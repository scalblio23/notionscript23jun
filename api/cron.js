const { syncFocusSlots } = require('./sync');
const { syncCCF } = require('./ccf');
const { updateQuote } = require('./quote');
const { updateProgressTracker } = require('./tracker');

module.exports = async function handler(req, res) {
  try {
    const [focusResult, ccfResult, quoteResult, trackerResult] = await Promise.all([
      syncFocusSlots(),
      syncCCF(),
      updateQuote(),
      updateProgressTracker(),
    ]);

    return res.status(200).json({ ok: true, focusResult, ccfResult, quoteResult, trackerResult });
  } catch (err) {
    console.error('[cron] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
