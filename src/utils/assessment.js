const companies = ['SKL', 'CHRS', 'POL'];

function normalizeKenyanPhone(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[\s()-]/g, '');
  if (/^0[17]\d{8}$/.test(cleaned)) return `+254${cleaned.slice(1)}`;
  if (/^\+254[17]\d{8}$/.test(cleaned)) return cleaned;
  if (/^254[17]\d{8}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

function normalizeStaffNumber(value) {
  if (typeof value !== 'string') return null;
  const staffNumber = value.trim();
  if (!staffNumber || staffNumber.length > 64 || /[\u0000-\u001f\u007f]/.test(staffNumber)) return null;
  return staffNumber.toUpperCase();
}

module.exports = { companies, normalizeKenyanPhone, normalizeStaffNumber };
