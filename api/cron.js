const { syncFocusSlots } = require('./sync');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  // Allow Vercel cron (passes secret as Bearer) or direct calls with the same secret
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await syncFocusSlots();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron] Error during sync:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
