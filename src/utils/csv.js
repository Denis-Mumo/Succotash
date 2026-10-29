function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"'&&cell.length===0)quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV contains an unclosed quoted field');
  if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  return rows;
}
function parseRoster(text){
  const rows=parseCsv(text);if(rows.length<2)throw new Error('CSV must include a header and at least one participant');
  const headers=rows.shift().map(x=>x.trim().toLowerCase());const emailIndex=headers.indexOf('email');const nameIndex=headers.indexOf('name');
  if(emailIndex<0)throw new Error('CSV must include an email header');
  if(rows.length>10000)throw new Error('CSV cannot contain more than 10,000 participants');
  const records=rows.filter(r=>r.some(x=>x.trim())).map(r=>({email:(r[emailIndex]||'').trim().toLowerCase(),name:nameIndex<0?'':(r[nameIndex]||'').trim()}));
  if(records.some(x=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)))throw new Error('CSV contains an invalid email');
  if(new Set(records.map(x=>x.email)).size!==records.length)throw new Error('CSV contains duplicate email addresses');
  return records;
}
module.exports={parseCsv,parseRoster};
