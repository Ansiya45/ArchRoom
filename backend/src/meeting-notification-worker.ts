import { MeetingReminderService } from './services/meeting-reminder.service.js';
import { assertEmailConfigured } from './services/meeting-notification.service.js';

// Run separately from the conferencing server. No meeting-start operation exists here.
assertEmailConfigured();
const worker = new MeetingReminderService();
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
do {
  try { const result = await worker.runOnce(); console.log(`Meeting notification pass processed ${result.processed} deliveries.`); }
  catch { console.error('Meeting notification pass failed. Check database migration and email configuration.'); if (process.argv.includes('--once')) process.exit(1); }
  if (process.argv.includes('--once')) process.exit(0);
  // Sleep in short intervals for graceful shutdown, without overlapping passes.
  for (let seconds = 0; seconds < 30 && !stopping; seconds++) await new Promise(resolve => setTimeout(resolve, 1000));
} while (!stopping);
process.exit(0);
