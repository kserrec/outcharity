import { html } from 'hono/html';
import { amountInputValue, displayHost, formatMoney } from './domain.js';

const SITE_DESCRIPTION =
  'Businesses compete for the top spot by giving to charity. Rank is determined by confirmed lifetime contributions.';

function page(
  config,
  {
    title,
    description = SITE_DESCRIPTION,
    path = '/',
    body,
    privatePage = false,
    turnstile = false,
  },
) {
  const fullTitle = title === 'Outcharity' ? 'Outcharity — Advertise by Giving' : `${title} — Outcharity`;
  const canonical = `${config.siteUrl}${path === '/' ? '' : path}`;
  const previewImage = `${config.siteUrl}/og.png`;

  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${fullTitle}</title>
        <meta name="description" content="${description}" />
        ${privatePage
          ? html`<meta name="robots" content="noindex,nofollow,noarchive" />`
          : html`<link rel="canonical" href="${canonical}" />`}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Outcharity" />
        <meta property="og:title" content="${fullTitle}" />
        <meta property="og:description" content="${description}" />
        ${privatePage ? '' : html`<meta property="og:url" content="${canonical}" />`}
        <meta property="og:image" content="${previewImage}" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${fullTitle}" />
        <meta name="twitter:description" content="${description}" />
        <meta name="twitter:image" content="${previewImage}" />
        ${turnstile
          ? html`<script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              async
              defer
            ></script>`
          : ''}
      </head>
      <body>
        ${body}
        <footer class="site-footer">
          <a href="/">Outcharity</a>
          <nav aria-label="Legal and project information">
            <a href="/stats">Stats</a>
            <a href="/help">Help more</a>
            <a href="/about">About</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
          </nav>
        </footer>
        <script src="/app.js" defer></script>
      </body>
    </html>`;
}

function brandHeader() {
  return html`<header class="compact-header">
    <a class="wordmark" href="/" aria-label="Outcharity home">Outcharity</a>
  </header>`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function homeStat(value, label) {
  return html`<li>
    <span class="home-stat-dot" aria-hidden="true"></span>
    <strong>${value}</strong>
    <span>${label}</span>
  </li>`;
}

function homeAllocationBanner(config) {
  if (!config.publicCampaign) return '';

  return html`<aside class="home-allocation-banner" aria-label="Charity allocation">
    <p class="shell">
      <strong>${config.charityPercentage}%</strong> of every contribution goes to
      <a href="${config.charityUrl}" target="_blank" rel="noopener">${config.charityName}</a>.
    </p>
  </aside>`;
}

function homeStatsStrip(data) {
  const advertiserCount = data.advertiserCount ?? data.advertisers?.length ?? 0;
  const items = [
    homeStat(formatMoney(data.grossCents), 'given'),
    homeStat(
      formatCount(advertiserCount),
      Number(advertiserCount) === 1 ? 'advertiser' : 'advertisers',
    ),
    homeStat(
      formatCount(data.paymentCount),
      Number(data.paymentCount) === 1 ? 'payment' : 'payments',
    ),
  ];
  if (data.visitCount !== null && data.visitCount !== undefined) {
    items.push(homeStat(formatCount(data.visitCount), 'visits'));
  }

  return html`<div class="home-stats-strip">
    <div class="shell home-stats-strip-inner">
      <ul class="home-stats-list" aria-label="Campaign snapshot">
        ${items}
      </ul>
      <a class="home-stats-link" href="/stats">Full stats <span aria-hidden="true">↗</span></a>
    </div>
  </div>`;
}

function homeHeader(config, data) {
  return html`${homeAllocationBanner(config)} ${homeStatsStrip(data)}
    <header class="home-header shell">
      <a class="wordmark" href="/" aria-label="Outcharity home">Outcharity</a>
      <nav aria-label="Primary navigation">
        <a href="#leaderboard-title">Leaderboard</a>
        <a href="/stats">Stats</a>
        <a href="/about">About</a>
        <a href="/terms">Rules</a>
      </nav>
    </header>`;
}

function allocationStatement(config, { compact = false } = {}) {
  if (!config.publicCampaign) {
    return html`<p class="${compact ? 'fine-print' : 'allocation prelaunch'}">
      Outcharity is not accepting payments yet. Checkout stays closed until every launch check
      passes.
    </p>`;
  }

  return html`<p class="${compact ? 'fine-print' : 'allocation'}">
    <strong>${config.charityPercentage}%</strong> of every contribution goes to
    <a href="${config.charityUrl}" target="_blank" rel="noopener">${config.charityName}</a>.
    The remaining ${config.platformPercentage}% keeps Outcharity running. Payment-processing fees
    do not reduce the charity amount.
    <span class="required-disclosure">${config.charityDisclosure}</span>
  </p>`;
}

function listingCard(advertiser, index, config) {
  const rank = index + 1;
  const rankClass = rank === 1 ? ' listing-card-first' : rank <= 3 ? ' listing-card-podium' : '';
  const outbidCents = Math.max(advertiser.total_contributed_cents + 100, config.minimumCents);
  const canOutbid = config.checkoutEnabled && outbidCents <= config.maximumCents;
  const outbidLabel =
    rank === 1
      ? `Take #1 for ${formatMoney(outbidCents)}`
      : `Beat #${rank} for ${formatMoney(outbidCents)}`;

  return html`<article class="${`listing-card${rankClass}`}" data-rank="${rank}">
    <a
      class="listing-hit-area"
      href="${advertiser.url}"
      target="_blank"
      rel="noopener sponsored"
      aria-label="${`Visit ${advertiser.name}`}"
    ></a>
    <div class="rank" aria-label="${`Rank ${rank}`}">
      <span>${rank === 1 ? 'Top spot' : 'Rank'}</span>
      <strong>#${rank}</strong>
    </div>
    <img
      class="listing-logo"
      src="${`/${advertiser.logo_key}`}"
      alt="${`${advertiser.name} logo`}"
      width="80"
      height="80"
      loading="${rank <= 3 ? 'eager' : 'lazy'}"
    />
    <div class="listing-copy">
      <h2>${advertiser.name}</h2>
      <p>${advertiser.description}</p>
      <span class="listing-destination">
        ${displayHost(advertiser.url)} <span aria-hidden="true">↗</span>
      </span>
    </div>
    <div class="listing-money">
      <strong>${formatMoney(advertiser.total_contributed_cents)}</strong>
      <span>given</span>
    </div>
    ${canOutbid
      ? html`<a class="outbid-link" href="${`/submit?amount=${amountInputValue(outbidCents)}`}">
          ${outbidLabel}
        </a>`
      : ''}
  </article>`;
}

function recentPaymentItem(payment) {
  return html`<li>
    <a
      class="recent-payment-link"
      href="${payment.url}"
      target="_blank"
      rel="noopener sponsored"
      aria-label="${`Visit ${payment.name}, recently active on Outcharity`}"
    >
      <img
        class="recent-payment-logo"
        src="${`/${payment.logo_key}`}"
        alt=""
        width="30"
        height="30"
        loading="lazy"
      />
      <span class="recent-payment-copy">
        <strong>${payment.name}</strong>
        <span>Recently confirmed</span>
      </span>
    </a>
  </li>`;
}

export function homePage(config, data) {
  const board = data.advertisers.map((advertiser, index) => listingCard(advertiser, index, config));
  const leaders = board.slice(0, 3);
  const remainingListings = board.slice(3);
  const recentPayments = (data.recentPayments || []).slice(0, 3);
  const heroCta = config.checkoutEnabled
    ? html`<a class="button button-primary" href="/submit">Get on the board</a>`
    : html`<span class="button button-disabled" aria-disabled="true">Opening after final checks</span>`;

  const body = html`${homeHeader(config, data)}
    <main class="home-main">
      <section class="campaign-mast shell" aria-labelledby="campaign-title">
        <div class="campaign-copy">
          <p class="home-eyebrow">The giving leaderboard</p>
          <h1 id="campaign-title">
            ${config.publicCampaign ? config.campaignHeadline : 'Advertise by giving.'}
          </h1>
          <p class="campaign-deck">Give more. Rank higher. Get seen.</p>
        </div>
        <div class="campaign-status" aria-label="Campaign status">
          <p class="campaign-total">
            <strong>${formatMoney(data.grossCents)}</strong>
            <span>confirmed giving</span>
          </p>
          ${config.publicCampaign
            ? html`<p class="charity-total">
                <strong>${formatMoney(data.charityCents)}</strong> to charity
              </p>`
            : ''}
          ${heroCta}
          <a class="campaign-stats-link" href="/stats">See campaign stats</a>
          <a class="campaign-help-link" href="/help">Not here to advertise? Help another way</a>
        </div>
      </section>

      <section class="leaderboard shell" aria-labelledby="leaderboard-title">
        <div class="board-heading">
          <div>
            <p class="board-kicker">Ranked by confirmed contributions</p>
            <h2 id="leaderboard-title">Leaderboard</h2>
          </div>
          <p>Ties go to the listing that reached its total first.</p>
        </div>
        <p class="founder-seed-note">Founder seed - $100 donated to kick off the board</p>
        ${board.length > 0
          ? html`<div class="leader-stage">
                <div class="leader-primary">${leaders[0]}</div>
                ${leaders.length > 1
                  ? html`<div class="leader-runners">${leaders.slice(1)}</div>`
                  : ''}
              </div>
              ${remainingListings.length > 0
                ? html`<div class="listing-stack listing-stack-rest">
                    ${remainingListings}
                  </div>`
                : ''}`
          : html`<div class="empty-board">
              <div class="empty-rank" aria-hidden="true">#1</div>
              <div>
                <p>First place is open</p>
                <strong>The first confirmed listing owns the top spot.</strong>
                <span>No filler listings. No made-up activity.</span>
              </div>
            </div>`}
        <div class="allocation-panel">${allocationStatement(config)}</div>
        ${recentPayments.length > 0
          ? html`<section class="recent-activity" aria-labelledby="recent-activity-title">
              <div class="recent-activity-heading">
                <h3 id="recent-activity-title">Recent activity</h3>
                <p>Newest confirmed payments, ordered by recency—not amount.</p>
              </div>
              <ol class="recent-payment-list">
                ${recentPayments.map((payment) => recentPaymentItem(payment))}
              </ol>
            </section>`
          : ''}
      </section>
    </main>`;

  return page(config, { title: 'Outcharity', path: '/', body });
}

function statCard(label, value, note) {
  return html`<div class="stat-card">
    <dt>${label}</dt>
    <dd class="stat-value">${value}</dd>
    <dd class="stat-note">${note}</dd>
  </div>`;
}

export function statsPage(config, stats) {
  const cards = [
    statCard(
      'Total paid',
      formatMoney(stats.totalPaidCents),
      'The sum of confirmed payments currently counted.',
    ),
    statCard(
      'To charity',
      formatMoney(stats.charityCents),
      `The recorded ${config.charityPercentage}% allocation. Fractional cents round in the charity's favor.`,
    ),
    statCard(
      'Payments',
      formatCount(stats.paymentCount),
      'Confirmed transactions currently counted. Repeat payments count separately.',
    ),
    statCard(
      'Advertisers on the board',
      formatCount(stats.advertiserCount),
      'Visible listings with a positive confirmed total.',
    ),
    statCard(
      'Average payment',
      formatMoney(stats.averagePaymentCents),
      'Total paid divided by counted payments, rounded to the nearest cent.',
    ),
  ];
  if (stats.visitCount !== null && stats.visitCount !== undefined) {
    cards.push(
      statCard(
        'Website visits',
        formatCount(stats.visitCount),
        'Entries from a direct link or another site—not unique people. Cloudflare excludes bots; European visits are not collected.',
      ),
    );
  }
  const deliveryCards = [
    statCard(
      'Accepted by provider',
      formatMoney(stats.deliveredCharityCents),
      'GoodAPI accepted the charity share and returned a donation record.',
    ),
    statCard(
      'Awaiting provider',
      formatMoney(stats.awaitingCharityCents),
      `Eligible shares still in the ${config.charityHoldDays}-day verification period or queued for another delivery attempt.`,
    ),
    statCard(
      'Stopped before delivery',
      formatMoney(stats.stoppedCharityCents),
      'Shares not sent because the payment was refunded or disputed before provider acceptance.',
    ),
  ];
  const body = html`${brandHeader()}
    <main class="shell page-main stats-page">
      <p class="eyebrow">Campaign stats</p>
      <h1>How the giving adds up.</h1>
      <p class="page-intro">
        A current aggregate view of confirmed payments and recorded website visits. Refunded or
        disputed payments are excluded, and individual transactions or visits are not published.
      </p>
      <dl class="stats-grid">${cards}</dl>
      <section class="delivery-ledger" aria-labelledby="delivery-ledger-title">
        <div class="delivery-ledger-heading">
          <div>
            <p class="eyebrow">Charity delivery</p>
            <h2 id="delivery-ledger-title">Where every recorded charity share stands.</h2>
          </div>
          <p>
            <strong>${formatMoney(stats.recordedCharityCents)}</strong>
            recorded at payment confirmation across all purchases.
          </p>
        </div>
        <dl class="stats-grid delivery-grid">${deliveryCards}</dl>
        <div class="delivery-ledger-note">
          <p>
            These three statuses cover every recorded charity share. “Accepted by provider” means
            GoodAPI returned a donation record; it does not claim Outcharity independently observed
            the charity’s bank receipt.
          </p>
          <p>
            The delivery ledger keeps aggregate records from listings later hidden. A refund or
            dispute before provider acceptance stops delivery; an already accepted share remains
            recorded because it cannot be recalled.
          </p>
        </div>
      </section>
      <a class="text-link stats-back-link" href="/">Back to the leaderboard</a>
    </main>`;

  return page(config, {
    title: 'Campaign stats',
    description:
      'Public aggregate payment, charity-allocation, and website-visit statistics for Outcharity.',
    path: '/stats',
    body,
  });
}

function fieldError(errors, name) {
  return errors?.[name] ? html`<p class="field-error" id="${`${name}-error`}">${errors[name]}</p>` : '';
}

function amountPicker(config, value, errors) {
  const candidates = [2_500, 10_000, 50_000, 100_000]
    .filter((amount) => amount >= config.minimumCents && amount <= config.maximumCents);
  if (!candidates.includes(config.minimumCents)) candidates.unshift(config.minimumCents);
  const amounts = [...new Set(candidates)].sort((left, right) => left - right);

  return html`<fieldset class="amount-fieldset">
    <legend>Contribution amount</legend>
    <div class="amount-buttons" aria-label="Quick contribution amounts">
      ${amounts.map(
        (amount) => html`<button type="button" class="amount-button" data-amount="${amountInputValue(amount)}">
          ${formatMoney(amount)}
        </button>`,
      )}
      <span>Custom</span>
    </div>
    <label class="money-input">
      <span aria-hidden="true">$</span>
      <input
        id="amount"
        name="amount"
        value="${value}"
        inputmode="decimal"
        autocomplete="off"
        required
        aria-describedby="${errors?.amount ? 'amount-help amount-error' : 'amount-help'}"
      />
    </label>
    <p class="field-help" id="amount-help">
      Minimum ${formatMoney(config.minimumCents)}. Rankings may change while you complete payment.
    </p>
    ${fieldError(errors, 'amount')}
  </fieldset>`;
}

function checkoutNotice(config) {
  return html`<div class="checkout-notice">
    ${allocationStatement(config, { compact: true })}
    <p class="fine-print">
      This purchases leaderboard advertising; it is not a tax-deductible donation by the
      advertiser. By continuing, you agree to the <a href="/terms">Terms</a>.
    </p>
  </div>`;
}

function turnstileWidget(config, action) {
  return html`<div class="checkout-verification">
    <div
      class="cf-turnstile"
      data-sitekey="${config.turnstileSiteKey}"
      data-action="${action}"
      data-size="flexible"
    ></div>
  </div>`;
}

export function submitPage(config, { values = {}, errors = {}, message = '' } = {}) {
  const amount = values.amount || amountInputValue(config.minimumCents);
  const form = config.checkoutEnabled
    ? html`<form class="listing-form" action="/checkout" method="post" enctype="multipart/form-data">
        ${message ? html`<div class="error-summary" role="alert">${message}</div>` : ''}

        <label>
          <span>Company or product name</span>
          <input
            name="name"
            value="${values.name || ''}"
            maxlength="60"
            autocomplete="organization"
            required
            aria-describedby="${errors.name ? 'name-error' : ''}"
          />
          ${fieldError(errors, 'name')}
        </label>

        <label>
          <span>URL</span>
          <input
            name="url"
            value="${values.url || ''}"
            type="url"
            maxlength="400"
            placeholder="https://example.com"
            autocomplete="url"
            required
            aria-describedby="${errors.url ? 'url-error' : ''}"
          />
          ${fieldError(errors, 'url')}
        </label>

        <label>
          <span>One-line description</span>
          <textarea
            name="description"
            maxlength="140"
            rows="3"
            required
            aria-describedby="${errors.description ? 'description-error' : 'description-help'}"
          >${values.description || ''}</textarea>
          <small id="description-help">140 characters maximum.</small>
          ${fieldError(errors, 'description')}
        </label>

        <label>
          <span>Logo</span>
          <input
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            aria-describedby="${errors.logo ? 'logo-help logo-error' : 'logo-help'}"
          />
          <small id="logo-help">PNG, JPEG, or WebP. 512 KB maximum.</small>
          ${fieldError(errors, 'logo')}
        </label>

        <label>
          <span>X handle <em>optional</em></span>
          <input
            name="x_handle"
            value="${values.x_handle || ''}"
            maxlength="16"
            placeholder="@yourcompany"
            autocomplete="off"
            aria-describedby="${errors.x_handle ? 'x_handle-error' : ''}"
          />
          ${fieldError(errors, 'x_handle')}
        </label>

        ${amountPicker(config, amount, errors)}
        ${checkoutNotice(config)}
        ${turnstileWidget(config, config.turnstileActions.newCheckout)}
        <button class="button button-primary button-full" type="submit">Continue to secure payment</button>
      </form>`
    : html`<div class="closed-panel">
        <h2>Checkout is not open yet.</h2>
        <p>
          The charity agreement, campaign wording, and payment setup must all be approved before
          this page can accept money.
        </p>
        <a class="text-link" href="/">Back to the board</a>
      </div>`;

  const body = html`${brandHeader()}
    <main class="narrow-shell page-main">
      <p class="eyebrow">One form. No account.</p>
      <h1>Get on the board.</h1>
      <p class="page-intro">Your confirmed payment determines your position immediately.</p>
      ${form}
    </main>`;

  return page(config, {
    title: 'Get on the board',
    path: '/submit',
    body,
    turnstile: config.checkoutEnabled,
  });
}

export function managePage(config, advertiser, token, { errors = {}, amount = '' } = {}) {
  const rankLine = advertiser.rank
    ? html`Currently <strong>#${advertiser.rank}</strong>`
    : html`Not currently visible on the board`;
  const form = config.checkoutEnabled
    ? html`<form class="give-more-form" action="${`/manage/${token}/checkout`}" method="post">
        ${amountPicker(config, amount || amountInputValue(config.minimumCents), errors)}
        ${checkoutNotice(config)}
        ${turnstileWidget(config, config.turnstileActions.existingCheckout)}
        <button class="button button-primary button-full" type="submit">Give more</button>
      </form>`
    : html`<div class="closed-panel compact">
        <p>Additional payments are closed until the launch approval is complete.</p>
      </div>`;

  const body = html`${brandHeader()}
    <main class="narrow-shell page-main manage-page">
      <p class="eyebrow">Private management link</p>
      <h1>${advertiser.name}</h1>
      <div class="manage-stats">
        <p>${rankLine}</p>
        <strong>${formatMoney(advertiser.total_contributed_cents)} total</strong>
      </div>
      <h2>Move up the board.</h2>
      ${form}
    </main>`;

  return page(config, {
    title: `Manage ${advertiser.name}`,
    body,
    privatePage: true,
    turnstile: config.checkoutEnabled,
  });
}

export function successPage(config, contribution, managementTokenIsValid, managementToken = '') {
  if (!contribution) {
    const pendingBody = html`${brandHeader()}
      <main class="narrow-shell page-main success-page">
        <p class="eyebrow">Waiting for confirmation</p>
        <h1>Your listing is not confirmed yet.</h1>
        <p class="page-intro">
          If you completed payment, the leaderboard will change after Outcharity processes Stripe's
          signed confirmation. Refresh this page in a moment.
        </p>
        <a class="button button-secondary" href="/">View leaderboard</a>
      </main>`;
    return page(config, { title: 'Confirming payment', body: pendingBody, privatePage: true });
  }

  const rankHeading = contribution.rank
    ? `You're #${contribution.rank}.`
    : 'Your payment is confirmed.';
  const shareText = contribution.rank
    ? `We just took #${contribution.rank} on Outcharity with ${formatMoney(
        contribution.total_contributed_cents,
      )} in confirmed contributions for ${contribution.charity_name}. Who wants to knock us off?`
    : `We joined Outcharity with ${formatMoney(
        contribution.total_contributed_cents,
      )} in confirmed contributions for ${contribution.charity_name}.`;

  const body = html`${brandHeader()}
    <main class="narrow-shell page-main success-page">
      <p class="eyebrow">Payment successful</p>
      <h1>${rankHeading}</h1>
      <p class="success-total">
        ${contribution.name} has now given
        <strong>${formatMoney(contribution.total_contributed_cents)}</strong>.
      </p>
      <div class="success-actions">
        <a class="button button-primary" href="/">View leaderboard</a>
        <button class="button button-secondary" type="button" data-copy="${shareText}">Copy share text</button>
      </div>
      ${managementTokenIsValid
        ? html`<div class="management-link">
            <p>Save this private link to contribute again:</p>
            <a href="${`/manage/${managementToken}`}">Manage ${contribution.name}</a>
          </div>`
        : ''}
    </main>`;

  return page(config, { title: 'Payment successful', body, privatePage: true });
}

function externalHelpLink(href, label) {
  return html`<a
    class="help-resource-link"
    href="${href}"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="${label} (opens in a new tab)"
  >
    <span>${label}</span>
    <span aria-hidden="true">↗</span>
  </a>`;
}

export function helpPage(config) {
  const body = html`${brandHeader()}
    <main class="shell page-main help-page">
      <p class="eyebrow">More ways to help</p>
      <h1>You don’t have to buy an ad to help.</h1>
      <p class="page-intro">
        The leaderboard is one way to turn advertising money into a charity allocation. If that
        is not right for you, these direct, research, and non-monetary paths are here for you too.
      </p>

      <div class="help-grid">
        <article class="help-card help-card-featured">
          <p class="help-card-kicker">Featured charity</p>
          <h2>Support St. Jude directly.</h2>
          <p>
            Give on St. Jude Children’s Research Hospital’s own site without purchasing an
            Outcharity listing.
          </p>
          <ul class="help-link-list">
            <li>
              ${externalHelpLink(
                'https://www.stjude.org/donate/donate-to-st-jude.html',
                'Open the official St. Jude donation page',
              )}
            </li>
          </ul>
        </article>

        <article class="help-card">
          <p class="help-card-kicker">Evidence-led giving</p>
          <h2>Compare researched options.</h2>
          <p>
            GiveWell publishes its evidence, current recommended programs, and grant decisions.
            Read the research and decide whether its charities or pooled fund fit your priorities.
          </p>
          <ul class="help-link-list">
            <li>
              ${externalHelpLink(
                'https://www.givewell.org/charities/top-charities',
                'See GiveWell’s current top charities',
              )}
            </li>
            <li>
              ${externalHelpLink(
                'https://www.givewell.org/top-charities-fund',
                'Read about GiveWell’s Top Charities Fund',
              )}
            </li>
          </ul>
        </article>

        <article class="help-card">
          <p class="help-card-kicker">Check before giving</p>
          <h2>Research a charity yourself.</h2>
          <p>
            Confirm a United States organization’s tax-exempt status and filings, then review
            practical guidance for recognizing donation scams and pressure tactics.
          </p>
          <ul class="help-link-list">
            <li>
              ${externalHelpLink(
                'https://www.irs.gov/charities-non-profits/tax-exempt-organization-search',
                'Search IRS tax-exempt organization records',
              )}
            </li>
            <li>
              ${externalHelpLink(
                'https://consumer.ftc.gov/articles/giving-charity',
                'Read the FTC’s charity-giving guidance',
              )}
            </li>
          </ul>
        </article>

        <article class="help-card">
          <p class="help-card-kicker">No purchase required</p>
          <h2>Give blood, food, or time.</h2>
          <p>
            Money is not the only useful resource. Find a nearby blood drive, connect with a local
            food bank, or search for a volunteer role that matches your time and skills.
          </p>
          <ul class="help-link-list">
            <li>
              ${externalHelpLink(
                'https://www.redcrossblood.org/give.html/find-drive',
                'Find an American Red Cross blood drive',
              )}
            </li>
            <li>
              ${externalHelpLink(
                'https://www.feedingamerica.org/find-your-local-foodbank',
                'Find a local Feeding America food bank',
              )}
            </li>
            <li>
              ${externalHelpLink(
                'https://www.idealist.org/en/volunteer',
                'Find volunteer opportunities on Idealist',
              )}
            </li>
          </ul>
        </article>
      </div>

      <aside class="help-trust-note" aria-labelledby="help-trust-title">
        <h2 id="help-trust-title">What happens when you leave Outcharity</h2>
        <p>
          These are plain links with no affiliate or campaign tracking codes. Outcharity does not
          process outside donations or collect whether you donate, give blood, or volunteer. The
          destination site controls its own eligibility rules, terms, privacy practices, and
          receipts. Outcharity does not claim that any destination endorses or is affiliated with
          this project.
        </p>
        <p class="fine-print">
          Destinations last checked <time datetime="2026-08-24">August 24, 2026</time>.
        </p>
      </aside>

      <a class="text-link help-back-link" href="/">Back to the leaderboard</a>
    </main>`;

  return page(config, {
    title: 'More ways to help',
    description:
      'Direct charity, research, blood donation, food-bank, and volunteer resources from Outcharity.',
    path: '/help',
    body,
  });
}

export function aboutPage(config) {
  const body = html`${brandHeader()}
    <main class="narrow-shell prose page-main">
      <h1>One weird advertising market.</h1>
      <p>
        Outcharity is a public leaderboard. Businesses buy attention by contributing toward one
        featured charity. More confirmed money means a higher position. There are no scores,
        targeting systems, or expiring bids.
      </p>
      <blockquote>Want more attention? Give more money to charity.</blockquote>
      ${allocationStatement(config)}
    </main>`;
  return page(config, { title: 'About', path: '/about', body });
}

export function termsPage(config) {
  const body = html`${brandHeader()}
    <main class="narrow-shell prose page-main">
      <h1>Terms</h1>
      <p class="fine-print">Effective when checkout opens.</p>
      <h2>The product</h2>
      <p>
        A payment purchases a public advertising listing. It is not a charitable gift made by the
        advertiser and is not represented as tax-deductible. Rank uses confirmed cumulative gross
        payments. Positions can change at any time, including during checkout.
      </p>
      <h2>Allocation</h2>
      <p>
        ${config.charityPercentage}% of each gross payment is allocated to the featured charity and
        ${config.platformPercentage}% supports Outcharity. Fractional cents are rounded in the
        charity's favor. Payment-processing fees are paid from Outcharity's share or absorbed by
        Outcharity; they do not reduce the stated charity allocation. The charity share is
        delivered to the charity provider after a ${config.charityHoldDays}-day verification
        period following payment; a payment that is refunded or disputed within that period sends
        nothing to the charity.
      </p>
      <h2>Listings</h2>
      <p>
        Listings may not promote illegal products, malware, pornography, hate or extremist content,
        scams, or impersonation. Outcharity may edit, hide, or remove any listing. Hiding a listing
        does not erase its payment record.
      </p>
      <h2>Refunds and disputes</h2>
      <p>
        Rank changes are an expected part of the product and do not qualify a payment for a refund.
        Within ${config.charityHoldDays} days of payment, Outcharity will review duplicate or
        unauthorized charges, billing errors, failures to provide the purchased listing, and the
        removal of a compliant listing, and when a refund is owed it issues a full refund through
        Stripe to the original payment method. A listing removed for violating the published
        listing rules does not qualify for a refund.
      </p>
      <p>
        <strong>After ${config.charityHoldDays} days a payment is final.</strong> By then the
        charity share has been delivered to the charity and cannot be recalled and the advertising
        has been provided, so no refund is available for any reason. Where the card issuer offers
        it, checkout asks the cardholder to authenticate the payment with their bank; by paying,
        the cardholder confirms the payment is authorized and agrees to these Terms.
      </p>
      <p>
        If a card issuer opens a payment dispute, it is handled through Stripe and the applicable
        card-network process rather than through a separate refund, and Outcharity contests
        disputes on payments that have become final. A listing whose payment is refunded or
        disputed is hidden from the leaderboard automatically while Outcharity reviews it; its
        payment record is kept. Nothing in these Terms limits rights that cannot legally be waived.
      </p>
      <p>Questions: <a href="mailto:hello@outcharity.com">hello@outcharity.com</a></p>
    </main>`;
  return page(config, { title: 'Terms', path: '/terms', body });
}

export function privacyPage(config) {
  const body = html`${brandHeader()}
    <main class="narrow-shell prose page-main">
      <h1>Privacy</h1>
      <p>
        Outcharity stores the listing details you submit, the contribution amount, identifiers from
        the payment processor, and the resulting charity-delivery record. The public sees your logo,
        name, description, link, rank, and confirmed gross total.
      </p>
      <p>
        Stripe processes payment details and may collect an email address. Outcharity does not store
        card numbers. The charity provider receives the charity amount, selected charity, and
        non-personal transaction identifiers needed to prevent duplicates. Infrastructure logs may
        contain an IP address, browser information, requested URL, and error details.
      </p>
      <p>
        Outcharity does not sell personal information or place advertising trackers in the critical
        path. Records are retained as needed for payment, accounting, fraud prevention, legal, and
        operational purposes.
      </p>
      <p>Privacy questions: <a href="mailto:hello@outcharity.com">hello@outcharity.com</a></p>
    </main>`;
  return page(config, { title: 'Privacy', path: '/privacy', body });
}

export function messagePage(config, { title, heading, message, status = 400 }) {
  const body = html`${brandHeader()}
    <main class="narrow-shell page-main status-page">
      <p class="eyebrow">${status}</p>
      <h1>${heading}</h1>
      <p class="page-intro">${message}</p>
      <a class="button button-secondary" href="/">Back to Outcharity</a>
    </main>`;
  return {
    status,
    document: page(config, { title, body }),
  };
}
