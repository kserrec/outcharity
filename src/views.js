import { html } from 'hono/html';
import { amountInputValue, displayHost, formatMoney } from './domain.js';

const SITE_DESCRIPTION =
  'Businesses compete for the top spot by giving to charity. Rank is determined by confirmed lifetime contributions.';

function page(config, { title, description = SITE_DESCRIPTION, path = '/', body, privatePage = false }) {
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
      </head>
      <body>
        ${body}
        <footer class="site-footer">
          <a href="/">Outcharity</a>
          <nav aria-label="Legal and project information">
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

function homeHeader() {
  return html`<header class="home-header shell">
    <a class="wordmark" href="/" aria-label="Outcharity home">Outcharity</a>
    <nav aria-label="Primary navigation">
      <a href="#leaderboard-title">Leaderboard</a>
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

export function homePage(config, data) {
  const board = data.advertisers.map((advertiser, index) => listingCard(advertiser, index, config));
  const leaders = board.slice(0, 3);
  const remainingListings = board.slice(3);
  const heroCta = config.checkoutEnabled
    ? html`<a class="button button-primary" href="/submit">Get on the board</a>`
    : html`<span class="button button-disabled" aria-disabled="true">Opening after final checks</span>`;

  const body = html`${homeHeader()}
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
      </section>
    </main>`;

  return page(config, { title: 'Outcharity', path: '/', body });
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

  return page(config, { title: 'Get on the board', path: '/submit', body });
}

export function managePage(config, advertiser, token, { errors = {}, amount = '' } = {}) {
  const rankLine = advertiser.rank
    ? html`Currently <strong>#${advertiser.rank}</strong>`
    : html`Not currently visible on the board`;
  const form = config.checkoutEnabled
    ? html`<form class="give-more-form" action="${`/manage/${token}/checkout`}" method="post">
        ${amountPicker(config, amount || amountInputValue(config.minimumCents), errors)}
        ${checkoutNotice(config)}
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

  return page(config, { title: `Manage ${advertiser.name}`, body, privatePage: true });
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
