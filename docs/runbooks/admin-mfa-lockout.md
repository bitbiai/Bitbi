# Admin MFA Lockout Runbook

## Symptoms

- Admins cannot complete MFA.
- `admin_mfa_rate_limited` or lockout events spike.
- Support reports valid MFA codes rejected.

## Likely Causes

- Legitimate brute-force lockout.
- Clock skew on admin device.
- Wrong purpose-specific MFA secret after Phase 1-D.
- D1 failed-attempt state issue.

## Immediate Checks

- Confirm whether lockouts are isolated or global.
- Check admin MFA logs for safe reason codes and correlation IDs.
- Verify auth Worker config without printing secrets.
- Confirm recent deploys did not change MFA secret compatibility unexpectedly.

## Safe Commands

- `npm run test:workers`
- `npm run validate:cloudflare-prereqs`
- `npm run test:cloudflare-prereqs`

## Approval-Required Commands

- Manual D1 updates to MFA failed-attempt state.
- Admin MFA reset/re-enrollment.
- Secret rotation or rollback.

## Rollback Considerations

- Do not disable MFA globally as first response.
- Preserve Phase 1-D legacy decrypt/proof compatibility until migration is completed.
- If a secret is wrong, restore the previous secret value through approved secret management.

## User Impact

Admin access may be blocked. End-user traffic may continue if no admin action is needed.

## Logs and Events

- `admin_mfa_rate_limited`
- `admin_mfa_verify_failed`
- `admin_mfa_recovery_code_failed`
- config validation failures

## Escalation Criteria

- All admins locked out.
- Suspected compromise or brute-force campaign.
- MFA secret material suspected corrupted.

## Data-Loss Risk

Medium. Manual failed-attempt resets are safer than editing encrypted MFA secrets.
