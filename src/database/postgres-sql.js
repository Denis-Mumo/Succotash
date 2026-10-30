function convert(sql) {
  const ignoreConflict = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql);
  let text = sql
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
    .replace(/email\s*=\s*\?/gi, 'lower(email)=lower(?)')
    .replace(/\s+COLLATE\s+NOCASE/gi, '');
  if (ignoreConflict) text += ' ON CONFLICT DO NOTHING';
  text = text
    .replace(/strftime\('%Y-%m-%dT%H:%M:%fZ',\s*'now'\)/gi, `to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
    .replace(/datetime\('now',\s*'-30 day'\)/gi, `to_char((clock_timestamp() AT TIME ZONE 'UTC') - interval '30 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
    .replace(/datetime\('now',\s*'-'\s*\|\|\s*c\.retention_days\s*\|\|\s*' days'\)/gi, `to_char((clock_timestamp() AT TIME ZONE 'UTC') - c.retention_days * interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
    .replace(/instr\(lower\(a\.staff_number\),\s*lower\(\?\)\)\s*>\s*0/gi, 'position(lower(?) in lower(a.staff_number))>0')
    .replace(/sum\(e\.classification='confirmed_human'\)/gi, "sum((e.classification='confirmed_human')::int)");
  // All question marks in current SQL are bind markers; parameter values stay out of the SQL string.
  let index = 0;
  return text.replace(/\?/g, () => `$${++index}`);
}

module.exports = { convert };
