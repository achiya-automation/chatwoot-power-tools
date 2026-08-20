-- Returning-lead intakes need a terminal status of their own.
--
-- When the same person submits the Facebook form again while their first journey is still
-- waiting for a reply, uq_journey_runs_live (correctly) refuses a second live run in that
-- conversation. That is not a failure: nothing is broken, no lead is lost, and sending the
-- marketing template a second time to someone who ignored the first one is exactly what
-- drags a number's quality rating down at Meta. The engine leaves a private note for the
-- agents instead and answers the caller with success.
--
-- 'failed' was the wrong home for it. claimJourneyIntake reclaims a failed receipt on the
-- next delivery of the same lead id, so a duplicate Facebook webhook would post the same
-- note again — and a legitimate outcome would read as an error in any future report over
-- this table. 'returning_lead' is terminal: claim treats it as a settled duplicate.

ALTER TABLE drip.journey_intakes
  DROP CONSTRAINT IF EXISTS journey_intakes_status_valid;

ALTER TABLE drip.journey_intakes
  ADD CONSTRAINT journey_intakes_status_valid
  CHECK (status IN ('processing', 'started', 'failed', 'returning_lead'));
