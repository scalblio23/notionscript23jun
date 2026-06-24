const { syncFocusSlots } = require('./sync');
const { syncCCF } = require('./ccf');
const { updateQuote } = require('./quote');

module.exports = async function handler(req, res) {
  try {
    const [focusResult, ccfResult, quoteResult] = await Promise.all([
      syncFocusSlots(),
      syncCCF(),
      updateQuote(),
    ]);

    return res.status(200).json({ ok: true, focusResult, ccfResult, quoteResult });
  } catch (err) {
    console.error('[cron] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
