import {
  listUndeliveredContributions,
  markCharityDelivered,
  markCharityDeliveryFailed,
} from './db.js';
import { charityHoldDays } from './config.js';
import { createGoodApiDonation } from './providers.js';

export async function deliverCharityPortion(env, contribution, fetcher = fetch) {
  if (!contribution || contribution.charity_delivery_status === 'delivered') {
    return { delivered: false, alreadyDelivered: true };
  }
  if (!env.GOODAPI_API_KEY) throw new Error('GoodAPI is not configured.');

  try {
    const donation = await createGoodApiDonation(contribution, env.GOODAPI_API_KEY, fetcher);
    await markCharityDelivered(env.DB, contribution.id, donation.donation_id);
    return { delivered: true, donationId: donation.donation_id };
  } catch (error) {
    await markCharityDeliveryFailed(env.DB, contribution.id, error.message);
    throw error;
  }
}

export async function deliverEligibleCharityPortions(
  env,
  fetcher = fetch,
  { clockOffset = '+0 days' } = {},
) {
  if (!env.DB || !env.GOODAPI_API_KEY) return { attempted: 0, delivered: 0 };

  const contributions = await listUndeliveredContributions(
    env.DB,
    25,
    charityHoldDays(env),
    clockOffset,
  );
  let delivered = 0;
  for (const contribution of contributions) {
    try {
      const result = await deliverCharityPortion(env, contribution, fetcher);
      if (result.delivered) delivered += 1;
    } catch (error) {
      console.error('Charity delivery retry failed.', {
        contributionId: contribution.id,
        message: error.message,
      });
    }
  }
  return { attempted: contributions.length, delivered };
}
