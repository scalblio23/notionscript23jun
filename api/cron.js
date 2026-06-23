const { syncFocusSlots } = require('./sync');

module.exports = async function handler(req, res) {
  try {
    const result = await syncFocusSlots();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron] Error during sync:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
