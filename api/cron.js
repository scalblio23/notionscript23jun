const { syncFocusSlots } = require('./sync');
const { syncCCF } = require('./ccf');

module.exports = async function handler(req, res) {
  try {
    const [focusResult, ccfResult] = await Promise.all([
      syncFocusSlots(),
      syncCCF(),
    ]);

    return res.status(200).json({ ok: true, focusResult, ccfResult });
  } catch (err) {
    console.error('[cron] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
