import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberMayUseAction } from '../src/api.js';

test('ordinary members retain read and conversation-level operational actions', () => {
  const allowed = [
    'list', 'enrollments', 'enrollment_status', 'sent_history', 'projected_schedule',
    'labels', 'set_sequence', 'templates', 'storage_usage', 'delivery_stats',
    'campaigns', 'campaign_detail', 'campaign_experiments', 'campaigns_trend',
    'campaigns_tier', 'campaign_inboxes', 'campaign_resend_status',
    'campaign_resend_pending', 'contacts', 'template_media', 'whatsapp_inboxes',
    'compliance', 'record_consent', 'set_suppression', 'suppressed',
    'tpl_list', 'prs_get', 'prs_typing', 'jrn_list', 'jrn_launch',
  ];

  for (const action of allowed) {
    assert.equal(memberMayUseAction(action), true, `${action} should remain member-accessible`);
  }
});

test('ordinary members cannot mutate shared configuration or perform bulk/safety actions', () => {
  const administratorOnly = [
    'save', 'delete', 'bulk_enroll', 'save_template_media', 'create_burn_template',
    'set_whatsapp_inbox', 'save_compliance', 'consent_by_label', 'resume_account',
    'ack_alert', 'campaign_resend', 'campaign_resend_schedule',
    'campaign_resend_unschedule', 'unknown_future_action',
  ];

  for (const action of administratorOnly) {
    assert.equal(memberMayUseAction(action), false, `${action} must require an account admin`);
  }
});
