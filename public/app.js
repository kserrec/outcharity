const amountInput = document.querySelector('#amount');
const amountButtons = document.querySelectorAll('[data-amount]');

for (const button of amountButtons) {
  button.addEventListener('click', () => {
    if (!amountInput) return;
    amountInput.value = button.dataset.amount;
    amountInput.focus();
    for (const candidate of amountButtons) candidate.removeAttribute('aria-pressed');
    button.setAttribute('aria-pressed', 'true');
  });
}

for (const button of document.querySelectorAll('[data-copy]')) {
  const original = button.textContent;
  let resetTimer;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      button.textContent = original;
    }, 1800);
  });
}
