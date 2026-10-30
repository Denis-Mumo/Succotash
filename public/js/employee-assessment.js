const query = new URLSearchParams(location.search);
const token = query.get('token') || '';
const eventRef = query.get('eventRef') || '';
const panels = [...document.querySelectorAll('[data-step]')];
const progress = document.querySelector('#progress-fill');
const stepLabel = document.querySelector('#step-label');
let staffNumber = '';
let busy = false;

function moveTo(name) {
  const index = panels.findIndex(panel => panel.dataset.step === name);
  panels.forEach(panel => { panel.hidden = panel.dataset.step !== name; });
  stepLabel.textContent = index === 3 ? 'ASSESSMENT INFORMATION' : `STEP ${index + 1} OF 4`;
  document.querySelector('.progress').setAttribute('aria-label', `Step ${Math.min(index + 1, 4)} of 4`);
  progress.style.width = `${((index + 1) / 4) * 100}%`;
}

async function submit(path, body) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('.employee-button').forEach(button => { button.disabled = true; });
  try {
    const response = await fetch(`/q/${encodeURIComponent(token)}/assessment/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventRef, ...body }), cache: 'no-store', credentials: 'same-origin'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to continue. Contact IT for assistance.');
    return result;
  } finally {
    busy = false;
    document.querySelectorAll('.employee-button').forEach(button => { button.disabled = false; });
  }
}

document.querySelector('#staff-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.querySelector('#staff-number');
  const error = document.querySelector('#staff-error');
  staffNumber = input.value.trim();
  error.textContent = '';
  if (!staffNumber || staffNumber.length > 64) { error.textContent = 'Enter your staff number to continue.'; input.focus(); return; }
  try { await submit('start', { staffNumber }); moveTo('company'); }
  catch (e) { error.textContent = e.message; }
});

document.querySelector('#company-form').addEventListener('submit', async event => {
  event.preventDefault();
  const company = document.querySelector('#company').value;
  const error = document.querySelector('#company-error');
  error.textContent = '';
  if (!['SKL', 'CHRS', 'POL'].includes(company)) { error.textContent = 'Select a company to continue.'; return; }
  try { await submit('company', { staffNumber, company }); moveTo('contact'); }
  catch (e) { error.textContent = e.message; }
});

document.querySelector('#phone-form').addEventListener('submit', async event => {
  event.preventDefault();
  const phoneNumber = document.querySelector('#phone-number').value.trim();
  const error = document.querySelector('#phone-error');
  error.textContent = '';
  if (!phoneNumber) { error.textContent = 'Enter a phone number to continue.'; return; }
  try { await submit('complete', { staffNumber, phoneNumber }); moveTo('complete'); }
  catch (e) { error.textContent = e.message; }
});

moveTo('welcome');
